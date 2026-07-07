import { NextRequest, NextResponse } from 'next/server'
import { getStorageProvider } from '@/lib/storage'
import { getMediaObjectByPublicId } from '@/lib/media/service'

export const runtime = 'nodejs'

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await context.params
  const media = await getMediaObjectByPublicId(publicId)
  if (!media) return NextResponse.json({ error: 'Media not found' }, { status: 404 })
  if (!media.storageKey) return NextResponse.json({ error: 'Media storage key missing' }, { status: 500 })

  const etag = media.sha256 ? `"${media.sha256}"` : undefined
  if (etag && request.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag, 'Cache-Control': IMMUTABLE_CACHE } })
  }

  const contentType = media.mimeType || 'application/octet-stream'
  const baseHeaders: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': IMMUTABLE_CACHE,
    ...(etag ? { ETag: etag } : {}),
  }
  const rangeHeader = request.headers.get('range')
  const provider = getStorageProvider()

  if (typeof provider.getObjectStream === 'function') {
    const result = await provider.getObjectStream(media.storageKey, { rangeHeader })
    const headers = new Headers(baseHeaders)
    if (result.contentLength != null) headers.set('Content-Length', String(result.contentLength))
    if (result.contentRange) headers.set('Content-Range', result.contentRange)
    if (result.acceptsRanges) headers.set('Accept-Ranges', result.acceptsRanges)
    return new Response(result.body as unknown as ReadableStream, {
      status: result.statusCode ?? (rangeHeader ? 206 : 200),
      headers,
    })
  }

  // Fallback: providers without streaming support (local/minio in dev) serve full buffer.
  const buffer = await provider.getObjectBuffer(media.storageKey)
  const headers = new Headers(baseHeaders)
  headers.set('Content-Length', String(buffer.length))
  if (contentType.startsWith('video/')) headers.set('Accept-Ranges', 'bytes')
  return new Response(new Uint8Array(buffer), { status: 200, headers })
}
