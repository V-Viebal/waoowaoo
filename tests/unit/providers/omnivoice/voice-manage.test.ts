import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildOmniVoiceError } from './_helpers'

vi.mock('@/lib/providers/omnivoice/client', () => ({
  getOmnivoiceClient: vi.fn(),
}))

import { getOmnivoiceClient } from '@/lib/providers/omnivoice/client'
import { deleteOmnivoiceVoice } from '@/lib/providers/omnivoice/voice-manage'

describe('deleteOmnivoiceVoice', () => {
  const deleteProfile = vi.fn()
  beforeEach(() => {
    deleteProfile.mockReset()
    ;(getOmnivoiceClient as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      design: { deleteProfile },
    })
  })

  it('calls deleteProfile with profileId', async () => {
    deleteProfile.mockResolvedValue(undefined)
    await deleteOmnivoiceVoice('prof_1')
    expect(deleteProfile).toHaveBeenCalledWith('prof_1')
  })

  it('treats 404 as success', async () => {
    deleteProfile.mockRejectedValue(buildOmniVoiceError(404, { detail: 'not found' }, 'not found'))
    await expect(deleteOmnivoiceVoice('prof_dead')).resolves.toBeUndefined()
  })

  it('rethrows on non-404 errors', async () => {
    deleteProfile.mockRejectedValue(buildOmniVoiceError(500, null, 'down'))
    await expect(deleteOmnivoiceVoice('prof_x')).rejects.toThrow(/OMNIVOICE_BACKEND_ERROR/)
  })

  it('throws on empty profileId', async () => {
    await expect(deleteOmnivoiceVoice('')).rejects.toThrow(/OMNIVOICE_PROFILE_ID_REQUIRED/)
    expect(deleteProfile).not.toHaveBeenCalled()
  })
})
