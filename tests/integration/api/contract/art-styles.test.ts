import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/call-route'
import { GET as listUserArtStyles, POST as createUserArtStyle } from '@/app/api/art-styles/route'
import { PATCH as updateUserArtStyle, DELETE as deleteUserArtStyle } from '@/app/api/art-styles/[styleId]/route'
import {
  GET as listSystemArtStyles,
  POST as createSystemArtStyle,
} from '@/app/api/admin/config-center/art-styles/route'
import {
  PATCH as updateSystemArtStyle,
  DELETE as deleteSystemArtStyle,
} from '@/app/api/admin/config-center/art-styles/[styleId]/route'

const { prismaMock, requireUserAuthMock, requireAdminAuthMock } = vi.hoisted(() => ({
  prismaMock: {
    artStyle: {
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  requireUserAuthMock: vi.fn(),
  requireAdminAuthMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/api-auth', () => ({
  requireUserAuth: requireUserAuthMock,
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

vi.mock('@/lib/admin/auth', () => ({
  requireAdminAuth: requireAdminAuthMock,
}))

const userAuth = {
  session: { user: { id: 'user-1', email: 'user@example.com', name: 'User' } },
}

const adminAuth = {
  session: { user: { id: 'admin-user-1', email: 'admin@example.com', name: 'Admin' } },
  user: { id: 'admin-user-1', email: 'admin@example.com', name: 'Admin', role: 'admin' },
}

describe('art styles API contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUserAuthMock.mockResolvedValue(userAuth)
    requireAdminAuthMock.mockResolvedValue(adminAuth)
  })

  it('lists enabled system and current user art styles for a normal user', async () => {
    const styles = [
      { id: 'system-1', scope: 'system', ownerUserId: null, name: 'System', prompt: 'system prompt' },
      { id: 'user-style-1', scope: 'user', ownerUserId: 'user-1', name: 'Mine', prompt: 'mine prompt' },
    ]
    prismaMock.artStyle.findMany.mockResolvedValue(styles)

    const response = await callRoute(listUserArtStyles, 'GET')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ artStyles: styles })
    expect(prismaMock.artStyle.findMany).toHaveBeenCalledWith({
      where: {
        enabled: true,
        OR: [
          { scope: 'system' },
          { scope: 'user', ownerUserId: 'user-1' },
        ],
      },
      orderBy: [
        { scope: 'asc' },
        { sortOrder: 'asc' },
        { createdAt: 'asc' },
      ],
    })
  })

  it('creates a user scoped art style for the current user', async () => {
    const createdStyle = {
      id: 'user-style-1',
      scope: 'user',
      ownerUserId: 'user-1',
      name: 'Ink',
      description: 'Line heavy',
      prompt: 'black ink line art',
      previewImageUrl: 'https://example.com/ink.png',
      sortOrder: 7,
      enabled: true,
    }
    prismaMock.artStyle.create.mockResolvedValue(createdStyle)

    const response = await callRoute(createUserArtStyle, 'POST', {
      name: '  Ink  ',
      description: '  Line heavy  ',
      prompt: '  black ink line art  ',
      previewImageUrl: '  https://example.com/ink.png  ',
      sortOrder: 7,
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ artStyle: createdStyle })
    expect(prismaMock.artStyle.create).toHaveBeenCalledWith({
      data: {
        scope: 'user',
        ownerUserId: 'user-1',
        name: 'Ink',
        description: 'Line heavy',
        prompt: 'black ink line art',
        previewImageUrl: 'https://example.com/ink.png',
        sortOrder: 7,
        enabled: true,
        createdByUserId: 'user-1',
        updatedByUserId: 'user-1',
      },
    })
  })

  it('updates only the current user owned user art style', async () => {
    prismaMock.artStyle.findUnique.mockResolvedValue({
      id: 'user-style-1',
      scope: 'user',
      ownerUserId: 'user-1',
    })
    const updatedStyle = { id: 'user-style-1', name: 'Ink v2', prompt: 'new prompt' }
    prismaMock.artStyle.update.mockResolvedValue(updatedStyle)

    const response = await callRoute(
      updateUserArtStyle,
      'PATCH',
      { name: ' Ink v2 ', prompt: ' new prompt ' },
      { params: { styleId: 'user-style-1' } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ artStyle: updatedStyle })
    expect(prismaMock.artStyle.update).toHaveBeenCalledWith({
      where: { id: 'user-style-1' },
      data: {
        name: 'Ink v2',
        prompt: 'new prompt',
        updatedByUserId: 'user-1',
      },
    })
  })

  it('forbids a normal user from updating system or other-user art styles', async () => {
    prismaMock.artStyle.findUnique.mockResolvedValue({
      id: 'system-1',
      scope: 'system',
      ownerUserId: null,
    })

    const response = await callRoute(
      updateUserArtStyle,
      'PATCH',
      { name: 'Blocked' },
      { params: { styleId: 'system-1' } },
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe('FORBIDDEN')
    expect(prismaMock.artStyle.update).not.toHaveBeenCalled()
  })

  it('forbids a normal user from updating another user owned art style', async () => {
    prismaMock.artStyle.findUnique.mockResolvedValue({
      id: 'other-user-style',
      scope: 'user',
      ownerUserId: 'user-2',
    })

    const response = await callRoute(
      updateUserArtStyle,
      'PATCH',
      { name: 'Blocked' },
      { params: { styleId: 'other-user-style' } },
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe('FORBIDDEN')
    expect(prismaMock.artStyle.update).not.toHaveBeenCalled()
  })

  it('forbids a normal user from deleting another user owned art style', async () => {
    prismaMock.artStyle.findUnique.mockResolvedValue({
      id: 'other-user-style',
      scope: 'user',
      ownerUserId: 'user-2',
    })

    const response = await callRoute(
      deleteUserArtStyle,
      'DELETE',
      undefined,
      { params: { styleId: 'other-user-style' } },
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe('FORBIDDEN')
    expect(prismaMock.artStyle.update).not.toHaveBeenCalled()
  })

  it('soft deletes a current user owned user art style', async () => {
    prismaMock.artStyle.findUnique.mockResolvedValue({
      id: 'user-style-1',
      scope: 'user',
      ownerUserId: 'user-1',
    })
    const deletedStyle = { id: 'user-style-1', enabled: false }
    prismaMock.artStyle.update.mockResolvedValue(deletedStyle)

    const response = await callRoute(
      deleteUserArtStyle,
      'DELETE',
      undefined,
      { params: { styleId: 'user-style-1' } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, artStyle: deletedStyle })
    expect(prismaMock.artStyle.update).toHaveBeenCalledWith({
      where: { id: 'user-style-1' },
      data: {
        enabled: false,
        updatedByUserId: 'user-1',
      },
    })
  })

  it('returns admin guard response as-is for system art style routes', async () => {
    requireAdminAuthMock.mockResolvedValue(new Response('blocked', { status: 401 }))

    const response = await callRoute(listSystemArtStyles, 'GET')
    const text = await response.text()

    expect(response.status).toBe(401)
    expect(text).toBe('blocked')
    expect(prismaMock.artStyle.findMany).not.toHaveBeenCalled()
  })

  it('creates a system art style as an admin', async () => {
    const createdStyle = {
      id: 'system-2',
      scope: 'system',
      ownerUserId: null,
      name: 'Cinematic',
      prompt: 'cinematic image prompt',
      enabled: true,
    }
    prismaMock.artStyle.create.mockResolvedValue(createdStyle)

    const response = await callRoute(createSystemArtStyle, 'POST', {
      name: ' Cinematic ',
      prompt: ' cinematic image prompt ',
      sortOrder: 3,
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ artStyle: createdStyle })
    expect(prismaMock.artStyle.create).toHaveBeenCalledWith({
      data: {
        scope: 'system',
        ownerUserId: null,
        name: 'Cinematic',
        description: null,
        prompt: 'cinematic image prompt',
        previewImageUrl: null,
        sortOrder: 3,
        enabled: true,
        createdByUserId: 'admin-user-1',
        updatedByUserId: 'admin-user-1',
      },
    })
  })

  it('updates only system scoped art styles as an admin', async () => {
    prismaMock.artStyle.findUnique.mockResolvedValue({
      id: 'system-1',
      scope: 'system',
      ownerUserId: null,
    })
    const updatedStyle = { id: 'system-1', name: 'Cinematic v2' }
    prismaMock.artStyle.update.mockResolvedValue(updatedStyle)

    const response = await callRoute(
      updateSystemArtStyle,
      'PATCH',
      { name: ' Cinematic v2 ', enabled: false },
      { params: { styleId: 'system-1' } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ artStyle: updatedStyle })
    expect(prismaMock.artStyle.update).toHaveBeenCalledWith({
      where: { id: 'system-1' },
      data: {
        name: 'Cinematic v2',
        enabled: false,
        updatedByUserId: 'admin-user-1',
      },
    })
  })

  it('forbids admin updates on user scoped art styles', async () => {
    prismaMock.artStyle.findUnique.mockResolvedValue({
      id: 'user-style-1',
      scope: 'user',
      ownerUserId: 'user-1',
    })

    const response = await callRoute(
      updateSystemArtStyle,
      'PATCH',
      { name: 'Blocked' },
      { params: { styleId: 'user-style-1' } },
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe('FORBIDDEN')
    expect(prismaMock.artStyle.update).not.toHaveBeenCalled()
  })

  it('forbids admin deletes on user scoped art styles', async () => {
    prismaMock.artStyle.findUnique.mockResolvedValue({
      id: 'user-style-1',
      scope: 'user',
      ownerUserId: 'user-1',
    })

    const response = await callRoute(
      deleteSystemArtStyle,
      'DELETE',
      undefined,
      { params: { styleId: 'user-style-1' } },
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe('FORBIDDEN')
    expect(prismaMock.artStyle.update).not.toHaveBeenCalled()
  })

  it('soft deletes a system art style as an admin', async () => {
    prismaMock.artStyle.findUnique.mockResolvedValue({
      id: 'system-1',
      scope: 'system',
      ownerUserId: null,
    })
    const deletedStyle = { id: 'system-1', enabled: false }
    prismaMock.artStyle.update.mockResolvedValue(deletedStyle)

    const response = await callRoute(
      deleteSystemArtStyle,
      'DELETE',
      undefined,
      { params: { styleId: 'system-1' } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, artStyle: deletedStyle })
    expect(prismaMock.artStyle.update).toHaveBeenCalledWith({
      where: { id: 'system-1' },
      data: {
        enabled: false,
        updatedByUserId: 'admin-user-1',
      },
    })
  })
})
