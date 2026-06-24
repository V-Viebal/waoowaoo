import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { applyCaptionsToProject } from '@/lib/twick/project-builder'
import { toCaptionVoiceLineSources } from '@/lib/twick/caption-duration'

const MIN_BILLING_MINUTES = 0.01
const MAX_CAPTION_MERGE_RETRIES = 3

export const CAPTION_NO_VOICE_LINES_ERROR = 'CAPTION_NO_VOICE_LINES'

type JsonRecord = Record<string, unknown>
type VoiceLineRecord = Awaited<ReturnType<typeof loadEpisodeVoiceLines>>[number]

function asJsonRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readOptionalPositiveNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function parseCaptionPayload(job: Job<TaskJobData>) {
  const payload = asJsonRecord(job.data.payload) || {}
  const episodeId = readString(payload.episodeId) || readString(job.data.episodeId) || null
  const editorProjectId = readString(payload.editorProjectId)
    || (job.data.targetType === 'NovelPromotionEditorProject' ? readString(job.data.targetId) : null)

  if (!episodeId) throw new Error('episodeId is required')
  if (!editorProjectId) throw new Error('editorProjectId is required')

  return {
    episodeId,
    editorProjectId,
    frozenDurationMinutes: readOptionalPositiveNumber(payload.durationMinutes ?? payload.quantity),
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

async function loadEpisodeVoiceLines(episodeId: string) {
  return await prisma.novelPromotionVoiceLine.findMany({
    where: { episodeId },
    select: {
      id: true,
      lineIndex: true,
      speaker: true,
      content: true,
      audioDuration: true,
      audioMediaId: true,
      audioMedia: {
        select: {
          id: true,
          durationMs: true,
        },
      },
    },
    orderBy: { lineIndex: 'asc' },
  })
}

export async function buildCaptionedProject(params: {
  currentProjectData: unknown
  voiceLines: VoiceLineRecord[]
}) {
  const captionSources = toCaptionVoiceLineSources(params.voiceLines)
  const { projectData, captionCount, totalDurationSeconds } = applyCaptionsToProject(
    params.currentProjectData as Parameters<typeof applyCaptionsToProject>[0],
    captionSources,
  )

  return {
    projectData,
    captionCount,
    voiceLineCount: captionSources.length,
    totalDurationSeconds,
  }
}

async function persistCaptionedProjectWithVersionRetry(params: {
  job: Job<TaskJobData>
  episodeId: string
  editorProjectId: string
  initialVersion: number
  initialProjectData: unknown
  voiceLines: VoiceLineRecord[]
  frozenDurationMinutes: number | null
}) {
  let expectedVersion = params.initialVersion
  let currentProjectData = params.initialProjectData
  let lastBuildResult: Awaited<ReturnType<typeof buildCaptionedProject>> | null = null

  for (let attempt = 1; attempt <= MAX_CAPTION_MERGE_RETRIES; attempt += 1) {
    const buildResult = await buildCaptionedProject({
      currentProjectData,
      voiceLines: params.voiceLines,
    })
    lastBuildResult = buildResult

    if (buildResult.captionCount === 0) {
      throw new Error(CAPTION_NO_VOICE_LINES_ERROR)
    }

    const actualQuantity = Math.max(MIN_BILLING_MINUTES, buildResult.totalDurationSeconds / 60)
    if (params.frozenDurationMinutes !== null && actualQuantity > params.frozenDurationMinutes + 0.000001) {
      throw new Error('CAPTION_BILLING_FREEZE_UNDERESTIMATED')
    }

    await assertTaskActive(params.job, 'caption_persist_editor_project')
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

  throw new Error(`CAPTION_PROJECT_VERSION_CONFLICT: failed after ${MAX_CAPTION_MERGE_RETRIES} retries${lastBuildResult ? '' : ' without build'}`)
}

export async function handleEditorCaptionTask(job: Job<TaskJobData>) {
  const { episodeId, editorProjectId, frozenDurationMinutes } = parseCaptionPayload(job)

  await reportTaskProgress(job, 15, { stage: 'caption_load_voice_lines' })

  const editorProject = await loadEditorProject(editorProjectId, episodeId)
  if (!editorProject) throw new Error('EDITOR_PROJECT_NOT_FOUND')

  const voiceLines = await loadEpisodeVoiceLines(episodeId)

  await reportTaskProgress(job, 55, {
    stage: 'caption_build_track',
    voiceLineCount: voiceLines.length,
  })

  const { captionCount, voiceLineCount, totalDurationSeconds } = await persistCaptionedProjectWithVersionRetry({
    job,
    episodeId,
    editorProjectId,
    initialVersion: editorProject.version,
    initialProjectData: editorProject.projectData,
    voiceLines,
    frozenDurationMinutes,
  })

  const actualQuantity = Math.max(MIN_BILLING_MINUTES, totalDurationSeconds / 60)

  await reportTaskProgress(job, 90, {
    stage: 'caption_completed',
    captionCount,
    voiceLineCount,
    totalDurationSeconds,
    actualQuantity,
  })

  return {
    success: true,
    editorProjectId,
    episodeId,
    captionCount,
    voiceLineCount,
    totalDurationSeconds,
    actualQuantity,
  }
}
