import { NextResponse } from 'next/server'

import { requireAdminAuth } from '@/lib/admin/auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

const ALLOWED_LOCALES = new Set(['zh', 'en'])

function readRequiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  throw new ApiError('INVALID_PARAMS', { field: key })
}

function readRequiredLocale(body: Record<string, unknown>): string {
  const locale = readRequiredString(body, 'locale')
  if (ALLOWED_LOCALES.has(locale)) return locale
  throw new ApiError('INVALID_PARAMS', { field: 'locale' })
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>
  } catch {}
  throw new ApiError('INVALID_PARAMS')
}

export const dynamic = 'force-dynamic'

export const PUT = apiHandler(async (req, ctx) => {
  const authResult = await requireAdminAuth()
  if (authResult instanceof Response) return authResult

  const { projectId } = await ctx.params as { projectId?: string }
  if (!projectId) throw new ApiError('INVALID_PARAMS', { field: 'projectId' })

  const body = await readJsonBody(req)
  const promptDefinitionId = readRequiredString(body, 'promptDefinitionId')
  const promptVersionId = readRequiredString(body, 'promptVersionId')
  const locale = readRequiredLocale(body)
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null

  const promptVersion = await prisma.promptVersion.findUnique({
    where: { id: promptVersionId },
    select: { id: true, promptDefinitionId: true, locale: true },
  })

  if (
    !promptVersion
    || promptVersion.promptDefinitionId !== promptDefinitionId
    || promptVersion.locale !== locale
  ) {
    throw new ApiError('INVALID_PARAMS', { field: 'promptVersionId' })
  }

  const override = await prisma.projectPromptOverride.upsert({
    where: {
      projectId_promptDefinitionId_locale: {
        projectId,
        promptDefinitionId,
        locale,
      },
    },
    create: {
      projectId,
      promptDefinitionId,
      locale,
      promptVersionId,
      reason,
      createdByUserId: authResult.user.id,
    },
    update: {
      promptVersionId,
      reason,
      createdByUserId: authResult.user.id,
    },
  })

  return NextResponse.json({ override })
})
