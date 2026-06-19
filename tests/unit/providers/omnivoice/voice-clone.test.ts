import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/providers/omnivoice/client', () => ({
  getOmnivoiceClient: vi.fn(),
}))

import { getOmnivoiceClient } from '@/lib/providers/omnivoice/client'
import { createOmnivoiceClone, buildOmnivoiceProfileName } from '@/lib/providers/omnivoice/voice-clone'
import { buildOmniVoiceError } from './_helpers'

describe('createOmnivoiceClone', () => {
  const createProfile = vi.fn()
  beforeEach(() => {
    createProfile.mockReset()
    ;(getOmnivoiceClient as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      design: { createProfile },
    })
  })

  it('builds prefixed profile name and calls createProfile clone kind', async () => {
    createProfile.mockResolvedValue({ id: 'prof_xyz', name: 'vv_u123abcd_Carla', kind: 'clone' })
    const refAudio = new Uint8Array([1, 2, 3])
    const r = await createOmnivoiceClone({
      name: 'Carla',
      refAudio,
      refAudioFilename: 'r.wav',
      language: 'English',
      userId: 'u123abcdef',
    })
    expect(r.success).toBe(true)
    expect(r.profileId).toBe('prof_xyz')
    expect(createProfile).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'clone',
      name: 'vv_u123abcd_Carla',
      refAudio,
      refAudioFilename: 'r.wav',
      language: 'English',
    }))
  })

  it('rejects empty name', async () => {
    const r = await createOmnivoiceClone({
      name: '',
      refAudio: new Uint8Array(1),
      refAudioFilename: 'r.wav',
      userId: 'u',
    })
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('OMNIVOICE_NAME_REQUIRED')
  })

  it('maps OmniVoice 400 error to OMNIVOICE_INVALID_PARAMS', async () => {
    createProfile.mockRejectedValue(buildOmniVoiceError(400, { detail: 'short clip' }, 'short clip'))
    const r = await createOmnivoiceClone({
      name: 'X',
      refAudio: new Uint8Array(1),
      refAudioFilename: 'r.wav',
      userId: 'u',
    })
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('OMNIVOICE_INVALID_PARAMS')
  })
})

describe('buildOmnivoiceProfileName', () => {
  it('uses first 8 chars of userId as prefix', () => {
    expect(buildOmnivoiceProfileName('u123abcdef9999', 'Hero')).toBe('vv_u123abcd_Hero')
  })
  it('handles short userId', () => {
    expect(buildOmnivoiceProfileName('abc', 'X')).toBe('vv_abc_X')
  })
})
