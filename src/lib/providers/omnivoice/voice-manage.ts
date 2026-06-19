import { OmniVoiceError } from '@omnivoice/sdk'
import { getOmnivoiceClient } from './client'
import { mapOmnivoiceError } from './error-mapping'

export async function deleteOmnivoiceVoice(profileId: string): Promise<void> {
  const id = profileId?.trim() ?? ''
  if (!id) {
    throw new Error('OMNIVOICE_PROFILE_ID_REQUIRED')
  }
  const ov = getOmnivoiceClient()
  try {
    await ov.design.deleteProfile(id)
  } catch (err) {
    if (err instanceof OmniVoiceError && err.status === 404) return
    const mapped = mapOmnivoiceError(err)
    throw new Error(`${mapped.errorCode}: ${mapped.error}`)
  }
}
