import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import {
  applySmartCropToVideoElement,
  ENHANCE_UNSUPPORTED_TYPE,
  ENHANCE_VIDEO_ELEMENT_NOT_FOUND,
  findVideoElementInProject,
  type EditorEnhanceType,
} from '@/lib/twick/enhance'

const MAX_ENHANCE_MERGE_RETRIES = 3

export const ENHANCE_RESTORE_PROVIDER_UNAVAILABLE = 'ENHANCE_RESTORE_PROVIDER_UNAVAILABLE'

const SUPPORTED_ENHANCE_TYPES = new Set<EditorEnhanceType>(['smart_crop', 'restore'])

type JsonRecord = Record<string, unknown>

function asJsonRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readPositiveNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function ceilBillableSeconds(value: number | null | undefined) {
  return Math.max(1, Math.ceil(value || 1))
}

function parseEnhancePayload(job: Job<TaskJobData>) {
  const payload = asJsonRecord(job.data.payload) || {}
  const episodeId = readString(payload.episodeId) || readString(job.data.episodeId) || null
  const editorProjectId = readString(payload.editorProjectId)
    || (job.data.targetType === 'NovelPromotionEditorProject' ? readString(job.data.targetId) : null)
  const selectedElementId = readString(payload.selectedElementId)
  const rawEnhanceType = readString(payload.enhanceType) || 'smart_crop'
  const enhanceType: EditorEnhanceType | null = rawEnhanceType === 'restore' ? 'restore' : rawEnhanceType === 'smart_crop' ? 'smart_crop' : null
  const targetAspectRatio = readString(payload.targetAspectRatio)
  const anchor = readString(payload.anchor)
  const cropStrength = readPositiveNumber(payload.cropStrength)
  const durationSeconds = readPositiveNumber(payload.durationSeconds)

  if (!episodeId) throw new Error('episodeId is required')
  if (!editorProjectId) throw new Error('editorProjectId is required')
  if (!selectedElementId) throw new Error(ENHANCE_VIDEO_ELEMENT_NOT_FOUND)
  if (!enhanceType || !SUPPORTED_ENHANCE_TYPES.has(enhanceType)) throw new Error(ENHANCE_UNSUPPORTED_TYPE)

  return {
    episodeId,
    editorProjectId,
    selectedElementId,
    enhanceType,
    targetAspectRatio,
    anchor,
    cropStrength,
    durationSeconds,
  }
}

async function loadEditorProject(editorProjectId: string, episodeId: string) {
  return await prisma.novelPromotionEditorProject.findFirst({
    where: {
      id: editorProjectId,
      episodeId,
    },
    select: {
      id: true,
      projectData: true,
      version: true,
    },
  })
}

export function buildEnhancedProject(params: {
  currentProjectData: unknown
  selectedElementId: string
  enhanceType: EditorEnhanceType
  targetAspectRatio?: string | null
  anchor?: string | null
  cropStrength?: number | null
}) {
  if (params.enhanceType === 'restore') {
    throw new Error(ENHANCE_RESTORE_PROVIDER_UNAVAILABLE)
  }
  if (params.enhanceType !== 'smart_crop') {
    throw new Error(ENHANCE_UNSUPPORTED_TYPE)
  }

  return applySmartCropToVideoElement({
    projectData: params.currentProjectData as Parameters<typeof applySmartCropToVideoElement>[0]['projectData'],
    selectedElementId: params.selectedElementId,
    targetAspectRatio: params.targetAspectRatio,
    anchor: params.anchor,
    cropStrength: params.cropStrength,
  })
}

