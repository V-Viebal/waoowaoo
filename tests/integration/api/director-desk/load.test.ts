import { beforeEach, describe, expect, it } from 'vitest'
import { callRoute } from '../helpers/call-route'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../../helpers/auth'
import { resetSystemState } from '../../../helpers/db-reset'
import { seedMinimalDomainState } from '../../../system/helpers/seed'

describe('director-desk load route', () => {
  beforeEach(async () => {
    await resetSystemState()
    installAuthMocks()
  })

  it('returns null directorLayout and empty shots for a fresh panel', async () => {
    const seeded = await seedMinimalDomainState()
    mockAuthenticated(seeded.user.id)

    const mod = await import('@/app/api/novel-promotion/[projectId]/director-desk/load/route')
    const response = await callRoute(
      mod.GET,
      'GET',
      undefined,
      {
        params: { projectId: seeded.project.id },
        query: { panelId: seeded.panel.id },
      },
    )

    expect(response.status).toBe(200)
    const body = await response.json() as {
      panel: {
        id: string
        directorLayout: unknown
        directorShots: unknown[]
        characters: unknown[]
        props: unknown[]
      }
      project: { videoRatio: string }
    }
    expect(body.panel.id).toBe(seeded.panel.id)
    expect(body.panel.directorLayout).toBeNull()
    expect(Array.isArray(body.panel.directorShots)).toBe(true)
    expect(body.panel.directorShots).toHaveLength(0)
    expect(Array.isArray(body.panel.characters)).toBe(true)
    expect(Array.isArray(body.panel.props)).toBe(true)
    expect(body.project.videoRatio).toBe('9:16')

    resetAuthMockState()
  })

  it('rejects cross-user access with 403', async () => {
    const seeded = await seedMinimalDomainState()
    // Simulate a session for a different user AND flip the project-auth mock to forbidden,
    // which is how the real requireProjectAuthLight would react to a non-owner.
    mockAuthenticated('other-user-id')
    const { mockProjectAuth } = await import('../../../helpers/auth')
    mockProjectAuth('forbidden')

    const mod = await import('@/app/api/novel-promotion/[projectId]/director-desk/load/route')
    const response = await callRoute(
      mod.GET,
      'GET',
      undefined,
      {
        params: { projectId: seeded.project.id },
        query: { panelId: seeded.panel.id },
      },
    )
    expect(response.status).toBe(403)

    resetAuthMockState()
  })

  it('returns 400 when panelId is missing', async () => {
    const seeded = await seedMinimalDomainState()
    mockAuthenticated(seeded.user.id)

    const mod = await import('@/app/api/novel-promotion/[projectId]/director-desk/load/route')
    const response = await callRoute(
      mod.GET,
      'GET',
      undefined,
      { params: { projectId: seeded.project.id } },
    )
    expect(response.status).toBe(400)

    resetAuthMockState()
  })
})
