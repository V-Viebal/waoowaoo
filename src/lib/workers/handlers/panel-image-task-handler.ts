import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import { type TaskJobData } from '@/lib/task/types'
import { resolveWorkerArtStylePrompt } from '@/lib/workers/art-style'
import { reportTaskProgress } from '../shared'
import {
  assertTaskActive,
  getProjectModels,
  resolveImageSourceFromGeneration,
  uploadImageSourceToCos,
} from '../utils'
import { normalizeReferenceImagesForGeneration } from '@/lib/media/outbound-image'
import {
  AnyObj,
  clampCount,
  collectPanelReferenceImages,
  findCharacterByName,
  parsePanelCharacterReferences,
  pickFirstString,
  resolveNovelData,
} from './image-task-handler-shared'
import { buildPromptAsync, PROMPT_IDS } from '@/lib/prompt-i18n'
import {
  parseLocationAvailableSlots,
} from '@/lib/location-available-slots'
import { buildStoryboardGridLayout } from '@/lib/storyboard-images/grid'
import { buildGridInvalidationPatch } from './panel-image-grid-invalidate'

function formatPanelGridLayout(layout: ReturnType<typeof buildStoryboardGridLayout>, locale: TaskJobData['locale']) {
  if (locale === 'zh') {
    return `${layout.columns} 列 x ${layout.rows} 行`
  }
  return `${layout.columns} columns x ${layout.rows} rows`
}

interface NeighborPanelContext {
  // 相对当前镜头的位置：previous(前一镜) | next(后一镜)
  position: 'previous' | 'next'
  shot_type: string
  camera_move: string
  description: string
}

/**
 * 查询相邻镜头（前一镜 + 后一镜），仅保留与当前镜头同场景（location 相同）的，
 * 并只提取镜头语言相关的轻量字段。用于保持镜头语言/动作连贯，
 * 而非维持角色/服装一致性（后者由参考图负责）。
 */
async function fetchNeighborPanelContext(panel: {
  storyboardId: string
  panelIndex: number
  location: string | null
}): Promise<NeighborPanelContext[]> {
  if (!panel.location) return []

  const neighbors = await prisma.novelPromotionPanel.findMany({
    where: {
      storyboardId: panel.storyboardId,
      panelIndex: { in: [panel.panelIndex - 1, panel.panelIndex + 1] },
    },
    select: {
      panelIndex: true,
      shotType: true,
      cameraMove: true,
      description: true,
      location: true,
    },
  })

  const result: NeighborPanelContext[] = []
  for (const neighbor of neighbors) {
    // 仅同场景才注入，跨场景的相邻镜头信息会干扰当前画面
    if ((neighbor.location || '') !== panel.location) continue
    result.push({
      position: neighbor.panelIndex < panel.panelIndex ? 'previous' : 'next',
      shot_type: neighbor.shotType || '',
      camera_move: neighbor.cameraMove || '',
      description: neighbor.description || '',
    })
  }

  // previous 在前，next 在后
  return result.sort((left, right) => (left.position === 'previous' ? -1 : 1) - (right.position === 'previous' ? -1 : 1))
}

