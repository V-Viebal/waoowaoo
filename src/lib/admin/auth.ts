import type { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth/next'

import { isErrorResponse, requireUserAuth, type AuthSession } from '@/lib/api-auth'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

type AdminUser = {
  id: string
  name: string | null
  email: string | null
  role: string
}

/**
 * API 路由使用的管理员权限验证
 */
export async function requireAdminAuth(): Promise<
  | {
      session: AuthSession
      user: AdminUser
    }
  | NextResponse
> {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const user = await prisma.user.findUnique({
    where: { id: authResult.session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  })

  if (!user || user.role !== 'admin') {
    throw new ApiError('FORBIDDEN')
  }

  return {
    session: authResult.session,
    user,
  }
}

/**
 * 服务端组件使用的管理员权限验证（会自动重定向）
 */
export async function requireAdminServerSide(): Promise<boolean> {
  const session = await getServerSession(authOptions) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    redirect('/auth/signin')
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  })

  if (!user || user.role !== 'admin') {
    redirect('/profile')
  }

  return true
}
