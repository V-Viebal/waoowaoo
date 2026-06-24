import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { TASK_TYPE } from '@/lib/task/types'
import { BILLING_ITEM } from '@/lib/billing/items'
import { createEditorAiRoute, readCaptionBillingMinutes } from '../_shared'
import {
  calculateCaptionBillingDurationSeconds,
  toCaptionVoiceLineSources,
} from '@/lib/twick/caption-duration'
import type { TwickTimelineProject } from '@/lib/twick/types'

const CAPTION_NO_VOICE_LINES_ERROR = 'CAPTION_NO_VOICE_LINES'
const MIN_BILLING_MINUTES = 0.01

export const POST = createEditorAiRoute({
  taskType: TASK_TYPE.EDITOR_AI_CAPTION,
  action: 'caption',
  billingItem: BILLING_ITEM.EDITOR_CAPTION_GENERATE,
  billingQuantity: readCaptionBillingMinutes,
  beforeSubmit: async ({ episodeId, editorProject }) => {
    const voiceLines = await prisma.novelPromotionVoiceLine.findMany({
      where: { episodeId },
      select: {
        id: true,
        content: true,
        audioDuration: true,
        audioMedia: {
          select: {
            durationMs: true,
          },
        },
      },
      orderBy: { lineIndex: 'asc' },
    })
    const usableVoiceLines = voiceLines.filter((line) => (
      typeof line.content === 'string' && line.content.trim().length > 0
    ))

    if (usableVoiceLines.length === 0) {
      throw new ApiError('INVALID_PARAMS', {
        message: CAPTION_NO_VOICE_LINES_ERROR,
      })
    }

    const captionSources = toCaptionVoiceLineSources(usableVoiceLines)
    const totalDurationSeconds = calculateCaptionBillingDurationSeconds(
      editorProject.projectData as unknown as TwickTimelineProject,
      captionSources,
    )

    return {
      body: {
        durationMinutes: Math.max(MIN_BILLING_MINUTES, totalDurationSeconds / 60),
      },
    }
  },
})
