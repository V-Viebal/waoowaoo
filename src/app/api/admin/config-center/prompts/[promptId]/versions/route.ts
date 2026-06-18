import { NextResponse } from 'next/server'

import { requireAdminAuth } from '@/lib/admin/auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { getCatalogVariables } from '@/lib/config-center/prompts/service'
import { PROMPT_VERSION_STATUS } from '@/lib/config-center/prompts/types'
import { findMissingPromptVariables } from '@/lib/config-center/prompts/validation'

const ALLOWED_LOCALES = new Set(['zh', 'en'])

function normalizeLocale(value: unknown): string {
  if (value == null || value === '') return 'zh'
  if (typeof value === 'string' && ALLOWED_LOCALES.has(value)) return value
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

export const POST = apiHandler(async (req, ctx) => {
  const authResult = await requireAdminAuth()
  if (authResult instanceof Response) return authResult

  const { promptId } = await ctx.params as { promptId?: string }
  if (!promptId) throw new ApiError('INVALID_PARAMS', { field: 'promptId' })

  const body = await readJsonBody(req)
  const locale = normalizeLocale(body.locale)
  const content = body.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new ApiError('INVALID_PARAMS', { field: 'content' })
  }

  const definition = await prisma.promptDefinition.findUnique({
    where: { promptId },
  })
  if (!definition) throw new ApiError('NOT_FOUND')

  const missing = findMissingPromptVariables(content, getCatalogVariables(promptId))
  if (missing.length > 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROMPT_VARIABLES_MISSING',
      missing,
    })
  }

  const latest = await prisma.promptVersion.findFirst({
    where: { promptDefinitionId: definition.id, locale },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  const changeNote = typeof body.changeNote === 'string' && body.changeNote.trim()
    ? body.changeNote.trim()
    : null

  const version = await prisma.promptVersion.create({
    data: {
      promptDefinitionId: definition.id,
      locale,
      version: (latest?.version || 0) + 1,
      status: PROMPT_VERSION_STATUS.DRAFT,
      content,
      changeNote,
      createdByUserId: authResult.user.id,
    },
  })

  return NextResponse.json({ version })
})
