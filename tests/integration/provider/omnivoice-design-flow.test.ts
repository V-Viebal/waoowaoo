import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/providers/omnivoice', () => ({
  createOmnivoiceVoiceDesign: vi.fn(),
  OMNIVOICE_TTS_MODEL_ID: 'omnivoice-tts-v1',
}))
vi.mock('@/lib/providers/bailian/voice-design', () => ({
  createVoiceDesign: vi.fn(),
  validateVoicePrompt: vi.fn(() => ({ valid: true })),
  validatePreviewText: vi.fn(() => ({ valid: true })),
}))
vi.mock('@/lib/api-config', () => ({
  getProviderConfig: vi.fn(async () => ({ apiKey: 'k' })),
}))
vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: vi.fn(async () => undefined),
}))
vi.mock('@/lib/workers/utils', () => ({
  assertTaskActive: vi.fn(async () => undefined),
}))

import { handleVoiceDesignTask } from '@/lib/workers/handlers/voice-design'
import { createOmnivoiceVoiceDesign } from '@/lib/providers/omnivoice'
import { createVoiceDesign } from '@/lib/providers/bailian/voice-design'

function buildJob(payload: Record<string, unknown>) {
  return {
    data: { userId: 'u1', type: 'asset_hub_voice_design', payload },
  } as Parameters<typeof handleVoiceDesignTask>[0]
}

describe('handleVoiceDesignTask provider dispatch', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('routes to omnivoice when payload.provider === omnivoice', async () => {
    ;(createOmnivoiceVoiceDesign as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: true, profileId: 'prof_o', audioBase64: 'AAA', sampleRate: 24000, responseFormat: 'wav',
    })
    const r = await handleVoiceDesignTask(buildJob({
      provider: 'omnivoice', voicePrompt: '温暖中年男声', previewText: '你好', preferredName: 'Hero', language: 'zh',
    }))
    expect(createOmnivoiceVoiceDesign).toHaveBeenCalledWith(expect.objectContaining({
      voicePrompt: '温暖中年男声', previewText: '你好', userId: 'u1',
    }))
    expect(createVoiceDesign).not.toHaveBeenCalled()
    expect(r.voiceId).toBe('prof_o')
    expect(r.targetModel).toBe('omnivoice-tts-v1')
  })

  it('defaults to bailian when payload.provider missing', async () => {
    ;(createVoiceDesign as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: true, voiceId: 'qwen_v1', targetModel: 'qwen3-tts-vd-2026-01-26',
    })
    await handleVoiceDesignTask(buildJob({
      voicePrompt: 'x', previewText: 'y',
    }))
    expect(createVoiceDesign).toHaveBeenCalled()
    expect(createOmnivoiceVoiceDesign).not.toHaveBeenCalled()
  })

  it('throws when omnivoice returns failure', async () => {
    ;(createOmnivoiceVoiceDesign as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: false, error: 'down', errorCode: 'OMNIVOICE_BACKEND_ERROR',
    })
    await expect(handleVoiceDesignTask(buildJob({
      provider: 'omnivoice', voicePrompt: 'x', previewText: 'y',
    }))).rejects.toThrow(/down/)
  })
})
