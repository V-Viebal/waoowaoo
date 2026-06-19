import { getOmnivoiceClient } from './client'
import { mapOmnivoiceError } from './error-mapping'
import type { OmnivoiceTTSParams, OmnivoiceTTSResult } from './types'

const DEFAULT_NUM_STEP = 16
const DEFAULT_LANGUAGE = 'Auto'

export async function synthesizeWithOmnivoiceTTS(
  params: OmnivoiceTTSParams,
): Promise<OmnivoiceTTSResult> {
  const text = params.text?.trim() ?? ''
  const profileId = params.profileId?.trim() ?? ''
  if (!text) {
    return { success: false, error: 'OMNIVOICE_TEXT_REQUIRED', errorCode: 'OMNIVOICE_TEXT_REQUIRED' }
  }
  if (!profileId) {
    return { success: false, error: 'OMNIVOICE_PROFILE_ID_REQUIRED', errorCode: 'OMNIVOICE_PROFILE_ID_REQUIRED' }
  }

  const ov = getOmnivoiceClient()
  try {
    const r = await ov.design.generateSpeech({
      text,
      profileId,
      language: params.language ?? DEFAULT_LANGUAGE,
      numStep: DEFAULT_NUM_STEP,
    })
    return {
      success: true,
      audioData: Buffer.from(r.audio),
      audioDuration: Math.round((r.audioDurationSec ?? 0) * 1000),
      requestId: r.audioId,
    }
  } catch (err) {
    const mapped = mapOmnivoiceError(err)
    return { success: false, ...mapped }
  }
}
