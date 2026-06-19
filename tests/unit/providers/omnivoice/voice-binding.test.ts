import { describe, it, expect } from 'vitest'
import {
  resolveVoiceBindingForProvider,
  hasAnyVoiceBinding,
  getSpeakerVoicePreviewUrl,
  parseSpeakerVoiceMap,
} from '@/lib/voice/provider-voice-binding'

describe('omnivoice voice binding', () => {
  it('resolves character voiceType=omnivoice-clone to character profileId', () => {
    const r = resolveVoiceBindingForProvider({
      providerKey: 'omnivoice',
      character: { voiceId: 'prof_a', customVoiceUrl: null, voiceType: 'omnivoice-clone' },
      speakerVoice: null,
    } as unknown as Parameters<typeof resolveVoiceBindingForProvider>[0])
    expect(r).toEqual({ provider: 'omnivoice', source: 'character', profileId: 'prof_a' })
  })

  it('falls back to speakerVoice when character has no omnivoice voiceId', () => {
    const r = resolveVoiceBindingForProvider({
      providerKey: 'omnivoice',
      character: { voiceId: null, customVoiceUrl: null },
      speakerVoice: {
        provider: 'omnivoice',
        voiceType: 'omnivoice-design',
        profileId: 'prof_b',
      },
    })
    expect(r).toEqual({ provider: 'omnivoice', source: 'speaker', profileId: 'prof_b' })
  })

  it('returns null when speakerVoice provider mismatches', () => {
    const r = resolveVoiceBindingForProvider({
      providerKey: 'omnivoice',
      character: null,
      speakerVoice: { provider: 'fal', voiceType: 'uploaded', audioUrl: 'http://x' },
    })
    expect(r).toBeNull()
  })

  it('hasAnyVoiceBinding returns true for omnivoice speakerVoice', () => {
    expect(hasAnyVoiceBinding({
      character: null,
      speakerVoice: { provider: 'omnivoice', voiceType: 'omnivoice-clone', profileId: 'prof_c' },
    })).toBe(true)
  })

  it('getSpeakerVoicePreviewUrl returns previewAudioUrl for omnivoice', () => {
    expect(getSpeakerVoicePreviewUrl({
      provider: 'omnivoice',
      voiceType: 'omnivoice-design',
      profileId: 'p',
      previewAudioUrl: 'http://prev',
    })).toBe('http://prev')
  })

  it('parseSpeakerVoiceMap parses provider=omnivoice entries', () => {
    const map = parseSpeakerVoiceMap(JSON.stringify({
      旁白: { provider: 'omnivoice', voiceType: 'omnivoice-design', profileId: 'p1', previewAudioUrl: 'u' },
    }))
    expect(map['旁白']).toEqual({
      provider: 'omnivoice',
      voiceType: 'omnivoice-design',
      profileId: 'p1',
      previewAudioUrl: 'u',
    })
  })

  it('parseSpeakerVoiceMap rejects omnivoice entry without profileId', () => {
    expect(() => parseSpeakerVoiceMap(JSON.stringify({
      旁白: { provider: 'omnivoice', voiceType: 'omnivoice-design' },
    }))).toThrow(/SPEAKER_VOICE_ENTRY_INVALID_OMNIVOICE_PROFILE_ID/)
  })
})
