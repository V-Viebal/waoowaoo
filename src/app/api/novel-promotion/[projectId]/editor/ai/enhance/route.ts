import { ApiError } from '@/lib/api-errors'
import { TASK_TYPE } from '@/lib/task/types'
import { createEditorAiRoute, readEnhanceBillingSeconds } from '../_shared'
import { ENHANCE_RESTORE_UNAVAILABLE, ENHANCE_UNSUPPORTED_TYPE, ENHANCE_VIDEO_ELEMENT_NOT_FOUND, findVideoElementInProject } from '@/lib/twick/enhance'

export const POST = createEditorAiRoute({
  taskType: TASK_TYPE.EDITOR_AI_ENHANCE,
  action: 'enhance',
  billingQuantity: readEnhanceBillingSeconds,
  beforeSubmit: async ({ body, editorProject }) => {
    const enhanceType = typeof body.enhanceType === 'string' && body.enhanceType.trim()
      ? body.enhanceType.trim()
      : 'smart_crop'
    if (enhanceType !== 'smart_crop' && enhanceType !== 'restore') {
      throw new ApiError('INVALID_PARAMS', { message: ENHANCE_UNSUPPORTED_TYPE })
    }
    if (enhanceType === 'restore') {
      throw new ApiError('INVALID_PARAMS', { message: ENHANCE_RESTORE_UNAVAILABLE })
    }

    const selectedElementId = typeof body.selectedElementId === 'string' && body.selectedElementId.trim()
      ? body.selectedElementId.trim()
      : null
    const selectedVideo = findVideoElementInProject({
      projectData: editorProject.projectData as unknown as Parameters<typeof findVideoElementInProject>[0]['projectData'],
      selectedElementId,
    })
    if (!selectedVideo) {
      throw new ApiError('INVALID_PARAMS', { message: ENHANCE_VIDEO_ELEMENT_NOT_FOUND })
    }

    return {
      body: {
        enhanceType,
        selectedElementId,
        durationSeconds: Math.max(1, Math.ceil(selectedVideo.durationSeconds || Number(body.durationSeconds) || 1)),
        sourcePanelId: selectedVideo.panelId,
        originalSrc: selectedVideo.src,
      },
    }
  },
})
