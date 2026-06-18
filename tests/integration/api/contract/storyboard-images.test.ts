import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/call-route'
import { POST as createStoryboardImage } from '@/app/api/novel-promotion/[projectId]/storyboard-images/route'

const { requireProjectAuthLightMock, createCompositedStoryboardImageMock } = vi.hoisted(() => ({
  requireProjectAuthLightMock: vi.fn(),
  createCompositedStoryboardImageMock: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({
  requireProjectAuthLight: requireProjectAuthLightMock,
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

vi.mock('@/lib/storyboard-images/service', () => ({
  createCompositedStoryboardImage: createCompositedStoryboardImageMock,
}))

describe('storyboard images API contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireProjectAuthLightMock.mockResolvedValue({
      session: { user: { id: 'user-1' } },
      project: { id: 'project-1', userId: 'user-1' },
    })
    createCompositedStoryboardImageMock.mockResolvedValue({
      storyboardId: 'storyboard-1',
      imageUrl: '/m/storyboard-image-public-id',
      imageMediaId: 'media-1',
      versionId: 'version-1',
      mode: 'composited_storyboard',
      gridPreset: 'grid_6',
      gridConfig: {
        preset: 'grid_6',
        columns: 2,
        rows: 3,
        capacity: 6,
        panelCount: 4,
      },
    })
  })

  it('creates a composited storyboard image for an owned project', async () => {
    const response = await callRoute(
      createStoryboardImage,
      'POST',
      {
        storyboardId: 'storyboard-1',
        mode: 'composited_storyboard',
        gridPreset: 'grid_6',
      },
      { params: { projectId: 'project-1' } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.storyboardImage).toMatchObject({
      storyboardId: 'storyboard-1',
      imageUrl: '/m/storyboard-image-public-id',
      versionId: 'version-1',
      mode: 'composited_storyboard',
      gridPreset: 'grid_6',
    })
    expect(createCompositedStoryboardImageMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      storyboardId: 'storyboard-1',
      userId: 'user-1',
      gridPreset: 'grid_6',
    })
  })

  it('returns forbidden when project auth rejects the user', async () => {
    requireProjectAuthLightMock.mockResolvedValue(new Response('blocked', { status: 403 }))

    const response = await callRoute(
      createStoryboardImage,
      'POST',
      {
        storyboardId: 'storyboard-1',
        mode: 'composited_storyboard',
      },
      { params: { projectId: 'project-1' } },
    )

    expect(response.status).toBe(403)
    expect(createCompositedStoryboardImageMock).not.toHaveBeenCalled()
  })
})
