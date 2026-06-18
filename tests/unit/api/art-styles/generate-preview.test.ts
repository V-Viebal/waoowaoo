import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock dependencies
vi.mock('@/lib/api-auth', () => ({
  requireUserAuth: vi.fn().mockResolvedValue({ session: { user: { id: 'test-user-id' } } }),
  isErrorResponse: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/api-errors', async () => {
  const actual = await vi.importActual('@/lib/api-errors')
  return {
    ...actual,
    apiHandler: (handler: (request: NextRequest) => Promise<Response>) => handler,
  }
})

vi.mock('@/lib/generator-api', () => ({
  generateImage: vi.fn(),
}))

vi.mock('@/lib/storage', () => ({
  generateUniqueKey: vi.fn().mockReturnValue('test-key.png'),
  uploadObject: vi.fn().mockResolvedValue('test-key.png'),
  getSignedUrl: vi.fn().mockReturnValue('/api/storage/sign?key=test-key.png'),
}))

import { generateImage } from '@/lib/generator-api'

// Create a simple test helper to test the core logic
function createMockRequest(body: object, url = 'http://localhost/api/art-styles/generate-preview'): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

// Mock route context for Next.js 15+ route handler signature
const mockRouteContext = { params: Promise.resolve({}) }

describe('art-styles/generate-preview API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear module cache before each test
    vi.resetModules()
  })

  describe('Input Validation', () => {
    it('should throw error when prompt is missing', async () => {
      const { POST } = await import('@/app/api/art-styles/generate-preview/route')

      const request = createMockRequest({
        prompt: '',
        model: 'dall-e-3',
      })

      await expect(POST(request, mockRouteContext)).rejects.toThrow('提示词不能为空')
    })

    it('should throw error when model is missing', async () => {
      const { POST } = await import('@/app/api/art-styles/generate-preview/route')

      const request = createMockRequest({
        prompt: 'cyberpunk style, neon lights',
        model: '',
      })

      await expect(POST(request, mockRouteContext)).rejects.toThrow('请选择图片生成模型')
    })

    it('should accept request with prompt and model', async () => {
      vi.mocked(generateImage).mockResolvedValueOnce({
        success: true,
        imageUrl: 'https://example.com/preview.jpg',
      })

      const { POST } = await import('@/app/api/art-styles/generate-preview/route')

      const request = createMockRequest({
        prompt: 'cyberpunk style, neon lights',
        model: 'dall-e-3',
      })

      const response = await POST(request, mockRouteContext)
      expect(response.ok).toBe(true)
    })

    it('should accept optional styleName', async () => {
      vi.mocked(generateImage).mockResolvedValueOnce({
        success: true,
        imageUrl: 'https://example.com/preview.jpg',
      })

      const { POST } = await import('@/app/api/art-styles/generate-preview/route')

      const request = createMockRequest({
        prompt: 'cyberpunk style, neon lights',
        model: 'dall-e-3',
        styleName: '赛博朋克风',
      })

      const response = await POST(request, mockRouteContext)
      expect(response.ok).toBe(true)
    })
  })

  describe('Image Generation Logic', () => {
    it('should pass correct parameters to generateImage', async () => {
      vi.mocked(generateImage).mockResolvedValueOnce({
        success: true,
        imageUrl: 'https://example.com/preview.jpg',
      })

      const { POST } = await import('@/app/api/art-styles/generate-preview/route')

      const request = createMockRequest({
        prompt: 'cyberpunk style, neon lights',
        model: 'dall-e-3',
      })

      await POST(request, mockRouteContext)

      expect(generateImage).toHaveBeenCalledWith(
        'test-user-id',
        'dall-e-3',
        'cyberpunk style, neon lights',
        expect.objectContaining({
          outputFormat: 'png',
        }),
      )
    })

    it('should return imageUrl from successful response', async () => {
      const mockImageUrl = 'https://example.com/generated-preview.jpg'
      vi.mocked(generateImage).mockResolvedValueOnce({
        success: true,
        imageUrl: mockImageUrl,
      })

      const { POST } = await import('@/app/api/art-styles/generate-preview/route')

      const request = createMockRequest({
        prompt: 'cyberpunk style, neon lights',
        model: 'dall-e-3',
      })

      const response = await POST(request, mockRouteContext)
      const data = await response.json()

      expect(response.ok).toBe(true)
      expect(data.success).toBe(true)
      expect(data.previewImageUrl).toBe(mockImageUrl)
    })

    it('should handle imageUrls array from response', async () => {
      vi.mocked(generateImage).mockResolvedValueOnce({
        success: true,
        imageUrls: ['https://example.com/preview1.jpg', 'https://example.com/preview2.jpg'],
      })

      const { POST } = await import('@/app/api/art-styles/generate-preview/route')

      const request = createMockRequest({
        prompt: 'cyberpunk style, neon lights',
        model: 'dall-e-3',
      })

      const response = await POST(request, mockRouteContext)
      const data = await response.json()

      expect(response.ok).toBe(true)
      expect(data.previewImageUrl).toBe('https://example.com/preview1.jpg')
    })
  })

  describe('Error Handling', () => {
    it('should handle image generation failure', async () => {
      vi.mocked(generateImage).mockResolvedValueOnce({
        success: false,
        error: 'Image generation failed',
      })

      const { POST } = await import('@/app/api/art-styles/generate-preview/route')

      const request = createMockRequest({
        prompt: 'cyberpunk style, neon lights',
        model: 'dall-e-3',
      })

      await expect(POST(request, mockRouteContext)).rejects.toThrow()
    })

    it('should handle exceptions from generateImage', async () => {
      vi.mocked(generateImage).mockRejectedValueOnce(new Error('API rate limit exceeded'))

      const { POST } = await import('@/app/api/art-styles/generate-preview/route')

      const request = createMockRequest({
        prompt: 'cyberpunk style, neon lights',
        model: 'dall-e-3',
      })

      await expect(POST(request, mockRouteContext)).rejects.toThrow()
    })

    it('should handle missing imageUrl in successful response', async () => {
      vi.mocked(generateImage).mockResolvedValueOnce({
        success: true,
        // No imageUrl or imageUrls
      })

      const { POST } = await import('@/app/api/art-styles/generate-preview/route')

      const request = createMockRequest({
        prompt: 'cyberpunk style, neon lights',
        model: 'dall-e-3',
      })

      await expect(POST(request, mockRouteContext)).rejects.toThrow()
    })
  })
})
