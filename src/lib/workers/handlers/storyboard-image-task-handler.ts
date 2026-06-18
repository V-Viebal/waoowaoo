import { type Job } from 'bullmq'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { buildPromptAsync, PROMPT_IDS } from '@/lib/prompt-i18n'
import { createScopedLogger } from '@/lib/logging/core'
import { STORYBOARD_IMAGE_MODES, buildStoryboardGridLayout, parseStoryboardGridPreset } from '@/lib/storyboard-images/grid'
import { type TaskJobData } from '@/lib/task/types'
import { resolveWorkerArtStylePrompt } from '@/lib/workers/art-style'
import { reportTaskProgress } from '../shared'
import {
  assertTaskActive,
  getProjectModels,
  resolveImageSourceFromGeneration,
  uploadImageSourceToCos,
} from '../utils'
import { AnyObj, pickFirstString, resolveNovelData } from './image-task-handler-shared'

type StoryboardForImageTask = NonNullable<Awaited<ReturnType<typeof findStoryboardForImageTask>>>

function parseJsonValue(value: string | null | undefined): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function formatGridLayout(layout: ReturnType<typeof buildStoryboardGridLayout>, locale: TaskJobData['locale']) {
  if (locale === 'zh') {
    return `${layout.columns} 列 x ${layout.rows} 行`
  }
  return `${layout.columns} columns x ${layout.rows} rows`
}

function buildStoryboardPromptInput(storyboard: StoryboardForImageTask) {
  return storyboard.panels.map((panel) => ({
    panel_id: panel.id,
    panel_index: panel.panelIndex,
    panel_number: panel.panelNumber ?? panel.panelIndex + 1,
    shot_type: panel.shotType || '',
    camera_move: panel.cameraMove || '',
    description: panel.description || '',
    image_prompt: panel.imagePrompt || '',
    video_prompt: panel.videoPrompt || '',
    location: panel.location || '',
    characters: parseJsonValue(panel.characters),
    source_text: panel.srtSegment || '',
    photography_rules: parseJsonValue(panel.photographyRules),
    acting_notes: parseJsonValue(panel.actingNotes),
  }))
}

async function findStoryboardForImageTask(storyboardId: string) {
  return await prisma.novelPromotionStoryboard.findUnique({
    where: { id: storyboardId },
    include: {
      clip: {
        select: {
          content: true,
        },
      },
      episode: {
        select: {
          novelPromotionProject: {
            select: {
              projectId: true,
            },
          },
        },
      },
      panels: {
        orderBy: { panelIndex: 'asc' },
        select: {
          id: true,
          panelIndex: true,
          panelNumber: true,
          shotType: true,
          cameraMove: true,
          description: true,
          imagePrompt: true,
          videoPrompt: true,
          location: true,
          characters: true,
          srtSegment: true,
          photographyRules: true,
          actingNotes: true,
        },
      },
    },
  })
}

async function persistAiStoryboardImage(input: {
  storyboardId: string
  storageKey: string
  imageUrl: string
  imageMediaId: string
  userId: string
  gridPreset: string
  gridConfig: Prisma.InputJsonValue
  promptSnapshot: string
  sourcePanelsSnapshot: Prisma.InputJsonValue
  inputSnapshot: Prisma.InputJsonValue
}) {
  return await prisma.$transaction(async (tx) => {
    await tx.novelPromotionStoryboard.update({
      where: { id: input.storyboardId },
      data: { storyboardImageUrl: input.storageKey },
    })

    return await tx.storyboardImageVersion.create({
      data: {
        storyboardId: input.storyboardId,
        mode: STORYBOARD_IMAGE_MODES.AI_STORYBOARD,
        imageUrl: input.imageUrl,
        imageMediaId: input.imageMediaId,
        gridPreset: input.gridPreset,
        gridConfig: input.gridConfig,
        promptSnapshot: input.promptSnapshot,
        sourcePanelsSnapshot: input.sourcePanelsSnapshot,
        inputSnapshot: input.inputSnapshot,
        createdByUserId: input.userId,
      },
    })
  })
}

