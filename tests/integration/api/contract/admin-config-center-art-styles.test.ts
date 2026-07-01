import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/call-route'
import {
  GET as getArtStyles,
  POST as createArtStyle,
} from '@/app/api/admin/config-center/art-styles/route'
import {
  PATCH as updateArtStyle,
  DELETE as deleteArtStyle,
} from '@/app/api/admin/config-center/art-styles/[styleId]/route'
import {
  POST as generatePreview,
} from '@/app/api/admin/config-center/art-styles/[styleId]/generate-preview/route'

const { prismaMock, requireAdminAuthMock } = vi.hoisted(() => ({
  prismaMock: {
    artStyle: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  requireAdminAuthMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/admin/auth', () => ({
  requireAdminAuth: requireAdminAuthMock,
}))

// 屏蔽 storage 调用：默认让 previewImageUrl 原样透传（不 resolve 成 /m/ URL）
vi.mock('@/lib/media/attach', async () => {
  const actual = await vi.importActual<typeof import('@/lib/media/attach')>('@/lib/media/attach')
  return {
    ...actual,
    attachMediaFieldsToArtStyle: vi.fn(async (style: Record<string, unknown>) => style),
  }
})

// 屏蔽图片生成 API 调用
vi.mock('@/lib/generator-api', () => ({
  generateImage: vi.fn().mockResolvedValue({
    success: true,
    imageUrl: 'https://picsum.photos/seed/style-1-123456/400/400',
  }),
}))

// 屏蔽存储调用
vi.mock('@/lib/storage', () => ({
  generateUniqueKey: vi.fn().mockReturnValue('art-style-preview-test-key'),
  uploadObject: vi.fn().mockResolvedValue('stored-key'),
  getSignedUrl: vi.fn().mockReturnValue('https://picsum.photos/seed/style-1-123456/400/400'),
  downloadAndUploadImage: vi.fn().mockResolvedValue('stored-key'),
  toFetchableUrl: vi.fn().mockReturnValue('https://picsum.photos/seed/style-1-123456/400/400'),
}))

const adminAuth = {
  session: { user: { id: 'admin-user-1', email: 'admin@example.com', name: 'Admin' } },
  user: { id: 'admin-user-1', email: 'admin@example.com', name: 'Admin', role: 'admin' },
}

describe('admin config center art styles API contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAdminAuthMock.mockResolvedValue(adminAuth)
  })

  it('returns art styles for admin GET /api/admin/config-center/art-styles', async () => {
    const artStyles = [
      {
        id: 'style-1',
        scope: 'system',
        ownerUserId: null,
        name: 'Watercolor',
        description: 'Soft watercolor style',
        prompt: 'watercolor painting style, soft edges, vibrant colors',
        previewImageUrl: 'https://example.com/watercolor.jpg',
        sortOrder: 1,
        enabled: true,
        createdByUserId: 'admin-user-1',
        updatedByUserId: 'admin-user-1',
      },
    ]
    prismaMock.artStyle.findMany.mockResolvedValue(artStyles)

    const response = await callRoute(getArtStyles, 'GET')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ artStyles })
    expect(prismaMock.artStyle.findMany).toHaveBeenCalledWith({
      where: { scope: 'system' },
      orderBy: [
        { enabled: 'desc' },
        { sortOrder: 'asc' },
        { createdAt: 'asc' },
      ],
    })
  })

  it('returns admin guard Response as-is and does not query database', async () => {
    requireAdminAuthMock.mockResolvedValue(new Response('blocked', { status: 401 }))

    const response = await callRoute(getArtStyles, 'GET')
    const text = await response.text()

    expect(response.status).toBe(401)
    expect(text).toBe('blocked')
    expect(prismaMock.artStyle.findMany).not.toHaveBeenCalled()
  })

  it('rejects art style creation with empty name', async () => {
    const response = await callRoute(
      createArtStyle,
      'POST',
      { name: '   ', prompt: 'test prompt' },
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('INVALID_PARAMS')
    expect(prismaMock.artStyle.create).not.toHaveBeenCalled()
  })

  it('rejects art style creation with empty prompt', async () => {
    const response = await callRoute(
      createArtStyle,
      'POST',
      { name: 'Test Style', prompt: '   ' },
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('INVALID_PARAMS')
    expect(prismaMock.artStyle.create).not.toHaveBeenCalled()
  })

  it('creates a system art style with admin user id', async () => {
    const createdStyle = {
      id: 'style-1',
      scope: 'system',
      ownerUserId: null,
      name: 'Watercolor',
      description: 'Soft watercolor style',
      prompt: 'watercolor painting style',
      previewImageUrl: 'https://example.com/watercolor.jpg',
      sortOrder: 1,
      enabled: true,
      createdByUserId: 'admin-user-1',
      updatedByUserId: 'admin-user-1',
    }
    prismaMock.artStyle.create.mockResolvedValue(createdStyle)

    const response = await callRoute(
      createArtStyle,
      'POST',
      {
        name: '  Watercolor  ',
        description: '  Soft watercolor style  ',
        prompt: '  watercolor painting style  ',
        previewImageUrl: '  https://example.com/watercolor.jpg  ',
        sortOrder: 1,
        enabled: true,
      },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ artStyle: createdStyle })
    expect(prismaMock.artStyle.create).toHaveBeenCalledWith({
      data: {
        scope: 'system',
        ownerUserId: null,
        name: 'Watercolor',
        description: 'Soft watercolor style',
        prompt: 'watercolor painting style',
        previewImageUrl: 'https://example.com/watercolor.jpg',
        sortOrder: 1,
        enabled: true,
        createdByUserId: 'admin-user-1',
        updatedByUserId: 'admin-user-1',
      },
    })
  })

  it('updates a system art style with admin user id', async () => {
    const updatedStyle = {
      id: 'style-1',
      name: 'Watercolor V2',
      description: 'Updated description',
      prompt: 'updated prompt',
      sortOrder: 2,
      enabled: false,
    }
    prismaMock.artStyle.findUnique.mockResolvedValue({
      id: 'style-1',
      scope: 'system',
    })
    prismaMock.artStyle.update.mockResolvedValue(updatedStyle)

    const response = await callRoute(
      updateArtStyle,
      'PATCH',
      {
        name: '  Watercolor V2  ',
        description: '  Updated description  ',
        prompt: '  updated prompt  ',
        sortOrder: 2,
        enabled: false,
      },
      { params: { styleId: 'style-1' } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ artStyle: updatedStyle })
    expect(prismaMock.artStyle.findUnique).toHaveBeenCalledWith({
      where: { id: 'style-1' },
      select: { id: true, scope: true },
    })
    expect(prismaMock.artStyle.update).toHaveBeenCalledWith({
      where: { id: 'style-1' },
      data: {
        name: 'Watercolor V2',
        description: 'Updated description',
        prompt: 'updated prompt',
        sortOrder: 2,
        enabled: false,
        updatedByUserId: 'admin-user-1',
      },
    })
  })

  it('rejects update on non-system art styles', async () => {
    prismaMock.artStyle.findUnique.mockResolvedValue({
      id: 'user-style-1',
      scope: 'user',
      ownerUserId: 'user-1',
    })

    const response = await callRoute(
      updateArtStyle,
      'PATCH',
      { name: 'Hacked' },
      { params: { styleId: 'user-style-1' } },
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe('FORBIDDEN')
    expect(prismaMock.artStyle.update).not.toHaveBeenCalled()
  })

  it('soft deletes (disables) a system art style', async () => {
    const deletedStyle = {
      id: 'style-1',
      enabled: false,
    }
    prismaMock.artStyle.findUnique.mockResolvedValue({
      id: 'style-1',
      scope: 'system',
    })
    prismaMock.artStyle.update.mockResolvedValue(deletedStyle)

    const response = await callRoute(
      deleteArtStyle,
      'DELETE',
      undefined,
      { params: { styleId: 'style-1' } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, artStyle: deletedStyle })
    expect(prismaMock.artStyle.findUnique).toHaveBeenCalledWith({
      where: { id: 'style-1' },
      select: { id: true, scope: true },
    })
    expect(prismaMock.artStyle.update).toHaveBeenCalledWith({
      where: { id: 'style-1' },
      data: {
        enabled: false,
        updatedByUserId: 'admin-user-1',
      },
    })
  })

  it('rejects delete on non-system art styles', async () => {
    prismaMock.artStyle.findUnique.mockResolvedValue({
      id: 'user-style-1',
      scope: 'user',
      ownerUserId: 'user-1',
    })

    const response = await callRoute(
      deleteArtStyle,
      'DELETE',
      undefined,
      { params: { styleId: 'user-style-1' } },
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe('FORBIDDEN')
    expect(prismaMock.artStyle.update).not.toHaveBeenCalled()
  })

  it('generates preview and updates the art style', async () => {
    const artStyle = {
      id: 'style-1',
      scope: 'system',
      name: 'Watercolor',
      prompt: 'watercolor style',
    }
    const updatedStyle = {
      id: 'style-1',
      previewImageUrl: 'https://picsum.photos/seed/style-1-123456/400/400',
      updatedByUserId: 'admin-user-1',
    }
    prismaMock.artStyle.findUnique.mockResolvedValue(artStyle)
    prismaMock.artStyle.update.mockResolvedValue(updatedStyle)

    const response = await callRoute(
      generatePreview,
      'POST',
      { model: 'default' },
      { params: { styleId: 'style-1' } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.previewImageUrl).toBe('https://picsum.photos/seed/style-1-123456/400/400')
    expect(body.model).toBe('default')
    expect(prismaMock.artStyle.findUnique).toHaveBeenCalledWith({
      where: { id: 'style-1', scope: 'system' },
    })
    expect(prismaMock.artStyle.update).toHaveBeenCalledWith({
      where: { id: 'style-1' },
      data: {
        previewImageUrl: expect.stringContaining('picsum.photos'),
        updatedByUserId: 'admin-user-1',
      },
    })
  })

  it('returns 404 when generating preview for non-existent style', async () => {
    prismaMock.artStyle.findUnique.mockResolvedValue(null)

    const response = await callRoute(
      generatePreview,
      'POST',
      { model: 'default' },
      { params: { styleId: 'non-existent' } },
    )
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe('画风不存在')
    expect(prismaMock.artStyle.update).not.toHaveBeenCalled()
  })
})