async function persistEnhancedProjectWithVersionRetry(params: {
  job: Job<TaskJobData>
  episodeId: string
  editorProjectId: string
  initialVersion: number
  initialProjectData: unknown
  selectedElementId: string
  enhanceType: EditorEnhanceType
  targetAspectRatio?: string | null
  anchor?: string | null
  cropStrength?: number | null
  frozenSeconds: number
}) {
  let expectedVersion = params.initialVersion
  let currentProjectData = params.initialProjectData

  for (let attempt = 1; attempt <= MAX_ENHANCE_MERGE_RETRIES; attempt += 1) {
    const buildResult = buildEnhancedProject({
      currentProjectData,
      selectedElementId: params.selectedElementId,
      enhanceType: params.enhanceType,
      targetAspectRatio: params.targetAspectRatio,
      anchor: params.anchor,
      cropStrength: params.cropStrength,
    })
    const buildActualSeconds = ceilBillableSeconds(buildResult.durationSeconds)
    if (buildActualSeconds > params.frozenSeconds) {
      throw new Error('ENHANCE_BILLING_FREEZE_UNDERESTIMATED')
    }

    await assertTaskActive(params.job, 'enhance_persist_editor_project')
    const updateResult = await prisma.novelPromotionEditorProject.updateMany({
      where: {
        id: params.editorProjectId,
        version: expectedVersion,
      },
      data: {
        projectData: buildResult.projectData as unknown as object,
        version: { increment: 1 },
      },
    })

    if (updateResult.count === 1) {
      return buildResult
    }

    const latestProject = await loadEditorProject(params.editorProjectId, params.episodeId)
    if (!latestProject) throw new Error('EDITOR_PROJECT_NOT_FOUND')
    expectedVersion = latestProject.version
    currentProjectData = latestProject.projectData
  }

  throw new Error(`ENHANCE_PROJECT_VERSION_CONFLICT: failed after ${MAX_ENHANCE_MERGE_RETRIES} retries`)
}

export async function handleEditorEnhanceTask(job: Job<TaskJobData>) {
  const payload = parseEnhancePayload(job)

  await reportTaskProgress(job, 15, { stage: 'enhance_load_context' })

  const editorProject = await loadEditorProject(payload.editorProjectId, payload.episodeId)
  if (!editorProject) throw new Error('EDITOR_PROJECT_NOT_FOUND')

  const selectedVideo = findVideoElementInProject({
    projectData: editorProject.projectData as unknown as Parameters<typeof findVideoElementInProject>[0]['projectData'],
    selectedElementId: payload.selectedElementId,
  })
  if (!selectedVideo) throw new Error(ENHANCE_VIDEO_ELEMENT_NOT_FOUND)

  if (payload.enhanceType === 'restore') {
    throw new Error(ENHANCE_RESTORE_PROVIDER_UNAVAILABLE)
  }

  const frozenSeconds = ceilBillableSeconds(payload.durationSeconds ?? selectedVideo.durationSeconds)
  const actualSeconds = ceilBillableSeconds(selectedVideo.durationSeconds)
  if (actualSeconds > frozenSeconds) {
    throw new Error('ENHANCE_BILLING_FREEZE_UNDERESTIMATED')
  }

  await reportTaskProgress(job, 60, {
    stage: 'enhance_apply_smart_crop',
    selectedElementId: payload.selectedElementId,
    durationSeconds: selectedVideo.durationSeconds || 1,
  })

  const replacement = await persistEnhancedProjectWithVersionRetry({
    job,
    episodeId: payload.episodeId,
    editorProjectId: payload.editorProjectId,
    initialVersion: editorProject.version,
    initialProjectData: editorProject.projectData,
    selectedElementId: payload.selectedElementId,
    enhanceType: payload.enhanceType,
    targetAspectRatio: payload.targetAspectRatio,
    anchor: payload.anchor,
    cropStrength: payload.cropStrength,
    frozenSeconds,
  })

  await reportTaskProgress(job, 95, {
    stage: 'enhance_completed',
    selectedElementId: payload.selectedElementId,
    actualSeconds,
  })

  return {
    success: true,
    editorProjectId: payload.editorProjectId,
    episodeId: payload.episodeId,
    enhanceType: payload.enhanceType,
    mode: 'timeline_parameter_smart_crop',
    replacedElementId: replacement.replacedElementId,
    sourcePanelId: replacement.sourcePanelId,
    oldSrc: replacement.oldSrc,
    durationSeconds: replacement.durationSeconds || selectedVideo.durationSeconds || 1,
    targetAspectRatio: replacement.targetAspectRatio,
    anchor: replacement.anchor,
    actualSeconds,
    actualQuantity: actualSeconds,
    editorAssetCreated: false,
  }
}
