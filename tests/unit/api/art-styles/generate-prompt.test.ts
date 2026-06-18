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

vi.mock('@/lib/llm/chat-completion', () => ({
  chatCompletion: vi.fn(),
}))

import { chatCompletion } from '@/lib/llm/chat-completion'

// Create a simple test helper to test the core logic
function createMockRequest(body: object, url = 'http://localhost/api/art-styles/generate-prompt'): NextRequest {
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

describe('art-styles/generate-prompt API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear module cache before each test
    vi.resetModules()
  })

  describe('Input Validation', () => {
    it('should throw error when name is missing', async () => {
      const { POST } = await import('@/app/api/art-styles/generate-prompt/route')

      const request = createMockRequest({
        name: '',
        model: 'gpt-4o',
      })

      await expect(POST(request, mockRouteContext)).rejects.toThrow('画风名称不能为空')
    })

    it('should throw error when model is missing', async () => {
      const { POST } = await import('@/app/api/art-styles/generate-prompt/route')

      const request = createMockRequest({
        name: '赛博朋克风',
        model: '',
      })

      await expect(POST(request, mockRouteContext)).rejects.toThrow('请选择生成模型')
    })

    it('should accept request with only name and model', async () => {
      vi.mocked(chatCompletion).mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ prompt: 'test prompt', description: 'test desc' }) } }],
      } as never)

      const { POST } = await import('@/app/api/art-styles/generate-prompt/route')

      const request = createMockRequest({
        name: '赛博朋克风',
        model: 'gpt-4o',
      })

      const response = await POST(request, mockRouteContext)
      expect(response.ok).toBe(true)
    })
  })

  describe('Prompt Generation Logic', () => {
    it('should pass correct parameters to chatCompletion', async () => {
      vi.mocked(chatCompletion).mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ prompt: 'test', description: 'desc' }) } }],
      } as never)

      const { POST } = await import('@/app/api/art-styles/generate-prompt/route')

      const request = createMockRequest({
        name: '赛博朋克风',
        description: '未来科技风格',
        model: 'gpt-4o',
      })

      await POST(request, mockRouteContext)

      expect(chatCompletion).toHaveBeenCalledWith(
        'test-user-id',
        'gpt-4o',
        expect.arrayContaining([
          expect.objectContaining({ role: 'user' }),
        ]),
        expect.objectContaining({
          temperature: 0.7,
        }),
      )
    })

    it('should return prompt and description from successful response', async () => {
      const mockResponse = {
        prompt: 'cyberpunk style, neon lights, futuristic city',
        description: '赛博朋克风格，霓虹灯光效果，未来都市感',
      }

      vi.mocked(chatCompletion).mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(mockResponse) } }],
      } as never)

      const { POST } = await import('@/app/api/art-styles/generate-prompt/route')

      const request = createMockRequest({
        name: '赛博朋克风',
        description: '未来科技风格',
        model: 'gpt-4o',
      })

      const response = await POST(request, mockRouteContext)
      const data = await response.json()

      expect(response.ok).toBe(true)
      expect(data.prompt).toBe(mockResponse.prompt)
      expect(data.description).toBe(mockResponse.description)
    })

    it('should handle plain text response from LLM', async () => {
      vi.mocked(chatCompletion).mockResolvedValueOnce({
        choices: [{ message: { content: 'plain text prompt response' } }],
      } as never)

      const { POST } = await import('@/app/api/art-styles/generate-prompt/route')

      const request = createMockRequest({
        name: '赛博朋克风',
        model: 'gpt-4o',
      })

      const response = await POST(request, mockRouteContext)
      const data = await response.json()

      expect(response.ok).toBe(true)
      expect(data.prompt).toBe('plain text prompt response')
    })

    it('should include description in the prompt to LLM', async () => {
      vi.mocked(chatCompletion).mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ prompt: 'test', description: 'desc' }) } }],
      } as never)

      const { POST } = await import('@/app/api/art-styles/generate-prompt/route')

      const request = createMockRequest({
        name: '水彩风格',
        description: '手绘水彩质感，柔和色彩',
        model: 'gpt-4o',
      })

      await POST(request, mockRouteContext)

      expect(chatCompletion).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining('水彩风格'),
          }),
          expect.objectContaining({
            content: expect.stringContaining('手绘水彩质感，柔和色彩'),
          }),
        ]),
        expect.any(Object),
      )
    })
  })

  describe('Error Handling', () => {
    it('should handle LLM API errors', async () => {
      vi.mocked(chatCompletion).mockRejectedValueOnce(new Error('LLM API failed'))

      const { POST } = await import('@/app/api/art-styles/generate-prompt/route')

      const request = createMockRequest({
        name: '赛博朋克风',
        model: 'gpt-4o',
      })

      await expect(POST(request, mockRouteContext)).rejects.toThrow()
    })

    it('should handle malformed JSON response from LLM', async () => {
      vi.mocked(chatCompletion).mockResolvedValueOnce({
        choices: [{ message: { content: 'not valid json }' } }],
      } as never)

      const { POST } = await import('@/app/api/art-styles/generate-prompt/route')

      const request = createMockRequest({
        name: '赛博朋克风',
        model: 'gpt-4o',
      })

      const response = await POST(request, mockRouteContext)
      // Should still return 200 but with the raw text as prompt
      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.prompt).toBe('not valid json }')
    })
  })
})
