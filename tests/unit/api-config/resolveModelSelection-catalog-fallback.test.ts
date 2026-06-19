import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userPreference: {
      findUnique: vi.fn().mockResolvedValue({ customModels: '[]', customProviders: '[]' }),
    },
  },
}))

import { resolveModelSelection } from '@/lib/api-config'
import { ensureBailianCatalogRegistered } from '@/lib/providers/bailian'
import { ensureOmnivoiceCatalogRegistered } from '@/lib/providers/omnivoice'

describe('resolveModelSelection — catalog fallback', () => {
  beforeEach(() => {
    ensureBailianCatalogRegistered()
    ensureOmnivoiceCatalogRegistered()
  })

  it('accepts omnivoice::omnivoice-tts-v1 when not in user customModels', async () => {
    const sel = await resolveModelSelection('user1', 'omnivoice::omnivoice-tts-v1', 'audio')
    expect(sel.provider).toBe('omnivoice')
    expect(sel.modelId).toBe('omnivoice-tts-v1')
    expect(sel.mediaType).toBe('audio')
  })

  it('accepts bailian::qwen3-tts-vd-2026-01-26 when not in user customModels', async () => {
    const sel = await resolveModelSelection('user1', 'bailian::qwen3-tts-vd-2026-01-26', 'audio')
    expect(sel.provider).toBe('bailian')
    expect(sel.modelId).toBe('qwen3-tts-vd-2026-01-26')
  })

  it('rejects unknown audio model not in catalog', async () => {
    await expect(resolveModelSelection('user1', 'fake::nonexistent', 'audio'))
      .rejects.toThrow(/MODEL_NOT_FOUND/)
  })

  it('does NOT fall back for llm modality (preserves existing behavior)', async () => {
    await expect(resolveModelSelection('user1', 'bailian::qwen3.5-plus', 'llm'))
      .rejects.toThrow(/MODEL_NOT_FOUND/)
  })
})
