import { getOmnivoiceClient } from './client'
import { mapOmnivoiceError } from './error-mapping'
import { buildOmnivoiceProfileName } from './voice-clone'
import type { OmnivoiceDesignParams, OmnivoiceDesignResult } from './types'

const DEFAULT_VD_STATES = { Style: 'Auto' as const }
const DEFAULT_NUM_STEP = 16

export async function createOmnivoiceVoiceDesign(
  params: OmnivoiceDesignParams,
): Promise<OmnivoiceDesignResult> {
  const voicePrompt = params.voicePrompt?.trim() ?? ''
  const previewText = params.previewText?.trim() ?? ''
  const userId = params.userId?.trim() ?? ''
  if (!voicePrompt) {
    return { success: false, error: '声音描述必填', errorCode: 'OMNIVOICE_VOICE_PROMPT_REQUIRED' }
  }
  if (!previewText) {
    return { success: false, error: '预览文本必填', errorCode: 'OMNIVOICE_PREVIEW_TEXT_REQUIRED' }
  }
  if (!userId) {
    return { success: false, error: '用户ID必填', errorCode: 'OMNIVOICE_USER_ID_REQUIRED' }
  }

  const preferredName = (params.preferredName ?? 'custom_voice').trim() || 'custom_voice'
  const language = params.language ?? 'zh'

  const ov = getOmnivoiceClient()
  try {
    const profile = await ov.design.createProfile({
      kind: 'design',
      name: buildOmnivoiceProfileName(userId, preferredName),
      vdStates: DEFAULT_VD_STATES,
      instruct: voicePrompt,
      language,
    })

    const speech = await ov.design.generateSpeech({
      text: previewText,
      profileId: profile.id,
      language,
      numStep: DEFAULT_NUM_STEP,
    })

    return {
      success: true,
      profileId: profile.id,
      audioBase64: Buffer.from(speech.audio).toString('base64'),
      sampleRate: 24000,
      responseFormat: 'wav',
      requestId: speech.audioId,
    }
  } catch (err) {
    return { success: false, ...mapOmnivoiceError(err) }
  }
}