export async function handleStoryboardImageTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const storyboardId = pickFirstString(payload.storyboardId, job.data.targetId)
  if (!storyboardId) throw new Error('storyboardId missing')

  const storyboard = await findStoryboardForImageTask(storyboardId)
  if (!storyboard || storyboard.episode.novelPromotionProject.projectId !== job.data.projectId) {
    throw new Error('Storyboard not found')
  }

  const gridPreset = parseStoryboardGridPreset(payload.gridPreset)
  const layout = buildStoryboardGridLayout(gridPreset, storyboard.panels.length)
  const projectData = await resolveNovelData(job.data.projectId)
  if (!projectData.videoRatio) throw new Error('Project videoRatio not configured')

  const modelConfig = await getProjectModels(job.data.projectId, job.data.userId)
  const modelKey = modelConfig.storyboardModel
  if (!modelKey) throw new Error('Storyboard model not configured')

  const artStyle = resolveWorkerArtStylePrompt({
    modelConfigArtStyle: modelConfig.artStyle,
    modelConfigArtStylePrompt: modelConfig.artStylePrompt,
    locale: job.data.locale,
  })

  const promptInput = buildStoryboardPromptInput(storyboard)
  const promptInputJson = JSON.stringify(promptInput, null, 2)
  const aspectRatio = projectData.videoRatio
  const prompt = await buildPromptAsync({
    promptId: PROMPT_IDS.NP_STORYBOARD_GRID_IMAGE,
    locale: job.data.locale,
    projectId: job.data.projectId,
    variables: {
      storyboard_text_json_input: promptInputJson,
      source_text: storyboard.clip?.content || '无',
      aspect_ratio: aspectRatio,
      style: artStyle || '与参考图风格一致',
      grid_layout: formatGridLayout(layout, job.data.locale),
      panel_count: String(storyboard.panels.length),
    },
  })

  const logger = createScopedLogger({
    module: 'worker.storyboard-image',
    action: 'storyboard_image_generate',
    requestId: job.data.trace?.requestId || undefined,
    taskId: job.data.taskId,
    projectId: job.data.projectId,
    userId: job.data.userId,
  })
  logger.info({
    message: 'storyboard image generation started',
    details: {
      storyboardId,
      modelKey,
      panelCount: storyboard.panels.length,
      gridPreset,
      gridColumns: layout.columns,
      gridRows: layout.rows,
    },
  })

  await reportTaskProgress(job, 20, { stage: 'generate_storyboard_image' })
  const source = await resolveImageSourceFromGeneration(job, {
    userId: job.data.userId,
    modelId: modelKey,
    prompt,
    options: {
      aspectRatio,
    },
    allowTaskExternalIdResume: true,
    pollProgress: { start: 30, end: 90 },
  })

  const storageKey = await uploadImageSourceToCos(source, 'storyboard-image', storyboard.id)
  const media = await ensureMediaObjectFromStorageKey(storageKey, {
    mimeType: 'image/png',
  })

  await assertTaskActive(job, 'persist_storyboard_image')
  await reportTaskProgress(job, 94, { stage: 'persist_storyboard_image' })
  const sourcePanelsSnapshot = promptInput as Prisma.InputJsonValue
  const inputSnapshot = {
    mode: STORYBOARD_IMAGE_MODES.AI_STORYBOARD,
    gridPreset,
    panelCount: storyboard.panels.length,
    aspectRatio,
    storyboardTextJson: storyboard.storyboardTextJson,
  } satisfies Prisma.InputJsonObject

  const version = await persistAiStoryboardImage({
    storyboardId: storyboard.id,
    storageKey,
    imageUrl: media.url,
    imageMediaId: media.id,
    userId: job.data.userId,
    gridPreset,
    gridConfig: layout as Prisma.InputJsonValue,
    promptSnapshot: prompt,
    sourcePanelsSnapshot,
    inputSnapshot,
  })

  return {
    storyboardId: storyboard.id,
    imageUrl: media.url,
    imageMediaId: media.id,
    versionId: version.id,
    mode: STORYBOARD_IMAGE_MODES.AI_STORYBOARD,
    gridPreset,
    gridConfig: layout,
  }
}
