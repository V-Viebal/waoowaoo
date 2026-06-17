import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { requireAdminAuth } from '@/lib/admin/auth'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

describe('requireAdminAuth', () => {
  const session = {
    user: {
      id: 'user-1',
      name: '普通用户',
      email: 'user@example.com',
    },
  }

  beforeEach(() => {
    authMock.requireUserAuth.mockReset()
    authMock.isErrorResponse.mockClear()
    prismaMock.user.findUnique.mockReset()
  })

  it('原样返回 requireUserAuth 的错误响应且不查询数据库', async () => {
    const response = NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
    authMock.requireUserAuth.mockResolvedValue(response)

    const result = await requireAdminAuth()

    expect(result).toBe(response)
    expect(authMock.isErrorResponse).toHaveBeenCalledWith(response)
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled()
  })

  it('登录用户不是管理员时抛出 FORBIDDEN', async () => {
    authMock.requireUserAuth.mockResolvedValue({ session })
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      name: '普通用户',
      email: 'user@example.com',
      role: 'user',
    })

    await expect(requireAdminAuth()).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('登录用户在数据库不存在时抛出 FORBIDDEN', async () => {
    authMock.requireUserAuth.mockResolvedValue({ session })
    prismaMock.user.findUnique.mockResolvedValue(null)

    await expect(requireAdminAuth()).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('管理员用户返回 session 和包含 role 的用户信息', async () => {
    const adminSession = {
      user: {
        id: 'admin-1',
        name: '管理员',
        email: 'admin@example.com',
      },
    }
    const adminUser = {
      id: 'admin-1',
      name: '管理员',
      email: 'admin@example.com',
      role: 'admin',
    }
    authMock.requireUserAuth.mockResolvedValue({ session: adminSession })
    prismaMock.user.findUnique.mockResolvedValue(adminUser)

    await expect(requireAdminAuth()).resolves.toEqual({
      session: adminSession,
      user: adminUser,
    })
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    })
  })
})
