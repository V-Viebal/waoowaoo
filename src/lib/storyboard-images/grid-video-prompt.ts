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
  model?: string
  panelContext?: Record<string, unknown>
  visionModel?: string
  imageUrl?: string
  gridGenerationContextJson?: string
  srtSegment?: string
}

const VISION_TIMEOUT_MS = 45_000

function estimateDuration(gridSize: number): number {
  return Math.max(3, Math.min(gridSize, 15))
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 解析模型返回的 JSON 响应，提取 prompt 和 duration 字段。 */
export function parseGridVideoResponse(raw: string): { prompt: string; duration: number | null } {
  const trimmed = (raw || '').trim()
  if (!trimmed) return { prompt: '', duration: null }

  let jsonText = trimmed
  const fencedMatch = trimmed.match(/^```(?:json|jsonl|[a-zA-Z]*)?\s*\n?([\s\S]*?)\n?```$/i)
  if (fencedMatch) jsonText = fencedMatch[1].trim()

  const jsonObjectMatch = jsonText.match(/\{[\s\S]*\}/)
  if (jsonObjectMatch) {
    try {
      const parsed = JSON.parse(jsonObjectMatch[0])
      const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : ''
      const duration = typeof parsed.duration === 'number' && parsed.duration >= 3 && parsed.duration <= 15
        ? Math.round(parsed.duration)
        : null
      if (prompt) return { prompt, duration }
    } catch {
      // fall through
    }
  }

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

  if (!duration) {
    const gridSizeMatch = text.match(/(?:grid|宫格|格子).*?(\d+)/i) || text.match(/(\d+).*?(?:grid|宫格|格子)/i)
    if (gridSizeMatch) {
      const gs = parseInt(gridSizeMatch[1], 10)
      if (gs > 0 && gs <= 64) duration = estimateDuration(gs)
    }
  }

  return { prompt: jsonText.trim(), duration }
}

function getStoryboardContextJson(
  gridGenerationContextJson: string | undefined,
  panelContext: Record<string, unknown> | undefined,
): string {
  if (gridGenerationContextJson) return gridGenerationContextJson
  return JSON.stringify(panelContext || {}, null, 2)
}

function fallbackResult(basePrompt: string, gridSize: number, promptTokens = 0, completionTokens = 0) {
  return {
    prompt: basePrompt || '',
    promptTokens,
    completionTokens,
    duration: estimateDuration(gridSize),
  }
}

/**
 * 用 LLM 把宫格分镜理解为同一连续镜头的关键帧序列，按 Seedance 规范重写成一条视频提示词。
 * Vision 优先（visionModel + imageUrl 同时存在时走视觉路径），失败回退到文本路径。
 * Vision 路径包 45s 超时：卡住的视觉调用会在 45s 后放弃，让文本路径快速接管。
 * 返回 null 表示无需重写（gridSize <= 1）。
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
  } = params
  if (gridSize <= 1) return null

  const effectiveVisionModel = visionModel || model
  const textModel = model || effectiveVisionModel
  if (!textModel && !effectiveVisionModel) return fallbackResult(basePrompt, gridSize)

  const layout = buildStoryboardGridLayout('grid_auto', gridSize)
  const promptCommonVariables = {
    storyboard_context_json: getStoryboardContextJson(gridGenerationContextJson, panelContext),
    base_prompt: basePrompt || '',
    grid_layout: formatGridLayoutText(layout, locale),
    panel_grid_size: String(gridSize),
    shot_type: shotType || (locale === 'zh' ? '中景' : 'medium shot'),
    camera_move: cameraMove || (locale === 'zh' ? '平滑连贯运镜' : 'smooth continuous camera move'),
  }

  // Vision path (preferred)
  if (effectiveVisionModel && imageUrl) {
    try {
      const base64Image = await normalizeToBase64ForGeneration(imageUrl)
      const filledPrompt = await buildPromptAsync({
        promptId: PROMPT_IDS.NP_PANEL_GRID_VIDEO_VISION,
        locale,
        projectId,
        variables: promptCommonVariables,
      })

      const completion = await Promise.race([
        executeAiVisionStep({
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
        }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`vision path timed out after ${VISION_TIMEOUT_MS}ms`)), VISION_TIMEOUT_MS)
        }),
      ])

      const result = parseGridVideoResponse(completion.text || '')
      const finalPrompt = result.prompt || basePrompt || ''
      if (finalPrompt) {
        return {
          prompt: finalPrompt,
          promptTokens: completion.usage?.promptTokens || 0,
          completionTokens: completion.usage?.completionTokens || 0,
          duration: result.duration,
        }
      }
    } catch (error) {
      console.warn('[rewriteGridVideoPrompt] vision path failed, falling back to text:', errMsg(error))
    }
  }

  // Text path (fallback)
  if (!textModel) return fallbackResult(basePrompt, gridSize)
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
    const result = parseGridVideoResponse(completion.text || '')
    const finalPrompt = result.prompt || basePrompt || ''
    if (!finalPrompt) return fallbackResult(basePrompt, gridSize)
    return {
      prompt: finalPrompt,
      promptTokens: completion.usage?.promptTokens || 0,
      completionTokens: completion.usage?.completionTokens || 0,
      duration: result.duration,
    }
  } catch (error) {
    console.warn('[rewriteGridVideoPrompt] text path failed, using base prompt:', errMsg(error))
    return fallbackResult(basePrompt, gridSize)
  }
}
