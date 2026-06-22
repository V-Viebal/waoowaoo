import { TASK_TYPE } from '@/lib/task/types'
import { BILLING_ITEM } from '@/lib/billing/items'
import { createEditorAiRoute, readCaptionBillingMinutes } from '../_shared'

export const POST = createEditorAiRoute({
  taskType: TASK_TYPE.EDITOR_AI_CAPTION,
  action: 'caption',
  billingItem: BILLING_ITEM.EDITOR_CAPTION_GENERATE,
  billingQuantity: readCaptionBillingMinutes,
})
