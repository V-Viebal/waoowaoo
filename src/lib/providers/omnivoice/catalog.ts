import { registerOfficialModel } from '@/lib/providers/official/model-registry'
import type { OfficialModelModality } from '@/lib/providers/official/model-registry'

export const OMNIVOICE_TTS_MODEL_ID = 'omnivoice-tts-v1'

const OMNIVOICE_CATALOG: Readonly<Record<OfficialModelModality, readonly string[]>> = {
  llm: [],
  image: [],
  video: [],
  audio: [OMNIVOICE_TTS_MODEL_ID],
}

let initialized = false

export function ensureOmnivoiceCatalogRegistered(): void {
  if (initialized) return
  initialized = true
  for (const modality of Object.keys(OMNIVOICE_CATALOG) as OfficialModelModality[]) {
    for (const modelId of OMNIVOICE_CATALOG[modality]) {
      registerOfficialModel({ provider: 'omnivoice', modality, modelId })
    }
  }
}

export function listOmnivoiceCatalogModels(modality: OfficialModelModality): readonly string[] {
  ensureOmnivoiceCatalogRegistered()
  return OMNIVOICE_CATALOG[modality]
}
