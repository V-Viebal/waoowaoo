import { NextRequest, NextResponse } from 'next/server'

import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { parseCreateArtStyleInput } from '@/lib/config-center/art-styles/route-input'
import { listAvailableArtStyles } from '@/lib/config-center/art-styles/service'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const artStyles = await listAvailableArtStyles(session.user.id)

  return NextResponse.json({ artStyles })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const input = parseCreateArtStyleInput(await request.json())
  const artStyle = await prisma.artStyle.create({
    data: {
      scope: 'user',
      ownerUserId: session.user.id,
      name: input.name,
      description: input.description,
      prompt: input.prompt,
      previewImageUrl: input.previewImageUrl,
      sortOrder: input.sortOrder,
      enabled: input.enabled,
      createdByUserId: session.user.id,
      updatedByUserId: session.user.id,
    },
  })

  return NextResponse.json({ artStyle })
})
