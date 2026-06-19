import { describe, it, expect, vi, beforeEach } from 'vitest'

// 仅 mock generateSpeech;OmniVoiceError 走真实导出
vi.mock('@/lib/providers/omnivoice/client', () => ({
  getOmnivoiceClient: vi.fn(),
}))

import { getOmnivoiceClient } from '@/lib/providers/omnivoice/client'
import { synthesizeWithOmnivoiceTTS } from '@/lib/providers/omnivoice/tts'
import { buildOmniVoiceError } from './_helpers'

describe('synthesizeWithOmnivoiceTTS', () => {
  const mockGenerateSpeech = vi.fn()
  beforeEach(() => {
    mockGenerateSpeech.mockReset()
    ;(getOmnivoiceClient as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      design: { generateSpeech: mockGenerateSpeech },
    })
  })

  it('passes params and returns audio buffer + duration', async () => {
    const audio = new Uint8Array([0x52, 0x49, 0x46, 0x46]) // RIFF
    mockGenerateSpeech.mockResolvedValue({
      audio,
      audioId: 'aud_1',
      audioPath: '/x',
      audioDurationSec: 3.21,
      generationTimeSec: 1,
      seed: 42,
      contentType: 'audio/wav',
      routingStatus: null,
      routingReason: null,
    })

    const r = await synthesizeWithOmnivoiceTTS({
      text: '你好',
      profileId: 'prof_abc',
      language: 'zh',
    })

    expect(mockGenerateSpeech).toHaveBeenCalledWith(expect.objectContaining({
      text: '你好',
      profileId: 'prof_abc',
      language: 'zh',
      numStep: 16,
    }))
    expect(r.success).toBe(true)
    expect(Buffer.isBuffer(r.audioData)).toBe(true)
    expect(r.audioDuration).toBe(3210)
    expect(r.requestId).toBe('aud_1')
  })

  it('defaults language to Auto', async () => {
    mockGenerateSpeech.mockResolvedValue({
      audio: new Uint8Array(4),
      audioId: 'a',
      audioPath: 'p',
      audioDurationSec: 1,
      generationTimeSec: 1,
      seed: 0,
      contentType: 'audio/wav',
      routingStatus: null,
      routingReason: null,
    })
    await synthesizeWithOmnivoiceTTS({ text: 't', profileId: 'p' })
    expect(mockGenerateSpeech).toHaveBeenCalledWith(expect.objectContaining({ language: 'Auto' }))
  })

  it('returns mapped error on OmniVoiceError 404', async () => {
    mockGenerateSpeech.mockRejectedValue(buildOmniVoiceError(404, { detail: 'gone' }, 'gone'))
    const r = await synthesizeWithOmnivoiceTTS({ text: 't', profileId: 'p' })
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('OMNIVOICE_PROFILE_NOT_FOUND')
  })

  it('returns mapped error on network failure', async () => {
    mockGenerateSpeech.mockRejectedValue(new TypeError('fetch failed'))
    const r = await synthesizeWithOmnivoiceTTS({ text: 't', profileId: 'p' })
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('OMNIVOICE_BACKEND_UNREACHABLE')
  })
})