function parseJsonUnknown(raw: string | null | undefined): unknown | null {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function parseDescriptionList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

function pickAppearanceDescription(appearance: {
  descriptions?: string | null
  description?: string | null
  selectedIndex?: number | null
}): string {
  const descriptions = parseDescriptionList(appearance.descriptions || null)
  if (descriptions.length > 0) {
    const selectedIndex = typeof appearance.selectedIndex === 'number' ? appearance.selectedIndex : 0
    const selected = descriptions[selectedIndex] || descriptions[0]
    if (selected && selected.trim()) return selected.trim()
  }
  if (typeof appearance.description === 'string' && appearance.description.trim()) {
    return appearance.description.trim()
  }
  return '无描述'
}

function buildPanelPromptContext(params: {
  panel: {
    id: string
    shotType: string | null
    cameraMove: string | null
    description: string | null
    imagePrompt: string | null
    videoPrompt: string | null
    location: string | null
    characters: string | null
    srtSegment: string | null
    photographyRules: string | null
    actingNotes: string | null
  }
  projectData: Awaited<ReturnType<typeof resolveNovelData>>
  neighborPanels?: NeighborPanelContext[]
}) {
  const panelCharacters = parsePanelCharacterReferences(params.panel.characters)
  const characterContexts = panelCharacters.map((reference) => {
    const character = findCharacterByName(params.projectData.characters || [], reference.name)
    if (!character) {
      return {
        name: reference.name,
        appearance: reference.appearance || null,
        description: '无角色外貌数据',
      }
    }

    const appearances = character.appearances || []
    const matchedAppearance =
      (reference.appearance
        ? appearances.find((appearance) => (appearance.changeReason || '').toLowerCase() === reference.appearance!.toLowerCase())
        : null) || appearances[0] || null

    return {
      name: character.name,
      appearance: matchedAppearance?.changeReason || null,
      description: matchedAppearance ? pickAppearanceDescription(matchedAppearance) : '无角色外貌数据',
      slot: reference.slot || null,
    }
  })

  const locationContext = (() => {
    if (!params.panel.location) return null
    const matchedLocation = (params.projectData.locations || []).find(
      (item) => item.name.toLowerCase() === params.panel.location!.toLowerCase(),
    )
    if (!matchedLocation) return null
    const selectedImage = (matchedLocation.images || []).find((item) => item.isSelected) || matchedLocation.images?.[0]
    return {
      name: matchedLocation.name,
      description: selectedImage?.description || null,
      available_slots: parseLocationAvailableSlots(selectedImage?.availableSlots),
    }
  })()

  return {
    panel: {
      panel_id: params.panel.id,
      shot_type: params.panel.shotType || '',
      camera_move: params.panel.cameraMove || '',
      description: params.panel.description || '',
      location: params.panel.location || '',
      characters: panelCharacters,
      source_text: params.panel.srtSegment || '',
      photography_rules: parseJsonUnknown(params.panel.photographyRules),
      acting_notes: parseJsonUnknown(params.panel.actingNotes),
    },
    context: {
      character_appearances: characterContexts,
      location_reference: locationContext,
      // 相邻镜头信息：仅用于保持镜头语言/动作连贯，不应被画进当前画面
      neighbor_panels: params.neighborPanels && params.neighborPanels.length > 0
        ? params.neighborPanels
        : undefined,
    },
  }
}

function buildPanelPrompt(params: {
  projectId: string
  locale: TaskJobData['locale']
  aspectRatio: string
  styleText: string
  sourceText: string
  contextJson: string
}): Promise<string> {
  return buildPromptAsync({
    promptId: PROMPT_IDS.NP_SINGLE_PANEL_IMAGE,
    locale: params.locale,
    projectId: params.projectId,
    variables: {
      aspect_ratio: params.aspectRatio,
      storyboard_text_json_input: params.contextJson,
      source_text: params.sourceText || '无',
      style: params.styleText,
    },
  })
}

export async function handlePanelImageTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const panelId = pickFirstString(payload.panelId, job.data.targetId)
  if (!panelId) throw new Error('panelId missing')

  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
  })

  if (!panel) throw new Error('Panel not found')

  const projectData = await resolveNovelData(job.data.projectId)
  const modelConfig = await getProjectModels(job.data.projectId, job.data.userId)
  const modelKey = modelConfig.storyboardModel
  if (!modelKey) throw new Error('Storyboard model not configured')

  const candidateCount = clampCount(payload.candidateCount ?? payload.count, 1, 4, 1)
  // 宫格数：payload 显式指定时优先，否则回退到项目级默认配置
  const defaultGridSize = clampCount(modelConfig.panelGridSize, 1, 16, 1)
  const panelGridSize = clampCount(payload.panelGridSize, 1, 16, defaultGridSize)
  const refs = await collectPanelReferenceImages(projectData, panel)
  const normalizedRefs = await normalizeReferenceImagesForGeneration(refs)

  const logger = createScopedLogger({
    module: 'worker.panel-image',
    action: 'panel_image_generate',
    requestId: job.data.trace?.requestId || undefined,
    taskId: job.data.taskId,
    projectId: job.data.projectId,
    userId: job.data.userId,
  })
  logger.info({
    message: 'panel image generation started',
    details: {
      panelId,
      modelKey,
      candidateCount,
      panelGridSize,
      referenceImagesRawCount: refs.length,
      referenceImagesNormalizedCount: normalizedRefs.length,
      rawUrls: refs.map((u) => u.substring(0, 100)),
      normalizedUrls: normalizedRefs.map((u) => u.substring(0, 100)),
      panelCharacters: panel.characters,
      panelLocation: panel.location,
      artStyle: modelConfig.artStyle,
    },
  })

  const artStyle = resolveWorkerArtStylePrompt({
    modelConfigArtStyle: modelConfig.artStyle,
    modelConfigArtStylePrompt: modelConfig.artStylePrompt,
    locale: job.data.locale,
  })
  if (!projectData.videoRatio) throw new Error('Project videoRatio not configured')
  const aspectRatio = projectData.videoRatio
  const neighborPanels = await fetchNeighborPanelContext({
    storyboardId: panel.storyboardId,
    panelIndex: panel.panelIndex,
    location: panel.location,
  })
  const promptContext = buildPanelPromptContext({
    panel: {
      id: panel.id,
      shotType: panel.shotType,
      cameraMove: panel.cameraMove,
      description: panel.description,
      imagePrompt: panel.imagePrompt,
      videoPrompt: panel.videoPrompt,
      location: panel.location,
      characters: panel.characters,
      srtSegment: panel.srtSegment,
      photographyRules: panel.photographyRules,
      actingNotes: panel.actingNotes,
    },
    projectData,
    neighborPanels,
  })
  // 保存宫格生成元数据供后续视频重写使用
  const contextWithGridMetadata = {
    ...promptContext,
    gridMetadata: {
      panelGridSize,
      generatedAt: new Date().toISOString(),
    },
  }
  const contextJson = JSON.stringify(contextWithGridMetadata, null, 2)
  const prompt = await (async () => {
    if (panelGridSize > 1) {
      const layout = buildStoryboardGridLayout('grid_auto', panelGridSize)
      return await buildPromptAsync({
        promptId: PROMPT_IDS.NP_PANEL_GRID_IMAGE,
        locale: job.data.locale,
        projectId: job.data.projectId,
        variables: {
          storyboard_text_json_input: contextJson,
          source_text: panel.srtSegment || panel.description || '',
          aspect_ratio: aspectRatio,
          style: artStyle || '与参考图风格一致',
          grid_layout: formatPanelGridLayout(layout, job.data.locale),
          panel_grid_size: String(panelGridSize),
        },
      })
    }
    return await buildPanelPrompt({
      projectId: job.data.projectId,
      locale: job.data.locale,
      aspectRatio,
      styleText: artStyle || '与参考图风格一致',
      sourceText: panel.srtSegment || panel.description || '',
      contextJson,
    })
  })()
  logger.info({
    message: 'panel image prompt resolved',
    details: {
      promptLength: prompt.length,
      neighborPanelCount: neighborPanels.length,
      neighborPositions: neighborPanels.map((n) => n.position),
    },
  })

  const candidates: string[] = []

  for (let i = 0; i < candidateCount; i++) {
    await reportTaskProgress(job, 18 + Math.floor((i / Math.max(candidateCount, 1)) * 58), {
      stage: 'generate_panel_candidate',
      candidateIndex: i,
    })

    const source = await resolveImageSourceFromGeneration(job, {
      userId: job.data.userId,
      modelId: modelKey,
      prompt,
      options: {
        referenceImages: normalizedRefs,
        aspectRatio,
      },
      // 单个任务内会串行生成多候选，若允许按 task.externalId 续接会复用上一候选外部任务结果。
      allowTaskExternalIdResume: candidateCount === 1,
      pollProgress: { start: 30, end: 90 },
    })

    const cosKey = await uploadImageSourceToCos(source, 'panel-candidate', `${panel.id}-${i}`)
    candidates.push(cosKey)
  }

  const isFirstGeneration = !panel.imageUrl
  const imageLayout = panelGridSize > 1 ? 'grid' : 'single'

  await assertTaskActive(job, 'persist_panel_image')
  if (isFirstGeneration) {
    await prisma.novelPromotionPanel.update({
      where: { id: panel.id },
      data: {
        imageUrl: candidates[0] || null,
        candidateImages: candidateCount > 1 ? JSON.stringify(candidates) : null,
        imageLayout,
        ...buildGridInvalidationPatch(imageLayout),
        ...(panelGridSize > 1
          ? { gridGenerationContext: JSON.stringify(contextWithGridMetadata, null, 2) }
          : {}),
      },
    })
  } else {
    await prisma.novelPromotionPanel.update({
      where: { id: panel.id },
      data: {
        previousImageUrl: panel.imageUrl,
        candidateImages: JSON.stringify(candidates),
        imageLayout,
        ...buildGridInvalidationPatch(imageLayout),
        ...(panelGridSize > 1
          ? { gridGenerationContext: JSON.stringify(contextWithGridMetadata, null, 2) }
          : {}),
      },
    })
  }

  return {
    panelId: panel.id,
    candidateCount: candidates.length,
    imageUrl: isFirstGeneration ? candidates[0] || null : null,
  }
}
