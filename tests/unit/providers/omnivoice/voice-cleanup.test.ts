import { describe, it, expect } from 'vitest'
import {
  isOmnivoiceManagedVoiceBinding,
  collectOmnivoiceManagedVoiceIds,
} from '@/lib/providers/omnivoice/voice-cleanup'

describe('isOmnivoiceManagedVoiceBinding', () => {
  it('accepts omnivoice-clone voiceType', () => {
    expect(isOmnivoiceManagedVoiceBinding({ voiceId: 'p1', voiceType: 'omnivoice-clone' })).toBe(true)
  })
  it('accepts omnivoice-design voiceType', () => {
    expect(isOmnivoiceManagedVoiceBinding({ voiceId: 'p1', voiceType: 'omnivoice-design' })).toBe(true)
  })
  it('rejects qwen-designed', () => {
    expect(isOmnivoiceManagedVoiceBinding({ voiceId: 'q', voiceType: 'qwen-designed' })).toBe(false)
  })
  it('rejects custom (fal)', () => {
    expect(isOmnivoiceManagedVoiceBinding({ voiceId: 'x', voiceType: 'custom' })).toBe(false)
  })
  it('rejects empty voiceId', () => {
    expect(isOmnivoiceManagedVoiceBinding({ voiceId: '', voiceType: 'omnivoice-clone' })).toBe(false)
  })
})

describe('collectOmnivoiceManagedVoiceIds', () => {
  it('dedupes and filters non-omnivoice', () => {
    const ids = collectOmnivoiceManagedVoiceIds([
      { voiceId: 'a', voiceType: 'omnivoice-clone' },
      { voiceId: 'a', voiceType: 'omnivoice-clone' },
      { voiceId: 'b', voiceType: 'omnivoice-design' },
      { voiceId: 'q', voiceType: 'qwen-designed' },
      { voiceId: '', voiceType: 'omnivoice-clone' },
    ])
    expect(ids).toEqual(['a', 'b'])
  })
})
