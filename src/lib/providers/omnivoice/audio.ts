import {
  assertOfficialModelRegistered,
  type OfficialModelModality,
} from '@/lib/providers/official/model-registry'
import type { GenerateResult } from '@/lib/generators/base'
import { ensureOmnivoiceCatalogRegistered } from './catalog'
import { synthesizeWithOmnivoiceTTS } from './tts'

export interface OmnivoiceGenerateRequestOptions {
  provider: string
  modelId: string
  modelKey: string
  [key: string]: unknown
}

export interface OmnivoiceAudioGenerateParams {
  userId: string
  text: string
  voice?: string
  rate?: number
  options: OmnivoiceGenerateRequestOptions
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function generateOmnivoiceAudio(
  params: OmnivoiceAudioGenerateParams,
): Promise<GenerateResult> {
  ensureOmnivoiceCatalogRegistered()
  assertOfficialModelRegistered({
    provider: 'omnivoice',
    modality: 'audio' satisfies OfficialModelModality,
    modelId: params.options.modelId,
  })

  const profileId = readTrimmedString(params.voice)
  const text = readTrimmedString(params.text)
  if (!profileId) throw new Error('OMNIVOICE_PROFILE_ID_REQUIRED')
  if (!text) throw new Error('OMNIVOICE_TEXT_REQUIRED')

  const result = await synthesizeWithOmnivoiceTTS({ text, profileId })
  if (!result.success || !result.audioData) {
    throw new Error(result.errorCode || result.error || 'OMNIVOICE_AUDIO_SYNTHESIZE_FAILED')
  }
  return {
    success: true,
    audioUrl: `data:audio/wav;base64,${result.audioData.toString('base64')}`,
    requestId: result.requestId,
  }
}
