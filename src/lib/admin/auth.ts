import type { NextResponse } from 'next/server'

import { isErrorResponse, requireUserAuth, type AuthSession } from '@/lib/api-auth'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

type AdminUser = {
  id: string
  name: string | null
  email: string | null
  role: string
}

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
