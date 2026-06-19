import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/providers/omnivoice', () => ({
  createOmnivoiceClone: vi.fn(),
}))
vi.mock('@/lib/api-auth', () => ({
  requireUserAuth: vi.fn(async () => ({ session: { user: { id: 'u1' } } })),
  isErrorResponse: vi.fn(() => false),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    mediaObject: { findUnique: vi.fn() },
    globalVoice: { create: vi.fn() },
  },
}))
vi.mock('@/lib/storage', () => ({
  getSignedUrl: vi.fn((k: string) => `https://signed/${k}`),
  getObjectBuffer: vi.fn(async () => Buffer.from([1, 2, 3])),
}))

import { NextRequest } from 'next/server'
import { POST as cloneHandler } from '@/app/api/asset-hub/voice-clone/route'
import { createOmnivoiceClone } from '@/lib/providers/omnivoice'
import { prisma } from '@/lib/prisma'

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://x/api/asset-hub/voice-clone', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({}) } as { params: Promise<Record<string, string>> }

describe('POST /api/asset-hub/voice-clone (omnivoice)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('creates GlobalVoice on successful clone', async () => {
    ;(prisma.mediaObject.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      id: 'm1', storageKey: 'voice-ref/u1/x.wav', userId: 'u1',
    })
    ;(createOmnivoiceClone as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: true, profileId: 'prof_z',
    })
    ;(prisma.globalVoice.create as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      id: 'gv1', voiceId: 'prof_z',
    })

    const res = await cloneHandler(buildRequest({
      name: 'Carla', refAudioMediaId: 'm1', language: 'English',
    }), ctx)
    const json = await res.json() as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.profileId).toBe('prof_z')
    expect(prisma.globalVoice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        voiceId: 'prof_z',
        voiceType: 'omnivoice-clone',
        customVoiceMediaId: 'm1',
        userId: 'u1',
      }),
    }))
  })

  it('rejects mediaObject owned by another user', async () => {
    ;(prisma.mediaObject.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      id: 'm1', storageKey: 'k', userId: 'someone-else',
    })
    const res = await cloneHandler(buildRequest({
      name: 'X', refAudioMediaId: 'm1',
    }), ctx)
    expect(res.status).toBe(403)
    expect(createOmnivoiceClone).not.toHaveBeenCalled()
  })

  it('returns 502 when omnivoice backend unreachable', async () => {
    ;(prisma.mediaObject.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      id: 'm1', storageKey: 'k', userId: 'u1',
    })
    ;(createOmnivoiceClone as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: false, error: 'fetch failed', errorCode: 'OMNIVOICE_BACKEND_UNREACHABLE',
    })
    const res = await cloneHandler(buildRequest({
      name: 'X', refAudioMediaId: 'm1',
    }), ctx)
    expect(res.status).toBe(502)
  })
})
