import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// Mock dependencies
vi.mock('@/lib/admin/auth', () => ({
  requireAdminAuth: vi.fn().mockResolvedValue({ user: { id: 'test-admin-id' } }),
}))

vi.mock('@/lib/api-errors', async () => {
  const actual = await vi.importActual('@/lib/api-errors')
  return {
    ...actual,
    apiHandler: (handler: (request: NextRequest, context: { params: Promise<{ styleId: string }> }) => Promise<Response>) => handler,
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    artStyle: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'

// Create a simple test helper to test the core logic
function createMockRequest(body: object, url = 'http://localhost/api/admin/config-center/art-styles/test-style-id/generate-preview'): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

describe('admin/config-center/art-styles/[styleId]/generate-preview API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear module cache before each test
    vi.resetModules()
  })

  describe('Art Style Validation', () => {
    it('should return 404 when art style does not exist', async () => {
      vi.mocked(prisma.artStyle.findUnique).mockResolvedValueOnce(null)

      const { POST } = await import('@/app/api/admin/config-center/art-styles/[styleId]/generate-preview/route')

      const request = createMockRequest({ model: 'test-model' })
      const context = { params: Promise.resolve({ styleId: 'non-existent-id' }) }

      const response = await POST(request, context)
      expect(response.status).toBe(404)

      const data = await response.json() as { error?: string }
      expect(data.error).toBe('画风不存在')
    })

    it('should proceed when art style exists', async () => {
      vi.mocked(prisma.artStyle.findUnique).mockResolvedValueOnce({
        id: 'test-style-id',
        name: 'Test Style',
        scope: 'system',
      })
      vi.mocked(prisma.artStyle.update).mockResolvedValueOnce({
        id: 'test-style-id',
        previewImageUrl: 'https://picsum.photos/seed/test-style-id-1234567890/400/400',
      })

      const { POST } = await import('@/app/api/admin/config-center/art-styles/[styleId]/generate-preview/route')

      const request = createMockRequest({ model: 'test-model' })
      const context = { params: Promise.resolve({ styleId: 'test-style-id' }) }

      const response = await POST(request, context)
      expect(response.ok).toBe(true)
    })
  })

  describe('Preview Image Generation', () => {
    it('should generate preview image URL using picsum.photos', async () => {
      vi.mocked(prisma.artStyle.findUnique).mockResolvedValueOnce({
        id: 'test-style-id',
        name: 'Test Style',
        scope: 'system',
      })
      vi.mocked(prisma.artStyle.update).mockImplementation(({ where, data }) => {
        return Promise.resolve({
          id: where.id,
          previewImageUrl: data.previewImageUrl,
          updatedByUserId: data.updatedByUserId,
        })
      })

      const { POST } = await import('@/app/api/admin/config-center/art-styles/[styleId]/generate-preview/route')

      const request = createMockRequest({ model: 'test-model' })
      const context = { params: Promise.resolve({ styleId: 'test-style-id' }) }

      const response = await POST(request, context)
      const data = await response.json() as { previewImageUrl?: string; model?: string }

      expect(response.ok).toBe(true)
      expect(data.previewImageUrl).toContain('picsum.photos')
      expect(data.previewImageUrl).toContain('/400/400')
      expect(data.model).toBe('test-model')
    })

    it('should update database with generated previewImageUrl', async () => {
      vi.mocked(prisma.artStyle.findUnique).mockResolvedValueOnce({
        id: 'test-style-id',
        name: 'Test Style',
        scope: 'system',
      })
      vi.mocked(prisma.artStyle.update).mockResolvedValueOnce({
        id: 'test-style-id',
        previewImageUrl: 'https://picsum.photos/seed/test-style-id-1234567890/400/400',
        updatedByUserId: 'test-admin-id',
      })

      const { POST } = await import('@/app/api/admin/config-center/art-styles/[styleId]/generate-preview/route')

      const request = createMockRequest({ model: 'test-model' })
      const context = { params: Promise.resolve({ styleId: 'test-style-id' }) }

      await POST(request, context)

      expect(prisma.artStyle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'test-style-id' },
          data: expect.objectContaining({
            previewImageUrl: expect.stringContaining('picsum.photos'),
            updatedByUserId: 'test-admin-id',
          }),
        }),
      )
    })

    it('should use default model when model is not provided', async () => {
      vi.mocked(prisma.artStyle.findUnique).mockResolvedValueOnce({
        id: 'test-style-id',
        name: 'Test Style',
        scope: 'system',
      })
      vi.mocked(prisma.artStyle.update).mockResolvedValueOnce({
        id: 'test-style-id',
        previewImageUrl: 'https://picsum.photos/seed/test-style-id-1234567890/400/400',
      })

      const { POST } = await import('@/app/api/admin/config-center/art-styles/[styleId]/generate-preview/route')

      const request = createMockRequest({})
      const context = { params: Promise.resolve({ styleId: 'test-style-id' }) }

      const response = await POST(request, context)
      const data = await response.json() as { model?: string }

      expect(response.ok).toBe(true)
      expect(data.model).toBe('default')
    })
  })
})
