import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { estimateVoiceLineMaxSeconds, synthesizeVoiceLineAudio } from '@/lib/voice/generate-voice-line'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { replaceVoiceOptimizeAudioElement } from '@/lib/twick/voice-optimize'

const MAX_VOICE_OPTIMIZE_MERGE_RETRIES = 3
const MIN_BILLING_SECONDS = 1

export const VOICE_OPTIMIZE_NO_VOICE_LINE_ERROR = 'VOICE_OPTIMIZE_NO_VOICE_LINE'
export const VOICE_OPTIMIZE_EMPTY_TEXT_ERROR = 'VOICE_OPTIMIZE_EMPTY_TEXT'
export const VOICE_OPTIMIZE_EMPTY_SPEAKER_ERROR = 'VOICE_OPTIMIZE_EMPTY_SPEAKER'

type JsonRecord = Record<string, unknown>

type VoiceLineRecord = Awaited<ReturnType<typeof loadVoiceLineForEpisode>>

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

function parseVoiceOptimizePayload(job: Job<TaskJobData>) {
  const payload = asJsonRecord(job.data.payload) || {}
  const episodeId = readString(payload.episodeId) || readString(job.data.episodeId) || null
  const editorProjectId = readString(payload.editorProjectId)
    || (job.data.targetType === 'NovelPromotionEditorProject' ? readString(job.data.targetId) : null)
  const voiceLineId = readString(payload.voiceLineId)
  const selectedElementId = readString(payload.selectedElementId)
  const contentExplicit = Object.prototype.hasOwnProperty.call(payload, 'content') || Object.prototype.hasOwnProperty.call(payload, 'text')
  const speakerExplicit = Object.prototype.hasOwnProperty.call(payload, 'speaker')
  const content = readString(payload.content) || readString(payload.text)
  const speaker = readString(payload.speaker)
  const audioModel = readString(payload.audioModel) || undefined
  const speed = readPositiveNumber(payload.speed)
  const maxSeconds = readPositiveNumber(payload.maxSeconds)

  if (!episodeId) throw new Error('episodeId is required')
  if (!editorProjectId) throw new Error('editorProjectId is required')
  if (!voiceLineId) throw new Error('voiceLineId is required')

  return {
    episodeId,
    editorProjectId,
    voiceLineId,
    selectedElementId,
    content,
    speaker,
    contentExplicit,
    speakerExplicit,
    audioModel,
    speed,
    maxSeconds,
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

async function loadVoiceLineForEpisode(voiceLineId: string, episodeId: string) {
  return await prisma.novelPromotionVoiceLine.findFirst({
    where: {
      id: voiceLineId,
      episodeId,
    },
    select: {
      id: true,
      episodeId: true,
      speaker: true,
      content: true,
      emotionPrompt: true,
      emotionStrength: true,
      audioDuration: true,
      audioMediaId: true,
      audioMedia: {
        select: {
          id: true,
          durationMs: true,
        },
      },
    },
  })
}

function resolveOptimizedLine(params: {
  voiceLine: NonNullable<VoiceLineRecord>
  content?: string | null
  speaker?: string | null
  contentExplicit?: boolean
  speakerExplicit?: boolean
}) {
  const content = params.contentExplicit
    ? (params.content || '').trim()
    : (params.content || params.voiceLine.content || '').trim()
  const speaker = params.speakerExplicit
    ? (params.speaker || '').trim()
    : (params.speaker || params.voiceLine.speaker || '').trim()
  if (!content) throw new Error(VOICE_OPTIMIZE_EMPTY_TEXT_ERROR)
  if (!speaker) throw new Error(VOICE_OPTIMIZE_EMPTY_SPEAKER_ERROR)
  return { content, speaker }
}

export function buildVoiceOptimizeProject(params: {
  currentProjectData: unknown
  voiceLineId: string
  selectedElementId?: string | null
  audioMediaObjectId: string
  durationSeconds: number
  speed?: number | null
  content?: string | null
  speaker?: string | null
}) {
  return replaceVoiceOptimizeAudioElement({
    projectData: params.currentProjectData as Parameters<typeof replaceVoiceOptimizeAudioElement>[0]['projectData'],
    voiceLineId: params.voiceLineId,
    selectedElementId: params.selectedElementId,
    audioMediaObjectId: params.audioMediaObjectId,
    durationSeconds: params.speed && params.speed > 0
      ? params.durationSeconds / params.speed
      : params.durationSeconds,
    speed: params.speed,
    content: params.content,
    speaker: params.speaker,
  })
}

async function persistVoiceOptimizedProjectWithVersionRetry(params: {
  job: Job<TaskJobData>
  episodeId: string
  editorProjectId: string
  initialVersion: number
  initialProjectData: unknown
  voiceLineId: string
  selectedElementId?: string | null
  audioMediaObjectId: string
  durationSeconds: number
  speed?: number | null
  content: string
  speaker: string
}) {
  let expectedVersion = params.initialVersion
  let currentProjectData = params.initialProjectData

  for (let attempt = 1; attempt <= MAX_VOICE_OPTIMIZE_MERGE_RETRIES; attempt += 1) {
    const buildResult = buildVoiceOptimizeProject({
      currentProjectData,
      voiceLineId: params.voiceLineId,
      selectedElementId: params.selectedElementId,
      audioMediaObjectId: params.audioMediaObjectId,
      durationSeconds: params.durationSeconds,
      speed: params.speed,
      content: params.content,
      speaker: params.speaker,
    })

    await assertTaskActive(params.job, 'voice_optimize_persist_editor_project')
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

  throw new Error(`VOICE_OPTIMIZE_PROJECT_VERSION_CONFLICT: failed after ${MAX_VOICE_OPTIMIZE_MERGE_RETRIES} retries`)
}

export async function handleEditorVoiceOptimizeTask(job: Job<TaskJobData>) {
  const payload = parseVoiceOptimizePayload(job)

  await reportTaskProgress(job, 15, { stage: 'voice_optimize_load_context' })

  const [editorProject, voiceLine] = await Promise.all([
    loadEditorProject(payload.editorProjectId, payload.episodeId),
    loadVoiceLineForEpisode(payload.voiceLineId, payload.episodeId),
  ])
  if (!editorProject) throw new Error('EDITOR_PROJECT_NOT_FOUND')
  if (!voiceLine) throw new Error(VOICE_OPTIMIZE_NO_VOICE_LINE_ERROR)

  const optimizedLine = resolveOptimizedLine({
    voiceLine,
    content: payload.content,
    speaker: payload.speaker,
    contentExplicit: payload.contentExplicit,
    speakerExplicit: payload.speakerExplicit,
  })

  await reportTaskProgress(job, 45, {
    stage: 'voice_optimize_generate_audio',
    voiceLineId: voiceLine.id,
  })

  const generated = await synthesizeVoiceLineAudio({
    projectId: job.data.projectId,
    episodeId: payload.episodeId,
    lineId: `${voiceLine.id}-${job.data.taskId}`,
    userId: job.data.userId,
    speaker: optimizedLine.speaker,
    text: optimizedLine.content,
    emotionPrompt: voiceLine.emotionPrompt,
    emotionStrength: voiceLine.emotionStrength,
    audioModel: payload.audioModel,
    storageKeyPrefix: 'editor/voice-optimize',
  })

  const audioMedia = await ensureMediaObjectFromStorageKey(generated.storageKey, {
    mimeType: 'audio/wav',
    sizeBytes: generated.sizeBytes,
    durationMs: generated.audioDuration || undefined,
  })

  const durationSeconds = generated.audioDurationSeconds || ((generated.audioDuration || 0) / 1000)
  const actualSeconds = Math.max(MIN_BILLING_SECONDS, Math.ceil(durationSeconds))
  const frozenSeconds = payload.maxSeconds ? Math.ceil(payload.maxSeconds) : null
  if (frozenSeconds !== null && actualSeconds > frozenSeconds) {
    throw new Error('VOICE_OPTIMIZE_BILLING_FREEZE_UNDERESTIMATED')
  }

  await prisma.novelPromotionEditorAsset.create({
    data: {
      editorProjectId: payload.editorProjectId,
      mediaObjectId: audioMedia.id,
      type: 'AUDIO',
      sourceType: 'AI_ENHANCED',
      metadata: {
        voiceLineId: voiceLine.id,
        originalAudioMediaId: voiceLine.audioMediaId || voiceLine.audioMedia?.id || null,
        content: optimizedLine.content,
        speaker: optimizedLine.speaker,
        speed: payload.speed || null,
        taskId: job.data.taskId,
      },
    },
  })

  await reportTaskProgress(job, 75, {
    stage: 'voice_optimize_replace_timeline_audio',
    mediaObjectId: audioMedia.id,
  })

  const replacement = await persistVoiceOptimizedProjectWithVersionRetry({
    job,
    episodeId: payload.episodeId,
    editorProjectId: payload.editorProjectId,
    initialVersion: editorProject.version,
    initialProjectData: editorProject.projectData,
    voiceLineId: voiceLine.id,
    selectedElementId: payload.selectedElementId,
    audioMediaObjectId: audioMedia.id,
    durationSeconds,
    speed: payload.speed,
    content: optimizedLine.content,
    speaker: optimizedLine.speaker,
  })

  await reportTaskProgress(job, 95, {
    stage: 'voice_optimize_completed',
    voiceLineId: voiceLine.id,
    mediaObjectId: audioMedia.id,
    actualSeconds,
  })

  return {
    success: true,
    editorProjectId: payload.editorProjectId,
    episodeId: payload.episodeId,
    voiceLineId: voiceLine.id,
    replacedElementId: replacement.replacedElementId,
    audioMediaObjectId: audioMedia.id,
    audioDurationSeconds: durationSeconds,
    actualSeconds,
    actualQuantity: actualSeconds,
    content: optimizedLine.content,
    speaker: optimizedLine.speaker,
    estimatedMaxSeconds: estimateVoiceLineMaxSeconds(optimizedLine.content),
  }
}
