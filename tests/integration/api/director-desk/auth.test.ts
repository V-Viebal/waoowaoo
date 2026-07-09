import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/storage', () => ({
  uploadObject: vi.fn(async (_body: Buffer, key: string) => key),
  generateUniqueKey: vi.fn((prefix: string, ext: string) => `${prefix}.${ext}`),
  getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`),
  extractStorageKey: vi.fn((v: string | null | undefined) => v ?? null),
}))

vi.mock('@/lib/media/service', () => ({
  ensureMediaObjectFromStorageKey: vi.fn(async () => ({ id: 'media-auth-1' })),
}))

import { callRoute } from '../helpers/call-route'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../../helpers/auth'
import { resetSystemState } from '../../../helpers/db-reset'
import { seedMinimalDomainState } from '../../../system/helpers/seed'

describe('director-desk auth', () => {
  beforeEach(async () => {
    await resetSystemState()
    installAuthMocks()
  })

  it('save route returns 403 when the project auth mock forbids the caller (user B)', async () => {
    const seeded = await seedMinimalDomainState()
    mockAuthenticated('user-B-not-owner')
    const { mockProjectAuth } = await import('../../../helpers/auth')
    mockProjectAuth('forbidden')

    const mod = await import('@/app/api/novel-promotion/[projectId]/director-desk/save/route')
    const response = await callRoute(
      mod.POST,
      'POST',
      {
        panelId: seeded.panel.id,
        project: {
          version: 1,
          scene: {
            backgroundColor: '#1a1d23',
            showGround: true,
            groundOpacity: 0.8,
            showLabels: true,
            showGrid: true,
            backdropAssetId: null,
            backdropOpacity: 0.6,
            backdropYaw: 0,
          },
          objects: [],
          cameras: [
            {
              id: 'cam-1',
              name: '主机位',
              fov: 50,
              position: [0, 1.55, 5.4],
              target: [0, 1.05, 0],
              visible: true,
            },
          ],
          activeCameraId: 'cam-1',
        },
        shots: [],
      },
      { params: { projectId: seeded.project.id } },
    )
    expect(response.status).toBe(403)

    resetAuthMockState()
  })

  it('save route returns 403 when project-auth mock forbids the owner too', async () => {
    const seeded = await seedMinimalDomainState()
    mockAuthenticated(seeded.user.id)
    const { mockProjectAuth } = await import('../../../helpers/auth')
    mockProjectAuth('forbidden')

    const mod = await import('@/app/api/novel-promotion/[projectId]/director-desk/save/route')
    const response = await callRoute(
      mod.POST,
      'POST',
      {
        panelId: seeded.panel.id,
        project: {},
        shots: [],
      },
      { params: { projectId: seeded.project.id } },
    )
    expect(response.status).toBe(403)

    resetAuthMockState()
  })
})
