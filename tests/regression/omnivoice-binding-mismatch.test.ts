import { describe, it, expect } from 'vitest'
import { resolveVoiceBindingForProvider } from '@/lib/voice/provider-voice-binding'

describe('omnivoice provider 与 voiceType 错配回归', () => {
  it('provider=omnivoice 但 character voiceType=qwen-designed 不返回 character 绑定', () => {
    const r = resolveVoiceBindingForProvider({
      providerKey: 'omnivoice',
      character: { voiceId: 'qwen_v1', voiceType: 'qwen-designed', customVoiceUrl: null },
      speakerVoice: null,
    })
    expect(r).toBeNull()
  })

  it('provider=bailian 但 character voiceType=omnivoice-clone 不被 bailian 路径误用', () => {
    const r = resolveVoiceBindingForProvider({
      providerKey: 'bailian',
      character: { voiceId: 'prof_x', voiceType: 'omnivoice-clone', customVoiceUrl: null },
      speakerVoice: null,
    })
    expect(r).toBeNull()
  })
})
