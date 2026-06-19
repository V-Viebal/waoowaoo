import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { getObjectBuffer, getSignedUrl } from '@/lib/storage'
import { createOmnivoiceClone } from '@/lib/providers/omnivoice'

/**
 * Best-effort extraction of the userId encoded in a storage key.
 * Voice-related uploads use the convention `voices/<userId>/...` (see
 * src/app/api/asset-hub/voices/upload/route.ts). Returns null if the key
 * does not match a known convention.
 */
function extractUserIdFromKey(key: string): string | null {
  const segments = key.split('/').filter(Boolean)
  if (segments.length >= 2 && (segments[0] === 'voices' || segments[0] === 'voice-ref')) {
    return segments[1] ?? null
  }
  return null
}

/**
 * 资源库 OmniVoice 声音克隆入口
 * POST /api/asset-hub/voice-clone
 * body: { name, refAudioMediaId, language? }
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const refAudioMediaId = typeof body.refAudioMediaId === 'string' ? body.refAudioMediaId.trim() : ''
  const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim() : 'Auto'

  if (!name) throw new ApiError('INVALID_PARAMS')
  if (!refAudioMediaId) throw new ApiError('INVALID_PARAMS')

  // NOTE: MediaObject schema has no `userId` column today. The brief assumes one;
  // pending a schema migration we accept it via runtime cast and additionally
  // verify via the storageKey path convention `voices/<userId>/...` if the
  // userId field is missing.
  const media = (await prisma.mediaObject.findUnique({ where: { id: refAudioMediaId } })) as
    | ((NonNullable<Awaited<ReturnType<typeof prisma.mediaObject.findUnique>>>) & { userId?: string })
    | null
  if (!media) throw new ApiError('NOT_FOUND')

  const ownerId = media.userId ?? extractUserIdFromKey(media.storageKey)
  if (!ownerId || ownerId !== session.user.id) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  const refAudio = await getObjectBuffer(media.storageKey)
  const filename = media.storageKey.split('/').pop() ?? 'ref.wav'

  const cloneResult = await createOmnivoiceClone({
    name,
    refAudio,
    refAudioFilename: filename,
    language,
    userId: session.user.id,
  })

  if (!cloneResult.success || !cloneResult.profileId) {
    const status = cloneResult.errorCode === 'OMNIVOICE_BACKEND_UNREACHABLE' ? 502 : 400
    return NextResponse.json({
      success: false,
      error: cloneResult.error,
      errorCode: cloneResult.errorCode,
    }, { status })
  }

  const previewUrl = getSignedUrl(media.storageKey, 7200)

  const created = await prisma.globalVoice.create({
    data: {
      userId: session.user.id,
      name,
      voiceId: cloneResult.profileId,
      voiceType: 'omnivoice-clone',
      customVoiceMediaId: media.id,
      customVoiceUrl: previewUrl,
      language: language.toLowerCase().includes('en') ? 'en' : 'zh',
    },
  })

  return NextResponse.json({
    success: true,
    globalVoiceId: created.id,
    profileId: cloneResult.profileId,
    previewUrl,
  })
})
