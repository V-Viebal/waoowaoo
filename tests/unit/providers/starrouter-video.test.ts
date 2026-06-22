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
})
