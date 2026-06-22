import { TASK_TYPE } from '@/lib/task/types'
import { createEditorAiRoute, readVoiceOptimizeBillingSeconds } from '../_shared'

export const POST = createEditorAiRoute({
  taskType: TASK_TYPE.EDITOR_AI_VOICE_OPTIMIZE,
  action: 'voice-optimize',
  billingQuantity: readVoiceOptimizeBillingSeconds,
})
