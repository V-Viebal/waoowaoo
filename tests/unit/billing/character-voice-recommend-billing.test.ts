import { describe, it, expect } from 'vitest'
import { buildDefaultTaskBillingInfo, isBillableTaskType } from '@/lib/billing/task-policy'
import { TASK_TYPE } from '@/lib/task/types'

describe('CHARACTER_VOICE_RECOMMEND billing', () => {
  it('is a billable task type', () => {
    expect(isBillableTaskType(TASK_TYPE.CHARACTER_VOICE_RECOMMEND)).toBe(true)
  })

  it('produces a billable text-task billing info when a model is present', () => {
    const info = buildDefaultTaskBillingInfo(TASK_TYPE.CHARACTER_VOICE_RECOMMEND, {
      analysisModel: 'bailian::qwen3.5-plus',
    })
    expect(info).not.toBeNull()
    expect(info?.billable).toBe(true)
    if (info?.billable) {
      expect(info.apiType).toBe('text')
    }
  })

  it('returns null billing info when no model is present (text-task contract)', () => {
    const info = buildDefaultTaskBillingInfo(TASK_TYPE.CHARACTER_VOICE_RECOMMEND, {})
    expect(info).toBeNull()
  })
})
