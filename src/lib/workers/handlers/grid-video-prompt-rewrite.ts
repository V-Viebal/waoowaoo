import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { rewriteGridVideoPrompt } from '@/lib/storyboard-images/grid-video-prompt'
import { resolveAnalysisModel } from './resolve-analysis-model'

type AnyObj = Record<string, unknown>

/**
 * 手动重生宫格视频提示词：强制用 LLM 重写并回写 videoPrompt + gridVideoPromptAt。
 * 计费由 task 生命周期负责（创建时已冻结 analysisModel），此处不再调用文本计费包装器。
 */
export async function handleGridVideoPromptRewriteTask(
  job: Job<TaskJobData>,
): Promise<{ panelId: string; rewritten: boolean }> {
  const payload = (job.data.payload || {}) as AnyObj
  const panelId = job.data.targetType === 'NovelPromotionPanel'
    ? (job.data.targetId || '')
    : (typeof payload.panelId === 'string' ? payload.panelId : '')
  if (!panelId) throw new Error('AI_GRID_VIDEO_PROMPT: panelId missing')

  const panel = await prisma.novelPromotionPanel.findFirst({
    where: {
      id: panelId,
      storyboard: { episode: { novelPromotionProject: { projectId: job.data.projectId } } },
    },
  })
  if (!panel) throw new Error('AI_GRID_VIDEO_PROMPT: panel not found or not in project')
  if (panel.imageLayout !== 'grid') {
    throw new Error('AI_GRID_VIDEO_PROMPT: panel is not a grid layout')
  }

  await reportTaskProgress(job, 20, { stage: 'received' })
  await assertTaskActive(job, 'grid_video_prompt_rewrite_prepare')

  const analysisModel = await resolveAnalysisModel({
    userId: job.data.userId,
    inputModel: payload.analysisModel,
  })

  const payloadGridSize = typeof payload.gridSize === 'number' ? payload.gridSize : null
  const gridSize = payloadGridSize && payloadGridSize > 1 ? payloadGridSize : 4
  const locale = job.data.locale === 'en' ? 'en' : 'zh'
  const basePrompt = panel.videoPrompt || panel.description || ''

  const result = await rewriteGridVideoPrompt({
    panelContext: {
      shot_type: panel.shotType || '',
      camera_move: panel.cameraMove || '',
      description: panel.description || '',
      location: panel.location || '',
      characters: panel.characters || '',
      text_segment: panel.srtSegment || '',
    },
    basePrompt,
    gridSize,
    shotType: panel.shotType || '',
    cameraMove: panel.cameraMove || '',
    locale,
    projectId: job.data.projectId,
    userId: job.data.userId,
    model: analysisModel,
  })

  if (!result) throw new Error('AI_GRID_VIDEO_PROMPT: rewrite returned empty')

  await assertTaskActive(job, 'grid_video_prompt_rewrite_persist')
  await prisma.novelPromotionPanel.update({
    where: { id: panelId },
    data: { videoPrompt: result.prompt, gridVideoPromptAt: new Date() },
  })

  await reportTaskProgress(job, 96, { stage: 'grid_video_prompt_rewrite_done' })
  return { panelId, rewritten: true }
}
