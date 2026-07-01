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
    // Dreamina 系列（火山方舟模型名）
    'dreamina-seedance-2-0-fast-260128',
    'dreamina-seedance-2-0-260128',
    // Doubao 系列（火山方舟模型名，与上述等价）
    'doubao-seedance-2-0-260128',
    'doubao-seedance-2-0-fast-260128',
    'doubao-seedance-1-5-pro-251215',
    'doubao-seedance-1-0-pro-250528',
    'doubao-seedance-1-0-pro-fast-251015',
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
