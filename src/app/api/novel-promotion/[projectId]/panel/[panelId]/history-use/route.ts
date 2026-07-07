import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { archiveToHistory, HISTORY_FIELD, parsePanelHistory } from '@/lib/novel-promotion/panel-history'

const URL_FIELD = { image: 'imageUrl', video: 'videoUrl' } as const

/**
 * POST /api/novel-promotion/[projectId]/panel/[panelId]/history-use
 *
 * Body: { mediaType: 'image' | 'video', url: string }
 *
 * Restores a previous version from history: archives the current URL back
 * into history and promotes the target URL as the current one.
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; panelId: string }> },
) => {
  const { projectId, panelId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = (await request.json().catch(() => ({}))) as { mediaType?: unknown; url?: unknown }
  const mediaType = body.mediaType === 'video' ? 'video' : body.mediaType === 'image' ? 'image' : null
  const targetUrl = typeof body.url === 'string' ? body.url.trim() : ''
  if (!mediaType || !targetUrl) throw new ApiError('INVALID_PARAMS')

  const historyField = HISTORY_FIELD[mediaType]
  const urlField = URL_FIELD[mediaType]

  const panel = await prisma.novelPromotionPanel.findFirst({
    where: {
      id: panelId,
      storyboard: { episode: { novelPromotionProject: { projectId } } },
    },
    select: { id: true, [urlField]: true, [historyField]: true },
  })
  if (!panel) throw new ApiError('NOT_FOUND')

  const panelRow = panel as Record<string, unknown>
  const entries = parsePanelHistory(panelRow[historyField] as string | null)
  if (!entries.some((e) => e.url === targetUrl)) throw new ApiError('INVALID_PARAMS')

  const currentUrl = panelRow[urlField] as string | null
  // No-op if target is already current (defensive against double-click / dirty state)
  if (currentUrl === targetUrl) return NextResponse.json({ success: true })

  const remainingEntries = entries.filter((e) => e.url !== targetUrl)
  const newHistoryJson = currentUrl
    ? archiveToHistory(JSON.stringify(remainingEntries), currentUrl)
    : JSON.stringify(remainingEntries)

  await prisma.novelPromotionPanel.update({
    where: { id: panelId },
    data: {
      [urlField]: targetUrl,
      [historyField]: newHistoryJson,
    },
  })

  return NextResponse.json({ success: true })
})
