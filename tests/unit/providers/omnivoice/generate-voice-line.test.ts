import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/providers/omnivoice/tts', () => ({
  synthesizeWithOmnivoiceTTS: vi.fn(),
}))
vi.mock('@/lib/storage', () => ({
  uploadObject: vi.fn(async (_buf: Buffer, key: string) => key),
  getSignedUrl: vi.fn((key: string) => `https://signed/${key}`),
  toFetchableUrl: vi.fn((u: string) => u),
  extractStorageKey: vi.fn(() => null),
}))
vi.mock('@/lib/api-config', () => ({
  resolveModelSelectionOrSingle: vi.fn(),
  getProviderKey: vi.fn((p: string) => p?.split(':')[0] ?? ''),
  getProviderConfig: vi.fn(),
  getAudioApiKey: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    novelPromotionVoiceLine: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    novelPromotionProject: { findUnique: vi.fn() },
    novelPromotionEpisode: { findUnique: vi.fn() },
  },
}))

import { generateVoiceLine } from '@/lib/voice/generate-voice-line'
import { synthesizeWithOmnivoiceTTS } from '@/lib/providers/omnivoice/tts'
import { resolveModelSelectionOrSingle } from '@/lib/api-config'
import { prisma } from '@/lib/prisma'

describe('generateVoiceLine — omnivoice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses character.voiceType=omnivoice-clone path', async () => {
    ;(prisma.novelPromotionVoiceLine.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      id: 'line1', episodeId: 'ep1', speaker: 'Hero', content: '你好', emotionPrompt: null, emotionStrength: null,
    })
    ;(prisma.novelPromotionProject.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      characters: [{
        name: 'Hero', voiceId: 'prof_x', voiceType: 'omnivoice-clone', customVoiceUrl: null,
      }],
    })
    ;(prisma.novelPromotionEpisode.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      speakerVoices: null,
    })
    ;(prisma.novelPromotionVoiceLine.update as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({})
    ;(resolveModelSelectionOrSingle as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      provider: 'omnivoice', modelId: 'omnivoice-tts-v1', modelKey: 'omnivoice:omnivoice-tts-v1',
    })
    const audio = Buffer.alloc(44 + 8000)
    audio.write('RIFF', 0)
    audio.write('WAVE', 8)
    ;(synthesizeWithOmnivoiceTTS as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: true, audioData: audio, audioDuration: 1234, requestId: 'r',
    })

    const r = await generateVoiceLine({ projectId: 'pr', lineId: 'line1', userId: 'u' })

    expect(synthesizeWithOmnivoiceTTS).toHaveBeenCalledWith(expect.objectContaining({
      profileId: 'prof_x', text: '你好',
    }))
    expect(r.audioDuration).toBe(1234)
    expect(r.storageKey).toContain('voice/pr/ep1/line1.wav')
  })

  it('throws when omnivoice binding missing', async () => {
    ;(prisma.novelPromotionVoiceLine.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      id: 'line2', episodeId: 'ep1', speaker: 'Hero', content: 'x', emotionPrompt: null, emotionStrength: null,
    })
    ;(prisma.novelPromotionProject.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      characters: [{ name: 'Hero', voiceId: null, voiceType: null, customVoiceUrl: null }],
    })
    ;(prisma.novelPromotionEpisode.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ speakerVoices: null })
    ;(resolveModelSelectionOrSingle as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      provider: 'omnivoice', modelId: 'omnivoice-tts-v1', modelKey: 'omnivoice:omnivoice-tts-v1',
    })

    await expect(generateVoiceLine({ projectId: 'pr', lineId: 'line2', userId: 'u' }))
      .rejects.toThrow(/请先为该发言人绑定 OmniVoice 音色/)
  })
})
