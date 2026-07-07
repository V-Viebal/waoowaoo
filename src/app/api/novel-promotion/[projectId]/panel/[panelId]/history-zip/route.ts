import { NextRequest } from 'next/server'
import path from 'node:path'
import archiver from 'archiver'
import { prisma } from '@/lib/prisma'
import { getObjectBuffer } from '@/lib/storage'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { logInfo, logError, logWarn } from '@/lib/logging/core'
import { HISTORY_FIELD, parsePanelHistory } from '@/lib/novel-promotion/panel-history'

/**
 * GET /api/novel-promotion/[projectId]/panel/[panelId]/history-zip?type=image|video
 *
 * Streams a ZIP of all history entries for the given panel/media type.
 * Follows the ReadableStream + archiver pattern from download-images/route.ts.
 */

function extFromKey(key: string): string {
  const ext = path.extname(key).toLowerCase().replace(/^\./, '')
  if (!ext) return 'bin'
  return ext === 'jpeg' ? 'jpg' : ext
}

function formatZipName(timestamp: string, index: number, url: string): string {
  const d = new Date(timestamp)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const stamp = Number.isNaN(d.getTime())
    ? '00000000-000000000'
    : `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
      + `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}${pad(d.getUTCMilliseconds(), 3)}`
  const idx = pad(index, 3)
  const ext = extFromKey(url)
  return `${stamp}_${idx}.${ext}`
}

function sanitizeFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'panel'
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; panelId: string }> },
) => {
  const { projectId, panelId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { project } = authResult

  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type')
  if (type !== 'image' && type !== 'video') throw new ApiError('INVALID_PARAMS')
  const field = HISTORY_FIELD[type]

  const panel = await prisma.novelPromotionPanel.findFirst({
    where: {
      id: panelId,
      storyboard: { episode: { novelPromotionProject: { projectId } } },
    },
    select: { id: true, panelIndex: true, panelNumber: true, [field]: true },
  })
  if (!panel) throw new ApiError('NOT_FOUND')

  const entries = parsePanelHistory((panel as Record<string, unknown>)[field] as string | null)
  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  if (entries.length === 0) throw new ApiError('INVALID_PARAMS')

  logInfo(`Preparing history zip: project=${projectId} panel=${panelId} type=${type} count=${entries.length}`)

  const archive = archiver('zip', { zlib: { level: 9 } })

  const stream = new ReadableStream({
    start(controller) {
      archive.on('data', (chunk) => controller.enqueue(chunk))
      archive.on('end', () => controller.close())
      archive.on('error', (err) => controller.error(err))
      processEntries()
    },
  })

  async function processEntries() {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const index = i + 1
      try {
        const buf = await getObjectBuffer(entry.url)
        const name = formatZipName(entry.timestamp, index, entry.url)
        archive.append(buf, { name })
      } catch (err) {
        logWarn(`Skip history entry (${type}) idx=${index} key=${entry.url}: ${(err as Error)?.message || err}`)
      }
    }
    try {
      await archive.finalize()
    } catch (err) {
      logError('Archive finalize failed', err)
    }
  }

  const panelLabel = panel.panelNumber != null ? `p${panel.panelNumber}` : `idx${panel.panelIndex}`
  const filename = `${sanitizeFilename(project.name)}_${panelLabel}_${type}_history.zip`

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  })
})
