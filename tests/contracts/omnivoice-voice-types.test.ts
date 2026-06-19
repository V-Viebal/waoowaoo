import { describe, it, expect } from 'vitest'
import type { OfficialProviderKey } from '@/lib/providers/official/model-registry'
import { isOmnivoiceManagedVoiceBinding } from '@/lib/providers/omnivoice'
import { resolveVoiceBindingForProvider, parseSpeakerVoiceMap } from '@/lib/voice/provider-voice-binding'

describe('OmniVoice 契约', () => {
  it('OfficialProviderKey 包含 omnivoice', () => {
    const allowed: OfficialProviderKey[] = ['bailian', 'siliconflow', 'starrouter', 'omnivoice']
    expect(allowed).toContain('omnivoice')
  })

  describe('voiceType "omnivoice-clone" is recognized by every consumer', () => {
    const voiceType = 'omnivoice-clone'
    const voiceId = 'prof_clone_1'

    it('isOmnivoiceManagedVoiceBinding accepts it', () => {
      expect(isOmnivoiceManagedVoiceBinding({ voiceId, voiceType })).toBe(true)
    })

    it('resolveVoiceBindingForProvider routes character to omnivoice provider', () => {
      const r = resolveVoiceBindingForProvider({
        providerKey: 'omnivoice',
        character: { voiceId, voiceType, customVoiceUrl: null },
        speakerVoice: null,
      })
      expect(r).toEqual({ provider: 'omnivoice', source: 'character', profileId: voiceId })
    })

    it('bailian guard rejects it', () => {
      const r = resolveVoiceBindingForProvider({
        providerKey: 'bailian',
        character: { voiceId, voiceType, customVoiceUrl: null },
        speakerVoice: null,
      })
      expect(r).toBeNull()
    })
  })

  describe('voiceType "omnivoice-design" is recognized by every consumer', () => {
    const voiceType = 'omnivoice-design'
    const voiceId = 'prof_design_1'

    it('isOmnivoiceManagedVoiceBinding accepts it', () => {
      expect(isOmnivoiceManagedVoiceBinding({ voiceId, voiceType })).toBe(true)
    })

    it('resolveVoiceBindingForProvider routes character to omnivoice provider', () => {
      const r = resolveVoiceBindingForProvider({
        providerKey: 'omnivoice',
        character: { voiceId, voiceType, customVoiceUrl: null },
        speakerVoice: null,
      })
      expect(r).toEqual({ provider: 'omnivoice', source: 'character', profileId: voiceId })
    })

    it('parseSpeakerVoiceMap accepts it as a speakerVoice entry', () => {
      const map = parseSpeakerVoiceMap(JSON.stringify({
        '旁白': { provider: 'omnivoice', voiceType, profileId: voiceId },
      }))
      expect(map['旁白']).toEqual({ provider: 'omnivoice', voiceType, profileId: voiceId })
    })
  })
})
