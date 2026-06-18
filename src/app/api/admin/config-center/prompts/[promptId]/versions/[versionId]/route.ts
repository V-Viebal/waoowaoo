import { NextResponse } from 'next/server'

import { requireAdminAuth } from '@/lib/admin/auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { getCatalogVariables } from '@/lib/config-center/prompts/service'
import { PROMPT_VERSION_STATUS } from '@/lib/config-center/prompts/types'
import { findMissingPromptVariables } from '@/lib/config-center/prompts/validation'
import { prisma } from '@/lib/prisma'

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>
  } catch {}
  throw new ApiError('INVALID_PARAMS')
}

export const dynamic = 'force-dynamic'

export const PATCH = apiHandler(async (req, ctx) => {
  const authResult = await requireAdminAuth()
  if (authResult instanceof Response) return authResult

  const { promptId, versionId } = await ctx.params as { promptId?: string; versionId?: string }
  if (!promptId) throw new ApiError('INVALID_PARAMS', { field: 'promptId' })
  if (!versionId) throw new ApiError('INVALID_PARAMS', { field: 'versionId' })

  const body = await readJsonBody(req)
  if (body.action !== 'publish' && body.action !== 'disable') {
    throw new ApiError('INVALID_PARAMS', { field: 'action' })
  }

  const existing = await prisma.promptVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      content: true,
      promptDefinition: { select: { promptId: true } },
    },
  })
  if (!existing || existing.promptDefinition.promptId !== promptId) {
    throw new ApiError('NOT_FOUND')
  }

  if (body.action === 'publish') {
    const missing = findMissingPromptVariables(existing.content, getCatalogVariables(promptId))
    if (missing.length > 0) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PROMPT_VARIABLES_MISSING',
        missing,
      })
    }
  }

  const data = body.action === 'publish'
    ? {
        status: PROMPT_VERSION_STATUS.PUBLISHED,
        publishedAt: new Date(),
        publishedByUserId: authResult.user.id,
      }
    : {
        status: PROMPT_VERSION_STATUS.DISABLED,
        disabledAt: new Date(),
      }

  const version = await prisma.promptVersion.update({
    where: { id: versionId },
    data,
  })

  return NextResponse.json({ version })
})
