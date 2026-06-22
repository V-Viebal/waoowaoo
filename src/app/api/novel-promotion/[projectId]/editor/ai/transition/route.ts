import { TASK_TYPE } from '@/lib/task/types'
import { createEditorAiRoute } from '../_shared'

export const POST = createEditorAiRoute({
  taskType: TASK_TYPE.EDITOR_AI_TRANSITION,
  action: 'transition',
})
