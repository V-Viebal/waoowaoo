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
    globalAssetFolder: { findUnique: vi.fn() },
    globalVoice: { create: vi.fn() },
  },
}))
vi.mock('@/lib/storage', () => ({
  uploadObject: vi.fn(async () => 'voices/u1/123.wav'),
  generateUniqueKey: vi.fn((prefix: string, ext: string) => `${prefix}.${ext}`),
  getSignedUrl: vi.fn((k: string) => `https://signed/${k}`),
}))
vi.mock('@/lib/media/service', () => ({
  ensureMediaObjectFromStorageKey: vi.fn(async () => ({ id: 'media-1', storageKey: 'voices/u1/123.wav' })),
}))

import { NextRequest } from 'next/server'
import { POST as cloneUploadHandler } from '@/app/api/asset-hub/voice-clone-upload/route'
import { createOmnivoiceClone } from '@/lib/providers/omnivoice'
import { prisma } from '@/lib/prisma'

function buildMultipartRequest(fields: { name?: string; fileName?: string; fileType?: string; folderId?: string; language?: string }): NextRequest {
  const formData = new FormData()
  const file = new File([new Uint8Array([1, 2, 3])], fields.fileName ?? 'ref.wav', { type: fields.fileType ?? 'audio/wav' })
  formData.append('file', file)
  if (fields.name !== undefined) formData.append('name', fields.name)
  if (fields.folderId !== undefined) formData.append('folderId', fields.folderId)
  if (fields.language !== undefined) formData.append('language', fields.language)
  return new NextRequest('http://x/api/asset-hub/voice-clone-upload', {
    method: 'POST',
    body: formData,
  })
}

const ctx = { params: Promise.resolve({}) } as { params: Promise<Record<string, string>> }

describe('POST /api/asset-hub/voice-clone-upload', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('uploads, clones and creates an omnivoice-clone GlobalVoice', async () => {
    ;(createOmnivoiceClone as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: true, profileId: 'prof_clone_1',
    })
    ;(prisma.globalVoice.create as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      id: 'gv-1', voiceId: 'prof_clone_1',
    })

    const res = await cloneUploadHandler(buildMultipartRequest({ name: 'My Clone' }), ctx)
    const json = await res.json() as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.profileId).toBe('prof_clone_1')
    expect(prisma.globalVoice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'u1',
        voiceId: 'prof_clone_1',
        voiceType: 'omnivoice-clone',
        customVoiceMediaId: 'media-1',
      }),
    }))
  })

  it('returns INVALID_PARAMS when name is missing', async () => {
    const res = await cloneUploadHandler(buildMultipartRequest({}), ctx)
    expect(res.status).toBe(400)
    expect(createOmnivoiceClone).not.toHaveBeenCalled()
  })

  it('rejects non-audio files', async () => {
    const res = await cloneUploadHandler(
      buildMultipartRequest({ name: 'X', fileName: 'doc.txt', fileType: 'text/plain' }),
      ctx,
    )
    expect(res.status).toBe(400)
    expect(createOmnivoiceClone).not.toHaveBeenCalled()
  })

  it('returns 502 when omnivoice backend unreachable', async () => {
    ;(createOmnivoiceClone as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: false, error: 'fetch failed', errorCode: 'OMNIVOICE_BACKEND_UNREACHABLE',
    })
    const res = await cloneUploadHandler(buildMultipartRequest({ name: 'X' }), ctx)
    expect(res.status).toBe(502)
    expect(prisma.globalVoice.create).not.toHaveBeenCalled()
  })

  it('returns 400 on generic clone failure', async () => {
    ;(createOmnivoiceClone as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: false, error: 'bad audio', errorCode: 'OMNIVOICE_INVALID_PARAMS',
    })
    const res = await cloneUploadHandler(buildMultipartRequest({ name: 'X' }), ctx)
    expect(res.status).toBe(400)
    expect(prisma.globalVoice.create).not.toHaveBeenCalled()
  })
})
