import { registerOfficialModel } from '@/lib/providers/official/model-registry'
import type { OfficialModelModality } from '@/lib/providers/official/model-registry'

const STARSTONE_CATALOG: Readonly<Record<OfficialModelModality, readonly string[]>> = {
  llm: [
    'doubao-seed-2-0-pro-260215',
  ],
  image: [
    'gpt-image-2',
  ],
  video: [
    'dreamina-seedance-2-0-fast-260128',
  ],
  audio: [],
}

let initialized = false

export function ensureStarRouterCatalogRegistered(): void {
  if (initialized) return
  initialized = true
  for (const modality of Object.keys(STARSTONE_CATALOG) as OfficialModelModality[]) {
    for (const modelId of STARSTONE_CATALOG[modality]) {
      registerOfficialModel({ provider: 'starrouter', modality, modelId })
    }
  }
}

export function listStarRouterCatalogModels(modality: OfficialModelModality): readonly string[] {
  ensureStarRouterCatalogRegistered()
  return STARSTONE_CATALOG[modality]
}
