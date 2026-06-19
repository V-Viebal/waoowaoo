import { describe, it, expect } from 'vitest'
import { buildDefaultTaskBillingInfo } from '@/lib/billing/task-policy'
import { TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'

function expectBillable(info: TaskBillingInfo | null): Extract<TaskBillingInfo, { billable: true }> {
  expect(info).not.toBeNull()
  expect(info?.billable).toBe(true)
  if (!info || !info.billable) {
    throw new Error('Expected billable task billing info')
  }
  return info
}

describe('voice-design billing model name', () => {
  it('marks bailian when provider is bailian', () => {
    const info = expectBillable(buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_DESIGN, { provider: 'bailian' }))
    expect(info.model).toBe('bailian-voice-design')
  })

  it('marks omnivoice when provider is omnivoice', () => {
    const info = expectBillable(buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_DESIGN, { provider: 'omnivoice' }))
    expect(info.model).toBe('omnivoice-voice-design')
  })

  it('defaults to bailian when provider missing', () => {
    const info = expectBillable(buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_DESIGN, {}))
    expect(info.model).toBe('bailian-voice-design')
  })

  it('cost unchanged across providers (mirrors bailian pricing per spec §5.4)', () => {
    const bailian = expectBillable(buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_DESIGN, { provider: 'bailian' }))
    const omnivoice = expectBillable(buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_DESIGN, { provider: 'omnivoice' }))
    expect(bailian.maxFrozenCost).toBe(omnivoice.maxFrozenCost)
  })

  it('asset-hub variant follows the same dispatch', () => {
    const info = expectBillable(buildDefaultTaskBillingInfo(TASK_TYPE.ASSET_HUB_VOICE_DESIGN, { provider: 'omnivoice' }))
    expect(info.model).toBe('omnivoice-voice-design')
  })
})
