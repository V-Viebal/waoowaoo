import { getOmnivoiceClient } from './client'
import { mapOmnivoiceError } from './error-mapping'
import type { OmnivoiceCloneParams, OmnivoiceCloneResult } from './types'

export function buildOmnivoiceProfileName(userId: string, name: string): string {
  const trimmedName = name.trim()
  const trimmedUserId = userId.trim()
  const shortId = trimmedUserId.slice(0, 8)
  return `vv_${shortId}_${trimmedName}`
}

export async function createOmnivoiceClone(
  params: OmnivoiceCloneParams,
): Promise<OmnivoiceCloneResult> {
  const name = params.name?.trim() ?? ''
  const userId = params.userId?.trim() ?? ''
  if (!name) {
    return { success: false, error: '名称必填', errorCode: 'OMNIVOICE_NAME_REQUIRED' }
  }
  if (!userId) {
    return { success: false, error: '用户ID必填', errorCode: 'OMNIVOICE_USER_ID_REQUIRED' }
  }

  const ov = getOmnivoiceClient()
  try {
    const profile = await ov.design.createProfile({
      kind: 'clone',
      name: buildOmnivoiceProfileName(userId, name),
      refAudio: params.refAudio,
      refAudioFilename: params.refAudioFilename,
      refText: params.refText,
      language: params.language ?? 'Auto',
    })
    return { success: true, profileId: profile.id }
  } catch (err) {
    return { success: false, ...mapOmnivoiceError(err) }
  }
}
