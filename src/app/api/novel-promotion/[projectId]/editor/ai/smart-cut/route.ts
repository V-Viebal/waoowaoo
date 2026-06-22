import { TASK_TYPE } from '@/lib/task/types'
import { BILLING_ITEM } from '@/lib/billing/items'
import { createEditorAiRoute } from '../_shared'

export const POST = createEditorAiRoute({
  taskType: TASK_TYPE.EDITOR_AI_SMART_CUT,
  action: 'smart-cut',
  billingItem: BILLING_ITEM.EDITOR_SMART_CUT,
})
