import { describe, it, expect } from 'vitest'
import { isOfficialModelRegistered } from '@/lib/providers/official/model-registry'

// Importing api-config triggers eager catalog registration via its
// module-level `ensure*CatalogRegistered` calls. This test verifies the
// registry is populated by the time any consumer of api-config can run.
import '@/lib/api-config'

describe('api-config eager catalog registration', () => {
  it('registers omnivoice/omnivoice-tts-v1 at module load', () => {
    expect(isOfficialModelRegistered({
      provider: 'omnivoice',
      modality: 'audio',
      modelId: 'omnivoice-tts-v1',
    })).toBe(true)
  })

  it('registers bailian audio model at module load', () => {
    expect(isOfficialModelRegistered({
      provider: 'bailian',
      modality: 'audio',
      modelId: 'qwen3-tts-vd-2026-01-26',
    })).toBe(true)
  })
})
