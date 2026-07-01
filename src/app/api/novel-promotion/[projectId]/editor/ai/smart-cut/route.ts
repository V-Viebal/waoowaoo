import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { TASK_TYPE } from '@/lib/task/types'
import { createEditorAiRoute } from '../_shared'

const SMART_CUT_NO_VIDEO_PANELS_ERROR = 'SMART_CUT_NO_VIDEO_PANELS'
const MAX_PANEL_IDS = 500

function readPanelIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (value.length > MAX_PANEL_IDS) {
    throw new ApiError('INVALID_PARAMS', { message: 'SMART_CUT_TOO_MANY_PANEL_IDS' })
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

export const POST = createEditorAiRoute({
  taskType: TASK_TYPE.EDITOR_AI_SMART_CUT,
  action: 'smart-cut',
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
