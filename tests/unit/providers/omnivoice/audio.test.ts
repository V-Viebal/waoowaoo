import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/providers/omnivoice/tts', () => ({
  synthesizeWithOmnivoiceTTS: vi.fn(),
}))

import { synthesizeWithOmnivoiceTTS } from '@/lib/providers/omnivoice/tts'
import { generateOmnivoiceAudio } from '@/lib/providers/omnivoice/audio'

describe('generateOmnivoiceAudio', () => {
  beforeEach(() => {
    ;(synthesizeWithOmnivoiceTTS as unknown as { mockReset: () => void }).mockReset()
  })

  it('throws when voice (profileId) missing', async () => {
    await expect(generateOmnivoiceAudio({
      userId: 'u',
      text: 'hi',
      voice: '',
      options: { provider: 'omnivoice', modelId: 'omnivoice-tts-v1', modelKey: 'omnivoice:omnivoice-tts-v1' },
    })).rejects.toThrow(/OMNIVOICE_PROFILE_ID_REQUIRED/)
  })

  it('returns base64 data url on success', async () => {
    ;(synthesizeWithOmnivoiceTTS as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: true,
      audioData: Buffer.from([1, 2, 3]),
      audioDuration: 100,
      requestId: 'r1',
    })
    const r = await generateOmnivoiceAudio({
      userId: 'u',
      text: 'hi',
      voice: 'prof_x',
      options: { provider: 'omnivoice', modelId: 'omnivoice-tts-v1', modelKey: 'omnivoice:omnivoice-tts-v1' },
    })
    expect(r.success).toBe(true)
    expect(r.audioUrl?.startsWith('data:audio/wav;base64,')).toBe(true)
    expect(r.requestId).toBe('r1')
  })

  it('throws on synthesize failure', async () => {
    ;(synthesizeWithOmnivoiceTTS as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: false,
      error: 'down',
      errorCode: 'OMNIVOICE_BACKEND_ERROR',
    })
    await expect(generateOmnivoiceAudio({
      userId: 'u',
      text: 'hi',
      voice: 'prof_x',
      options: { provider: 'omnivoice', modelId: 'omnivoice-tts-v1', modelKey: 'omnivoice:omnivoice-tts-v1' },
    })).rejects.toThrow(/OMNIVOICE_BACKEND_ERROR/)
  })
})
