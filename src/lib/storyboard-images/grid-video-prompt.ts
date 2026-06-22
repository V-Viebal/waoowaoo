import { buildPromptAsync, PROMPT_IDS } from '@/lib/prompt-i18n'
import { buildStoryboardGridLayout } from './grid'

export interface BuildGridVideoPromptParams {
  /** 基础提示词（原 videoPrompt 或 description） */
  basePrompt: string
  /** 面板描述，用于补充画面内容 */
  panelDescription: string
  /** 宫格数量 */
  gridSize: number
  /** 镜头类型 */
  shotType: string
  /** 镜头运动方式 */
  cameraMove: string
  /** 语言区域 */
  locale?: 'zh' | 'en'
  /** 项目 ID（用于项目级提示词覆盖） */
  projectId?: string | null
}

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
 * 为宫格分镜图构建优化的视频生成提示词。
 *
 * 宫格图与单镜头图有本质区别：
 * - 宫格图包含多个分格，但应被理解为同一连续动作的关键帧
 * - 需要把各格补间成流畅连贯的单镜头视频，而非逐格平移/切换
 * - 需要忽略分格线，输出完整连续的真实场景画面
 *
 * 当无法构建宫格提示词时，返回 null，调用方应回退到原始提示词。
 */
export async function buildGridVideoPrompt(
  params: BuildGridVideoPromptParams,
): Promise<string | null> {
  const {
    basePrompt,
    panelDescription,
    gridSize,
    shotType,
    cameraMove,
    locale = 'zh',
    projectId = null,
  } = params

  if (!basePrompt?.trim()) return null
  if (gridSize <= 1) return null

  try {
    const layout = buildStoryboardGridLayout('grid_auto', gridSize)
    const gridLayoutText = formatGridLayoutText(layout, locale)

    const prompt = await buildPromptAsync({
      promptId: PROMPT_IDS.NP_PANEL_GRID_VIDEO,
      locale,
      projectId,
      variables: {
        base_prompt: basePrompt,
        panel_description: panelDescription || basePrompt,
        grid_layout: gridLayoutText,
        panel_grid_size: String(gridSize),
        shot_type: shotType || (locale === 'zh' ? '中景' : 'medium shot'),
        camera_move: cameraMove || (locale === 'zh' ? '平滑连贯运镜' : 'smooth continuous camera move'),
      },
    })

    return prompt
  } catch (error) {
    // 提示词构建失败时回退到基础提示词
    if (typeof console !== 'undefined') {
      console.warn('[buildGridVideoPrompt] failed, falling back to base prompt:', error)
    }
    return null
  }
}

/**
 * 判断面板是否为宫格布局。
 * 兼容多种来源：imageLayout 字段、gridSize 参数等。
 */
export function isGridLayout(imageLayout: string | null | undefined): boolean {
  return imageLayout === 'grid'
}
