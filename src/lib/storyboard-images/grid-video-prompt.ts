import { executeAiTextStep, executeAiVisionStep } from '@/lib/ai-runtime'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import { buildPromptAsync, PROMPT_IDS } from '@/lib/prompt-i18n'
import { buildStoryboardGridLayout } from './grid'

function formatGridLayoutText(
  layout: ReturnType<typeof buildStoryboardGridLayout>,
  locale: 'zh' | 'en' = 'zh',
): string {
  const empty = layout.capacity - layout.panelCount
  if (locale === 'zh') {
    if (empty > 0) {
      return `${layout.columns} 列 × ${layout.rows} 行排列，实际 ${layout.panelCount} 格（末 ${empty} 格为空）`
    }
    return `${layout.columns} 列 × ${layout.rows} 行排列，共 ${layout.panelCount} 格`
  }
  if (empty > 0) {
    return `arranged as ${layout.columns} columns × ${layout.rows} rows, ${layout.panelCount} cells used (last ${empty} empty)`
  }
  return `${layout.columns} columns × ${layout.rows} rows, ${layout.panelCount} cells`
}

/**
 * 判断面板是否为宫格布局。
 * 兼容多种来源：imageLayout 字段、gridSize 参数等。
 */
export function isGridLayout(imageLayout: string | null | undefined): boolean {
  return imageLayout === 'grid'
}

export interface RewriteGridVideoPromptParams {
  basePrompt: string
  gridSize: number
  shotType: string
  cameraMove: string
  locale: 'zh' | 'en'
  projectId: string | null
  userId: string
  // Text path (fallback)
  model?: string
  panelContext?: Record<string, unknown> // legacy: for panels without gridGenerationContext
  // Vision path (preferred when available)
  visionModel?: string
  imageUrl?: string
  gridGenerationContextJson?: string // saved context from image generation time
  srtSegment?: string // 台词/字幕内容，重写后会追加到提示词末尾确保不丢失
}

/** 解析模型返回的 JSON 响应，提取 prompt 和 duration 字段。
 *  先去除 markdown 代码块包裹并解析。JSON 解析失败时回退到纯文本提取。
 *  容错性强：即使格式不完全正确，也尽量提取有用信息。
 */
export function parseGridVideoResponse(raw: string): { prompt: string; duration: number | null } {
  const trimmed = (raw || '').trim()
  if (!trimmed) {
    return { prompt: '', duration: null }
  }

  // 尝试去除 markdown 代码块包裹（支持多种格式）
  let jsonText = trimmed
  const fencedMatch = trimmed.match(/^```(?:json|jsonl|[a-zA-Z]*)?\s*\n?([\s\S]*?)\n?```$/i)
  if (fencedMatch) {
    jsonText = fencedMatch[1].trim()
  }

  // 尝试从文本中提取 JSON 对象（即使 JSON 不是完整响应体）
  const jsonObjectMatch = jsonText.match(/\{[\s\S]*\}/)
  if (jsonObjectMatch) {
    try {
      const parsed = JSON.parse(jsonObjectMatch[0])
      const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : ''
      const duration = typeof parsed.duration === 'number' && parsed.duration >= 3 && parsed.duration <= 15
        ? Math.round(parsed.duration)
        : null

      // 只要有 prompt 就返回，即使 duration 为空
      if (prompt) {
        return { prompt, duration }
      }
    } catch {
      // JSON 解析失败，继续尝试其他方式
    }
  }

  // 回退：从整个文本作为 prompt，尝试从文本中提取 duration
  const text = jsonText.toLowerCase()
  const patterns = [
    /(\d+(?:\.\d+)?)\s*(?:秒|second|seconds|sec|s)(?![a-z])/i,
    /duration\s*[:：]\s*(\d+(?:\.\d+)?)/i,
    /video_duration\s*[:：]\s*(\d+(?:\.\d+)?)/i,
    /时长\s*[:：]\s*(\d+(?:\.\d+)?)/i,
  ]
  let duration: number | null = null
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const value = parseFloat(match[1])
      if (!isNaN(value) && value >= 3 && value <= 15) {
        duration = Math.round(value)
        break
      }
    }
  }

  // 最后兜底：如果 duration 还是空，根据宫格大小估算默认值（4 格 = 4 秒，每格 1 秒）
  if (!duration) {
    const gridSizeMatch = text.match(/(?:grid|宫格|格子).*?(\d+)/i) || text.match(/(\d+).*?(?:grid|宫格|格子)/i)
    if (gridSizeMatch) {
      const gridSize = parseInt(gridSizeMatch[1], 10)
      if (gridSize > 0 && gridSize <= 64) {
        duration = Math.max(3, Math.min(gridSize, 15))
      }
    }
  }

  return { prompt: jsonText.trim(), duration }
}

