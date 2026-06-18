import { NextRequest, NextResponse } from 'next/server'

import { requireAdminAuth } from '@/lib/admin/auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { parseUpdateArtStyleInput } from '@/lib/config-center/art-styles/route-input'
import { prisma } from '@/lib/prisma'

async function assertSystemArtStyle(styleId: string) {
  const artStyle = await prisma.artStyle.findUnique({
    where: { id: styleId },
    select: { id: true, scope: true },
  })

  if (!artStyle) {
    throw new ApiError('NOT_FOUND')
  }
  if (artStyle.scope !== 'system') {
    throw new ApiError('FORBIDDEN')
  }
}

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ styleId: string }> },
) => {
  const { styleId } = await context.params
  const authResult = await requireAdminAuth()
  if (authResult instanceof Response) return authResult

  await assertSystemArtStyle(styleId)
  const input = parseUpdateArtStyleInput(await request.json())

  const artStyle = await prisma.artStyle.update({
    where: { id: styleId },
    data: {
      ...input,
      updatedByUserId: authResult.user.id,
    },
  })

  return NextResponse.json({ artStyle })
})

export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ styleId: string }> },
) => {
  const { styleId } = await context.params
  const authResult = await requireAdminAuth()
  if (authResult instanceof Response) return authResult

  await assertSystemArtStyle(styleId)

  const artStyle = await prisma.artStyle.update({
    where: { id: styleId },
    data: {
      enabled: false,
      updatedByUserId: authResult.user.id,
    },
  })

  return NextResponse.json({ success: true, artStyle })
})
