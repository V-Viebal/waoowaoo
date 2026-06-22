import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { buildMockRequest } from '../../helpers/request'

const authMock = vi.hoisted(() => ({
  currentUserId: undefined as string | undefined,
  getAuthSession: vi.fn(),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

vi.mock('@/lib/api-auth', () => ({
  getAuthSession: authMock.getAuthSession,
  isErrorResponse: authMock.isErrorResponse,
  unauthorized: (message = 'Unauthorized') => NextResponse.json(
    {
      success: false,
      error: { code: 'UNAUTHORIZED', message },
      code: 'UNAUTHORIZED',
      message,
    },
    { status: 401 },
  ),
  notFound: (resource = 'Resource') => NextResponse.json(
    {
      success: false,
      error: { code: 'NOT_FOUND', message: `${resource} not found` },
      code: 'NOT_FOUND',
      message: `${resource} not found`,
    },
    { status: 404 },
  ),
}))

const runId = randomUUID()

function routeContext(projectId: string) {
  return { params: Promise.resolve({ projectId }) }
}

function editorPath(projectId: string) {
  return `/api/novel-promotion/${projectId}/editor`
}

function putRequest(projectId: string, body: unknown) {
  return buildMockRequest({
    path: editorPath(projectId),
    method: 'PUT',
    body,
  })
}

describe('editor project API', () => {
  let ownerUserId: string
  let otherUserId: string
  let projectId: string
  let otherProjectId: string
  let novelPromotionProjectId: string
  let otherNovelPromotionProjectId: string
  let episodeId: string
  let secondEpisodeId: string
  let thirdEpisodeId: string
  let otherEpisodeId: string

  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: {
        email: `editor-api-owner-${runId}@example.com`,
        name: `editor-api-owner-${runId}`,
      },
    })
    ownerUserId = owner.id

    const other = await prisma.user.create({
      data: {
        email: `editor-api-other-${runId}@example.com`,
        name: `editor-api-other-${runId}`,
      },
    })
    otherUserId = other.id

    const project = await prisma.project.create({
      data: {
        userId: ownerUserId,
        name: 'Editor API Project',
      },
    })
    projectId = project.id

    const otherProject = await prisma.project.create({
      data: {
        userId: otherUserId,
        name: 'Other Editor API Project',
      },
    })
    otherProjectId = otherProject.id

    const novelPromotionProject = await prisma.novelPromotionProject.create({
      data: { projectId },
    })
    novelPromotionProjectId = novelPromotionProject.id

    const otherNovelPromotionProject = await prisma.novelPromotionProject.create({
      data: { projectId: otherProjectId },
    })
    otherNovelPromotionProjectId = otherNovelPromotionProject.id

    const [episode, secondEpisode, thirdEpisode, otherEpisode] = await Promise.all([
      prisma.novelPromotionEpisode.create({
        data: {
          novelPromotionProjectId,
          episodeNumber: 1,
          name: 'Editor API Episode 1',
        },
      }),
      prisma.novelPromotionEpisode.create({
        data: {
          novelPromotionProjectId,
          episodeNumber: 2,
          name: 'Editor API Episode 2',
        },
      }),
      prisma.novelPromotionEpisode.create({
        data: {
          novelPromotionProjectId,
          episodeNumber: 3,
          name: 'Editor API Episode 3',
        },
      }),
      prisma.novelPromotionEpisode.create({
        data: {
          novelPromotionProjectId: otherNovelPromotionProjectId,
          episodeNumber: 1,
          name: 'Other Editor API Episode',
        },
      }),
    ])

    episodeId = episode.id
    secondEpisodeId = secondEpisode.id
    thirdEpisodeId = thirdEpisode.id
    otherEpisodeId = otherEpisode.id
  })

  beforeEach(() => {
    vi.clearAllMocks()
    authMock.currentUserId = ownerUserId
    authMock.getAuthSession.mockImplementation(async () => {
      if (!authMock.currentUserId) return null
      return { session: { user: { id: authMock.currentUserId } } }.session
    })
  })

  afterAll(async () => {
    if (ownerUserId) {
      await prisma.user.delete({ where: { id: ownerUserId } }).catch(() => undefined)
    }
    if (otherUserId) {
      await prisma.user.delete({ where: { id: otherUserId } }).catch(() => undefined)
    }
    await prisma.$disconnect()
  })

  it('GET returns 401 when unauthenticated', async () => {
    authMock.currentUserId = undefined
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/editor/route')
    const req = buildMockRequest({
      path: editorPath(projectId),
      method: 'GET',
      query: { episodeId },
    })

    const res = await GET(req, routeContext(projectId))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('GET returns 404 for another user project', async () => {
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/editor/route')
    const req = buildMockRequest({
      path: editorPath(otherProjectId),
      method: 'GET',
      query: { episodeId: otherEpisodeId },
    })

    const res = await GET(req, routeContext(otherProjectId))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('PUT creates a new editor project with version 1', async () => {
    const { PUT } = await import('@/app/api/novel-promotion/[projectId]/editor/route')
    const projectData = { tracks: [{ id: 'video-1', type: 'video' }], duration: 1200 }
    const req = putRequest(projectId, {
      episodeId,
      projectData,
    })

    const res = await PUT(req, routeContext(projectId))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.episodeId).toBe(episodeId)
    expect(body.data.projectData).toEqual(projectData)
    expect(body.data.version).toBe(1)

    const saved = await prisma.novelPromotionEditorProject.findUniqueOrThrow({ where: { episodeId } })
    expect(saved.version).toBe(1)
    expect(saved.projectData).toEqual(projectData)
  })

  it('PUT updates an existing editor project and increments version', async () => {
    const { PUT } = await import('@/app/api/novel-promotion/[projectId]/editor/route')
    await prisma.novelPromotionEditorProject.create({
      data: {
        episodeId: secondEpisodeId,
        projectData: { tracks: [] },
        version: 1,
      },
    })

    const nextProjectData = { tracks: [{ id: 'audio-1', type: 'audio' }], duration: 2400 }
    const req = putRequest(projectId, {
      episodeId: secondEpisodeId,
      projectData: nextProjectData,
      version: 1,
    })

    const res = await PUT(req, routeContext(projectId))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.projectData).toEqual(nextProjectData)
    expect(body.data.version).toBe(2)

    const saved = await prisma.novelPromotionEditorProject.findUniqueOrThrow({ where: { episodeId: secondEpisodeId } })
    expect(saved.version).toBe(2)
    expect(saved.projectData).toEqual(nextProjectData)
  })

  it('PUT returns 409 when version conflicts', async () => {
    const { PUT } = await import('@/app/api/novel-promotion/[projectId]/editor/route')
    await prisma.novelPromotionEditorProject.create({
      data: {
        episodeId: thirdEpisodeId,
        projectData: { tracks: [{ id: 'old' }] },
        version: 3,
      },
    })

    const req = putRequest(projectId, {
      episodeId: thirdEpisodeId,
      projectData: { tracks: [{ id: 'new' }] },
      version: 2,
    })

    const res = await PUT(req, routeContext(projectId))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error.code).toBe('CONFLICT')
    expect(body.error.details.currentVersion).toBe(3)

    const saved = await prisma.novelPromotionEditorProject.findUniqueOrThrow({ where: { episodeId: thirdEpisodeId } })
    expect(saved.version).toBe(3)
    expect(saved.projectData).toEqual({ tracks: [{ id: 'old' }] })
  })
})
