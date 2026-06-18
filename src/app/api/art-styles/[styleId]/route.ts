import { NextRequest, NextResponse } from 'next/server'

import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { parseUpdateArtStyleInput } from '@/lib/config-center/art-styles/route-input'
import { prisma } from '@/lib/prisma'

async function assertOwnedUserArtStyle(styleId: string, userId: string) {
  const artStyle = await prisma.artStyle.findUnique({
    where: { id: styleId },
    select: { id: true, scope: true, ownerUserId: true },
  })

  if (!artStyle || artStyle.scope !== 'user' || artStyle.ownerUserId !== userId) {
    throw new ApiError('FORBIDDEN')
  }
}

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ styleId: string }> },
) => {
  const { styleId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  await assertOwnedUserArtStyle(styleId, session.user.id)
  const input = parseUpdateArtStyleInput(await request.json())

  const artStyle = await prisma.artStyle.update({
    where: { id: styleId },
    data: {
      ...input,
      updatedByUserId: session.user.id,
    },
  })

  return NextResponse.json({ artStyle })
})

export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ styleId: string }> },
) => {
  const { styleId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  await assertOwnedUserArtStyle(styleId, session.user.id)

  const artStyle = await prisma.artStyle.update({
    where: { id: styleId },
    data: {
      enabled: false,
      updatedByUserId: session.user.id,
    },
  })

  return NextResponse.json({ success: true, artStyle })
})
