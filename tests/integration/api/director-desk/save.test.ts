import { describe, it, expect, beforeEach, vi } from 'vitest'
import sharp from 'sharp'

// Mock storage + media BEFORE importing the route (module-mock hoisting)
vi.mock('@/lib/storage', () => ({
  uploadObject: vi.fn(async (_body: Buffer, key: string) => key),
  generateUniqueKey: vi.fn((prefix: string, ext: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}.${ext}`),
  getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`),
  extractStorageKey: vi.fn((v: string | null | undefined) => v ?? null),
}))

vi.mock('@/lib/media/service', async () => {
  const { prisma } = await import('../../../helpers/prisma')
  let counter = 0
  return {
    ensureMediaObjectFromStorageKey: vi.fn(async (storageKey: string) => {
      counter += 1
      const publicId = `test-director-${counter}-${Math.random().toString(36).slice(2, 8)}`
      // Create a real MediaObject so the FK constraint on NovelPromotionDirectorShot.imageMediaId holds.
      const row = await prisma.mediaObject.create({
        data: {
          publicId,
          storageKey,
          mimeType: 'image/jpeg',
        },
      })
      return { id: row.id, storageKey }
    }),
  }
})

import { callRoute } from '../helpers/call-route'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../../helpers/auth'
import { resetSystemState } from '../../../helpers/db-reset'
import { prisma } from '../../../helpers/prisma'
import { seedMinimalDomainState } from '../../../system/helpers/seed'

let TINY_JPEG_DATA_URL = ''

async function ensureJpegDataUrl() {
  if (TINY_JPEG_DATA_URL) return TINY_JPEG_DATA_URL
  const buf = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .jpeg()
    .toBuffer()
  TINY_JPEG_DATA_URL = `data:image/jpeg;base64,${buf.toString('base64')}`
  return TINY_JPEG_DATA_URL
}

function defaultProject() {
  return {
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
  }
}

function buildShot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    cameraId: 'cam-1',
    name: '机位1',
    isActive: true,
    fov: 50,
    position: [0, 1.55, 5.4],
    target: [0, 1.05, 0],
    snapshotDataUrl: TINY_JPEG_DATA_URL,
    ...overrides,
  }
}

describe('director-desk save route', () => {
  beforeEach(async () => {
    await resetSystemState()
    installAuthMocks()
    await ensureJpegDataUrl()
  })

  it('happy path: saves layout + shot, writes directorLayout, creates one directorShot', async () => {
    const seeded = await seedMinimalDomainState()
    mockAuthenticated(seeded.user.id)

    const mod = await import('@/app/api/novel-promotion/[projectId]/director-desk/save/route')
    const response = await callRoute(
      mod.POST,
      'POST',
      {
        panelId: seeded.panel.id,
        project: defaultProject(),
        shots: [buildShot()],
      },
      { params: { projectId: seeded.project.id } },
    )

    expect(response.status).toBe(200)
    const body = await response.json() as { success: boolean; shotIds: string[]; warning?: string }
    expect(body.success).toBe(true)
    expect(body.warning).toBeUndefined()

    const panel = await prisma.novelPromotionPanel.findUnique({ where: { id: seeded.panel.id } })
    expect(panel?.directorLayout).toBeTruthy()

    const shots = await prisma.novelPromotionDirectorShot.findMany({ where: { panelId: seeded.panel.id } })
    expect(shots).toHaveLength(1)
    expect(shots[0].isActive).toBe(true)
    expect(shots[0].cameraId).toBe('cam-1')

    resetAuthMockState()
  })

  it('multiple shots — only one isActive after normalization (last-marked wins is not required; last is active)', async () => {
    const seeded = await seedMinimalDomainState()
    mockAuthenticated(seeded.user.id)

    const mod = await import('@/app/api/novel-promotion/[projectId]/director-desk/save/route')
    const response = await callRoute(
      mod.POST,
      'POST',
      {
        panelId: seeded.panel.id,
        project: defaultProject(),
        shots: [
          buildShot({ cameraId: 'cam-a', isActive: false }),
          buildShot({ cameraId: 'cam-b', isActive: false }),
          buildShot({ cameraId: 'cam-c', isActive: true }),
        ],
      },
      { params: { projectId: seeded.project.id } },
    )
    expect(response.status).toBe(200)

    const shots = await prisma.novelPromotionDirectorShot.findMany({
      where: { panelId: seeded.panel.id },
    })
    expect(shots).toHaveLength(3)
    const activeShots = shots.filter((s) => s.isActive)
    expect(activeShots).toHaveLength(1)
    expect(activeShots[0].cameraId).toBe('cam-c')

    resetAuthMockState()
  })

  it('returns 400 for corrupt project JSON', async () => {
    const seeded = await seedMinimalDomainState()
    mockAuthenticated(seeded.user.id)

    const mod = await import('@/app/api/novel-promotion/[projectId]/director-desk/save/route')
    const response = await callRoute(
      mod.POST,
      'POST',
      {
        panelId: seeded.panel.id,
        project: { version: 999, garbage: true },
        shots: [],
      },
      { params: { projectId: seeded.project.id } },
    )
    expect(response.status).toBe(400)

    resetAuthMockState()
  })

  it('rejects more than 8 shots', async () => {
    const seeded = await seedMinimalDomainState()
    mockAuthenticated(seeded.user.id)

    const mod = await import('@/app/api/novel-promotion/[projectId]/director-desk/save/route')
    const nine = Array.from({ length: 9 }, (_, i) => buildShot({ cameraId: `cam-${i}`, isActive: false }))
    const response = await callRoute(
      mod.POST,
      'POST',
      {
        panelId: seeded.panel.id,
        project: defaultProject(),
        shots: nine,
      },
      { params: { projectId: seeded.project.id } },
    )
    expect(response.status).toBe(400)

    resetAuthMockState()
  })
})
