import { NextRequest, NextResponse } from 'next/server'

import { requireAdminAuth } from '@/lib/admin/auth'
import { apiHandler } from '@/lib/api-errors'
import { parseCreateArtStyleInput } from '@/lib/config-center/art-styles/route-input'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async () => {
  const authResult = await requireAdminAuth()
  if (authResult instanceof Response) return authResult

  const artStyles = await prisma.artStyle.findMany({
    where: { scope: 'system' },
    orderBy: [
      { enabled: 'desc' },
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
    ],
  })

  return NextResponse.json({ artStyles })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireAdminAuth()
  if (authResult instanceof Response) return authResult

  const input = parseCreateArtStyleInput(await request.json())
  const artStyle = await prisma.artStyle.create({
    data: {
      scope: 'system',
      ownerUserId: null,
      name: input.name,
      description: input.description,
      prompt: input.prompt,
      previewImageUrl: input.previewImageUrl,
      sortOrder: input.sortOrder,
      enabled: input.enabled,
      createdByUserId: authResult.user.id,
      updatedByUserId: authResult.user.id,
    },
  })

  return NextResponse.json({ artStyle })
})
