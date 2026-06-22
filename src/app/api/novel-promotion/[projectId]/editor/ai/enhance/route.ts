import { TASK_TYPE } from '@/lib/task/types'
import { createEditorAiRoute, readEnhanceBillingSeconds } from '../_shared'

export const POST = createEditorAiRoute({
  taskType: TASK_TYPE.EDITOR_AI_ENHANCE,
  action: 'enhance',
  billingQuantity: readEnhanceBillingSeconds,
})
