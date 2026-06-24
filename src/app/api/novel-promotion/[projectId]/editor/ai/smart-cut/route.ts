import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { TASK_TYPE } from '@/lib/task/types'
import { BILLING_ITEM } from '@/lib/billing/items'
import { createEditorAiRoute } from '../_shared'

const SMART_CUT_NO_VIDEO_PANELS_ERROR = 'SMART_CUT_NO_VIDEO_PANELS'

function readPanelIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

export const POST = createEditorAiRoute({
  taskType: TASK_TYPE.EDITOR_AI_SMART_CUT,
  action: 'smart-cut',
  billingItem: BILLING_ITEM.EDITOR_SMART_CUT,
  beforeSubmit: async ({ episodeId, body }) => {
    const panelIds = readPanelIds(body.panelIds)
    const panelCount = await prisma.novelPromotionPanel.count({
      where: {
        videoMediaId: { not: null },
        storyboard: { episodeId },
        ...(panelIds ? { id: { in: panelIds } } : {}),
      },
    })

    if (panelCount === 0) {
      throw new ApiError('INVALID_PARAMS', {
        message: SMART_CUT_NO_VIDEO_PANELS_ERROR,
      })
    }
  },
})
