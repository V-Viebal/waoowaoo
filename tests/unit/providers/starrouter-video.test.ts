import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateStarRouterVideo } from '@/lib/providers/starrouter/video'

vi.mock('@/lib/api-config', () => ({
  getProviderConfig: vi.fn(async () => ({ apiKey: 'test-starrouter-key' })),
}))

describe('generateStarRouterVideo', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ task_id: 'task-123' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )))
  })

  it('passes duration as a top-level StarRouter video field', async () => {
    await generateStarRouterVideo({
      userId: 'user-1',
      imageUrl: 'https://example.com/frame.png',
      prompt: 'single continuous story',
      options: {
        provider: 'starrouter',
        modelId: 'dreamina-seedance-2-0-fast-260128',
        modelKey: 'starrouter::dreamina-seedance-2-0-fast-260128',
        duration: 12,
        resolution: '720p',
      },
    })

    const fetchMock = vi.mocked(fetch)
    const request = fetchMock.mock.calls[0]?.[1]
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>

    expect(body.duration).toBe(12)
    expect(body.model).toBe('dreamina-seedance-2-0-fast-260128')
  })

  it('preserves StarRouter metadata extension fields in the request body', async () => {
    await generateStarRouterVideo({
      userId: 'user-1',
      imageUrl: 'https://example.com/frame.png',
      prompt: 'single continuous story',
      options: {
        provider: 'starrouter',
        modelId: 'dreamina-seedance-2-0-fast-260128',
        modelKey: 'starrouter::dreamina-seedance-2-0-fast-260128',
        duration: 8,
        metadata: {
          negative_prompt: 'split screen, comic panels',
          style: 'cinematic',
          quality_level: 'high',
        },
      },
    })

    const fetchMock = vi.mocked(fetch)
    const request = fetchMock.mock.calls[0]?.[1]
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>

    expect(body.metadata).toEqual({
      negative_prompt: 'split screen, comic panels',
      style: 'cinematic',
      quality_level: 'high',
    })
  })

  it('builds content array with text and image_url for Volcengine Doubao API', async () => {
    await generateStarRouterVideo({
      userId: 'user-1',
      imageUrl: 'https://example.com/frame.png',
      prompt: 'a cat running',
      options: {
        provider: 'starrouter',
        modelId: 'dreamina-seedance-2-0-fast-260128',
        modelKey: 'starrouter::dreamina-seedance-2-0-fast-260128',
        duration: 5,
        resolution: '1080p',
        aspectRatio: '16:9',
      },
    })

    const fetchMock = vi.mocked(fetch)
    const request = fetchMock.mock.calls[0]?.[1]
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>

    // Verify new Volcengine Doubao API structure
    expect(body.watermark).toBe(false)
    expect(body.resolution).toBe('1080p')
    expect(body.ratio).toBe('16:9')
    expect(Array.isArray(body.content)).toBe(true)

    const content = body.content as Array<Record<string, unknown>>
    expect(content.length).toBe(2)

    // Text content
    const textItem = content.find(c => c.type === 'text')
    expect(textItem).toBeDefined()
    expect(textItem?.text).toBe('a cat running')

    // Image content
    const imageItem = content.find(c => c.type === 'image_url')
    expect(imageItem).toBeDefined()
    expect(imageItem?.image_url).toEqual({ url: 'https://example.com/frame.png' })

    // Verify endpoint changed to the new Volcengine Doubao API
    const endpoint = fetchMock.mock.calls[0]?.[0] as string
    expect(endpoint).toBe('https://starrouter.io/volcengine/doubao/contents/generations/tasks')
  })
})
