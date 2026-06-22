import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { TASK_TYPE } from '@/lib/task/types'
import { estimateVoiceLineMaxSeconds } from '@/lib/voice/generate-voice-line'
import { createEditorAiRoute, readVoiceOptimizeBillingSeconds } from '../_shared'

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readPositiveNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function hasOwn(body: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key)
}

function readExplicitString(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!hasOwn(body, key)) return undefined
  const value = body[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function buildStableVoiceOptimizeDedupeKey(input: {
  editorProjectId: string
  body: Record<string, unknown>
}) {
  const selectedElementId = readString(input.body.selectedElementId) || 'no-element'
  const content = typeof input.body.content === 'string'
    ? input.body.content.trim()
    : (typeof input.body.text === 'string' ? input.body.text.trim() : '')
  const speaker = typeof input.body.speaker === 'string' ? input.body.speaker.trim() : ''
  const speed = readPositiveNumber(input.body.speed) || 1
  const contentHash = createHash('sha1')
    .update(content)
    .digest('hex')
    .slice(0, 16)
  const speakerHash = createHash('sha1')
    .update(speaker)
    .digest('hex')
    .slice(0, 12)
  return `editor-ai:voice-optimize:${input.editorProjectId}:${selectedElementId}:${contentHash}:${speakerHash}:${speed}`
}

export const POST = createEditorAiRoute({
  taskType: TASK_TYPE.EDITOR_AI_VOICE_OPTIMIZE,
  action: 'voice-optimize',
  billingQuantity: readVoiceOptimizeBillingSeconds,
  dedupeKey: ({ editorProjectId, body }) => buildStableVoiceOptimizeDedupeKey({ editorProjectId, body }),
  beforeSubmit: async ({ episodeId, body }) => {
    const voiceLineId = readString(body.voiceLineId)
    if (!voiceLineId) {
      throw new ApiError('INVALID_PARAMS', { message: 'voiceLineId is required' })
    }

    const voiceLine = await prisma.novelPromotionVoiceLine.findFirst({
      where: {
        id: voiceLineId,
        episodeId,
      },
      select: {
        id: true,
        content: true,
        audioDuration: true,
        audioMedia: { select: { durationMs: true } },
      },
    })
    if (!voiceLine) {
      throw new ApiError('INVALID_PARAMS', { message: 'VOICE_OPTIMIZE_NO_VOICE_LINE' })
    }

    const explicitContent = readExplicitString(body, 'content')
    const explicitText = readExplicitString(body, 'text')
    const explicitSpeaker = readExplicitString(body, 'speaker')
    if (explicitContent === null || explicitText === null) {
      throw new ApiError('INVALID_PARAMS', { message: 'VOICE_OPTIMIZE_EMPTY_TEXT' })
    }
    if (explicitSpeaker === null) {
      throw new ApiError('INVALID_PARAMS', { message: 'VOICE_OPTIMIZE_EMPTY_SPEAKER' })
    }

    const content = explicitContent ?? explicitText ?? voiceLine.content ?? ''
    if (!content.trim()) {
      throw new ApiError('INVALID_PARAMS', { message: 'VOICE_OPTIMIZE_EMPTY_TEXT' })
    }

    const clientDurationSeconds = readPositiveNumber(body.durationSeconds)
    const clientMaxSeconds = readPositiveNumber(body.maxSeconds)
    const dbDurationSeconds = (voiceLine.audioDuration && voiceLine.audioDuration > 0 ? voiceLine.audioDuration / 1000 : null)
      || (voiceLine.audioMedia?.durationMs && voiceLine.audioMedia.durationMs > 0 ? voiceLine.audioMedia.durationMs / 1000 : null)
    const estimatedMaxSeconds = estimateVoiceLineMaxSeconds(content)
    const maxSeconds = Math.max(
      1,
      Math.ceil(clientDurationSeconds || 0),
      Math.ceil(clientMaxSeconds || 0),
      Math.ceil(dbDurationSeconds || 0),
      Math.ceil(estimatedMaxSeconds),
    )

    return {
      body: {
        voiceLineId,
        content,
        durationSeconds: maxSeconds,
        maxSeconds,
      },
    }
  },
})