/**
 * Normalize context for prompt template: prefer saved gridGenerationContextJson,
 * fall back to legacy panelContext assembly for older panels.
 */
function getStoryboardContextJson(
  gridGenerationContextJson: string | undefined,
  panelContext: Record<string, unknown> | undefined,
): string {
  if (gridGenerationContextJson) {
    return gridGenerationContextJson
  }
  // Legacy backward compat: assemble from individual fields
  return JSON.stringify(panelContext || {}, null, 2)
}

/**
 * 用 LLM 把宫格分镜理解为同一连续镜头的关键帧序列，按 Seedance 规范重写成一条视频提示词。
 *
 * 双路径：
 * - Vision 优先：当 visionModel + imageUrl 同时存在时，直接看宫格图重写（更精准）；任何失败回退文本路径。
 * - Text 兜底：仅基于上下文文本重写。
 *
 * 失败/空返回 null，调用方应回退到原 basePrompt。
 */
export async function rewriteGridVideoPrompt(
  params: RewriteGridVideoPromptParams,
): Promise<{ prompt: string; promptTokens: number; completionTokens: number; duration: number | null } | null> {
  const {
    basePrompt,
    gridSize,
    shotType,
    cameraMove,
    locale,
    projectId,
    userId,
    model,
    panelContext,
    visionModel,
    imageUrl,
    gridGenerationContextJson,
    srtSegment,
  } = params
  if (gridSize <= 1) return null

  const textModel = model || visionModel
  // 没有任何可用模型时，直接返回原始提示词，根据宫格大小估算时长
  if (!textModel && !visionModel) {
    return {
      prompt: basePrompt || '',
      promptTokens: 0,
      completionTokens: 0,
      duration: Math.max(3, Math.min(gridSize, 15)),
    }
  }

  const layout = buildStoryboardGridLayout('grid_auto', gridSize)
  const gridLayoutText = formatGridLayoutText(layout, locale)
  const promptCommonVariables = {
    storyboard_context_json: getStoryboardContextJson(gridGenerationContextJson, panelContext),
    base_prompt: basePrompt || '',
    grid_layout: gridLayoutText,
    panel_grid_size: String(gridSize),
    shot_type: shotType || (locale === 'zh' ? '中景' : 'medium shot'),
    camera_move: cameraMove || (locale === 'zh' ? '平滑连贯运镜' : 'smooth continuous camera move'),
  }

  // Vision path (preferred)
  const effectiveVisionModel = visionModel || model
  if (effectiveVisionModel && imageUrl) {
    try {
      if (typeof console !== 'undefined') {
        console.log('[rewriteGridVideoPrompt] 👁️ 使用视觉路径，图片:', {
          visionModel,
          effectiveVisionModel,
          imageUrlPreview: imageUrl.substring(0, 100) + '...',
          imageUrlLength: imageUrl.length,
          gridSize,
        })
      }
      const base64Image = await normalizeToBase64ForGeneration(imageUrl)
      const filledPrompt = await buildPromptAsync({
        promptId: PROMPT_IDS.NP_PANEL_GRID_VIDEO_VISION,
        locale,
        projectId,
        variables: promptCommonVariables,
      })

      if (typeof console !== 'undefined') {
        console.log('[rewriteGridVideoPrompt] ✅ 图片已转换为 base64，准备调用视觉模型:', {
          base64Length: base64Image.length,
          base64Preview: base64Image.substring(0, 50) + '...',
          promptLength: filledPrompt.length,
        })
      }

      const completion = await executeAiVisionStep({
        userId,
        model: effectiveVisionModel,
        prompt: filledPrompt,
        imageUrls: [base64Image],
        temperature: 0.7,
        projectId: projectId || undefined,
        action: 'grid_video_prompt_rewrite',
        meta: {
          stepId: 'grid_video_prompt_rewrite',
          stepTitle: locale === 'zh' ? '宫格视频提示词重写（视觉）' : 'Grid video prompt rewrite (vision)',
          stepIndex: 1,
          stepTotal: 1,
        },
      })

      const completionText = completion.text || ''
      if (typeof console !== 'undefined') {
        console.log('[rewriteGridVideoPrompt] ✅ 视觉模型返回:', {
          responseLength: completionText.length,
          responsePreview: completionText.substring(0, 200) + '...',
          promptTokens: completion.usage?.promptTokens || 0,
          completionTokens: completion.usage?.completionTokens || 0,
        })
      }
      const result = parseGridVideoResponse(completionText)
      // 只要模型返回了响应，就尽量返回，即使需要用 basePrompt 兜底
      // 台词处理完全交给 LLM：提示词模板要求 LLM 将台词融入时间分段
      // 输出格式示例：「2-4秒：...台词：XXX...」
      const finalPrompt = result.prompt || basePrompt || ''
      if (finalPrompt) {
        return {
          prompt: finalPrompt,
          promptTokens: completion.usage?.promptTokens || 0,
          completionTokens: completion.usage?.completionTokens || 0,
          duration: result.duration,
        }
      }
      // 视觉路径空返回，回退文本路径
    } catch (error) {
      if (typeof console !== 'undefined') {
        console.error('[rewriteGridVideoPrompt] ❌ 视觉路径失败，回退到文本路径:', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        })
      }
    }
  } else if (typeof console !== 'undefined') {
    console.log('[rewriteGridVideoPrompt] ⚠️ 跳过视觉路径，使用文本路径:', {
      visionModel: visionModel ? '已配置' : '未配置',
      effectiveVisionModel: effectiveVisionModel ? '已配置' : '未配置',
      imageUrl: imageUrl ? '已提供' : '未提供',
    })
  }

  // Text path (fallback)
  if (!textModel) {
    // 没有模型，直接返回原始提示词，根据宫格大小估算时长（3-15秒）
    const estimatedDuration = Math.max(3, Math.min(gridSize, 15))
    return {
      prompt: basePrompt || '',
      promptTokens: 0,
      completionTokens: 0,
      duration: estimatedDuration,
    }
  }
  try {
    const filledPrompt = await buildPromptAsync({
      promptId: PROMPT_IDS.NP_PANEL_GRID_VIDEO,
      locale,
      projectId,
      variables: promptCommonVariables,
    })

    const completion = await executeAiTextStep({
      userId,
      model: textModel,
      messages: [{ role: 'user', content: filledPrompt }],
      temperature: 0.7,
      projectId: projectId || undefined,
      action: 'grid_video_prompt_rewrite',
      meta: {
        stepId: 'grid_video_prompt_rewrite',
        stepTitle: locale === 'zh' ? '宫格视频提示词重写' : 'Grid video prompt rewrite',
        stepIndex: 1,
        stepTotal: 1,
      },
    })

    const completionText = completion.text || ''
    const result = parseGridVideoResponse(completionText)
    // 只要模型返回了响应，就尽量返回，即使需要用 basePrompt 兜底
    // 台词处理完全交给 LLM：提示词模板要求 LLM 将台词融入时间分段
    // 输出格式示例：「2-4秒：...台词：XXX...」
    const finalPrompt = result.prompt || basePrompt || ''
    if (!finalPrompt) {
      // 极端情况：返回空，返回原始提示词，估算时长
      return {
        prompt: basePrompt || '',
        promptTokens: 0,
        completionTokens: 0,
        duration: Math.max(3, Math.min(gridSize, 15)),
      }
    }
    return {
      prompt: finalPrompt,
      promptTokens: completion.usage?.promptTokens || 0,
      completionTokens: completion.usage?.completionTokens || 0,
      duration: result.duration,
    }
  } catch (error) {
    // 模型调用失败（超时、网络错误等），返回原始提示词，不阻塞流程
    if (typeof console !== 'undefined') {
      console.warn('[rewriteGridVideoPrompt] 模型调用失败，使用原始提示词兜底:',
        error instanceof Error ? error.message : String(error))
    }
    return {
      prompt: basePrompt || '',
      promptTokens: 0,
      completionTokens: 0,
      duration: Math.max(3, Math.min(gridSize, 15)), // 根据宫格数估算：每格约 1 秒，3-30 秒
    }
  }
}
