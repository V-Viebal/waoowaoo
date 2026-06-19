import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildOmniVoiceError } from './_helpers'

vi.mock('@/lib/providers/omnivoice/client', () => ({
  getOmnivoiceClient: vi.fn(),
}))

import { getOmnivoiceClient } from '@/lib/providers/omnivoice/client'
import { createOmnivoiceVoiceDesign } from '@/lib/providers/omnivoice/voice-design'

describe('createOmnivoiceVoiceDesign', () => {
  const createProfile = vi.fn()
  const generateSpeech = vi.fn()
  beforeEach(() => {
    createProfile.mockReset()
    generateSpeech.mockReset()
    ;(getOmnivoiceClient as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      design: { createProfile, generateSpeech },
    })
  })

  it('calls createProfile with kind=design, default vdStates, instruct=voicePrompt', async () => {
    createProfile.mockResolvedValue({ id: 'prof_d1', name: 'vv_user1234_X', kind: 'design' })
    generateSpeech.mockResolvedValue({
      audio: new Uint8Array([1, 2, 3, 4]),
      audioId: 'a',
      audioPath: 'p',
      audioDurationSec: 1,
      generationTimeSec: 1,
      seed: 0,
      contentType: 'audio/wav',
      routingStatus: null,
      routingReason: null,
    })

    const r = await createOmnivoiceVoiceDesign({
      voicePrompt: '温暖中年男声',
      previewText: '你好世界',
      preferredName: 'Hero',
      language: 'zh',
      userId: 'user1234ext',
    })

    expect(createProfile).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'design',
      name: 'vv_user1234_Hero',
      vdStates: { Style: 'Auto' },
      instruct: '温暖中年男声',
      language: 'zh',
    }))
    expect(generateSpeech).toHaveBeenCalledWith(expect.objectContaining({
      profileId: 'prof_d1',
      text: '你好世界',
    }))
    expect(r.success).toBe(true)
    expect(r.profileId).toBe('prof_d1')
    expect(typeof r.audioBase64).toBe('string')
    expect(r.audioBase64!.length).toBeGreaterThan(0)
    expect(r.responseFormat).toBe('wav')
  })

  it('rejects empty voicePrompt', async () => {
    const r = await createOmnivoiceVoiceDesign({
      voicePrompt: '',
      previewText: 't',
      userId: 'u',
    })
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('OMNIVOICE_VOICE_PROMPT_REQUIRED')
  })

  it('returns mapped error on createProfile failure', async () => {
    createProfile.mockRejectedValue(buildOmniVoiceError(500, { detail: 'down' }, 'down'))
    const r = await createOmnivoiceVoiceDesign({
      voicePrompt: 'x',
      previewText: 'y',
      userId: 'u',
    })
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('OMNIVOICE_BACKEND_ERROR')
  })
})
