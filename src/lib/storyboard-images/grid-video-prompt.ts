import { executeAiTextStep } from '@/lib/ai-runtime'
import { buildPromptAsync, PROMPT_IDS } from '@/lib/prompt-i18n'
import { buildStoryboardGridLayout } from './grid'

function formatGridLayoutText(
  layout: ReturnType<typeof buildStoryboardGridLayout>,
  locale: 'zh' | 'en' = 'zh',
): string {
  if (locale === 'zh') {
    return `${layout.columns} 列 × ${layout.rows} 行`
  }
  return `${layout.columns} columns × ${layout.rows} rows`
}

/**
 * 判断面板是否为宫格布局。
 * 兼容多种来源：imageLayout 字段、gridSize 参数等。
 */
export function isGridLayout(imageLayout: string | null | undefined): boolean {
  return imageLayout === 'grid'
}

export interface RewriteGridVideoPromptParams {
  panelContext: Record<string, unknown>
  basePrompt: string
  gridSize: number
  shotType: string
  cameraMove: string
  locale: 'zh' | 'en'
  projectId: string | null
  userId: string
  model: string
}

/** 去掉 markdown 代码块包裹并 trim。 */
export function parseRewrittenPrompt(raw: string): string {
  const trimmed = (raw || '').trim()
  const fenced = trimmed.match(/^```[a-zA-Z]*\n?([\s\S]*?)\n?```$/)
  return (fenced ? fenced[1] : trimmed).trim()
}

/**
 * 用 LLM 把宫格分镜理解为同一连续镜头的关键帧序列，按 Seedance 规范重写成一条视频提示词。
 * 失败/空返回 null，调用方应回退到原 basePrompt。
 */
export async function rewriteGridVideoPrompt(
  params: RewriteGridVideoPromptParams,
): Promise<{ prompt: string; promptTokens: number; completionTokens: number } | null> {
  const { panelContext, basePrompt, gridSize, shotType, cameraMove, locale, projectId, userId, model } = params
  if (gridSize <= 1) return null
  if (!model) return null

  try {
    const layout = buildStoryboardGridLayout('grid_auto', gridSize)
    const gridLayoutText = formatGridLayoutText(layout, locale)
    const filledPrompt = await buildPromptAsync({
      promptId: PROMPT_IDS.NP_PANEL_GRID_VIDEO,
      locale,
      projectId,
      variables: {
        storyboard_context_json: JSON.stringify(panelContext, null, 2),
        base_prompt: basePrompt || '',
        grid_layout: gridLayoutText,
        panel_grid_size: String(gridSize),
        shot_type: shotType || (locale === 'zh' ? '中景' : 'medium shot'),
        camera_move: cameraMove || (locale === 'zh' ? '平滑连贯运镜' : 'smooth continuous camera move'),
      },
    })

    const completion = await executeAiTextStep({
      userId,
      model,
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

    const prompt = parseRewrittenPrompt(completion.text || '')
    if (!prompt) return null
    return {
      prompt,
      promptTokens: completion.usage?.promptTokens || 0,
      completionTokens: completion.usage?.completionTokens || 0,
    }
  } catch (error) {
    if (typeof console !== 'undefined') {
      console.warn('[rewriteGridVideoPrompt] failed, caller should fall back:', error)
    }
    return null
  }
}
