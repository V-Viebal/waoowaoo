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

export const POST = createEditorAiRoute({
  taskType: TASK_TYPE.EDITOR_AI_VOICE_OPTIMIZE,
  action: 'voice-optimize',
  billingQuantity: readVoiceOptimizeBillingSeconds,
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

    const content = readString(body.content) || voiceLine.content || ''
    if (!content.trim()) {
      throw new ApiError('INVALID_PARAMS', { message: 'VOICE_OPTIMIZE_EMPTY_TEXT' })
    }

    const durationSeconds = readPositiveNumber(body.durationSeconds)
      || readPositiveNumber(body.maxSeconds)
      || (voiceLine.audioDuration && voiceLine.audioDuration > 0 ? voiceLine.audioDuration / 1000 : null)
      || (voiceLine.audioMedia?.durationMs && voiceLine.audioMedia.durationMs > 0 ? voiceLine.audioMedia.durationMs / 1000 : null)
      || estimateVoiceLineMaxSeconds(content)

    return {
      body: {
        voiceLineId,
        durationSeconds,
        maxSeconds: Math.max(1, Math.ceil(durationSeconds)),
      },
    }
  },
})
