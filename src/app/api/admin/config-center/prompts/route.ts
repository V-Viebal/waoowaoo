import { NextResponse } from 'next/server'

import { requireAdminAuth } from '@/lib/admin/auth'
import { apiHandler } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async () => {
  const authResult = await requireAdminAuth()
  if (authResult instanceof Response) return authResult

  const prompts = await prisma.promptDefinition.findMany({
    orderBy: [{ category: 'asc' }, { promptId: 'asc' }],
    include: {
      versions: {
        orderBy: [{ locale: 'asc' }, { version: 'desc' }],
        take: 20,
        select: {
          id: true,
          promptDefinitionId: true,
          locale: true,
          version: true,
          status: true,
          content: true,
          createdByUserId: true,
          publishedByUserId: true,
          publishedAt: true,
          disabledAt: true,
          changeNote: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  })

  return NextResponse.json({ prompts })
})
