import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { uploadObject, generateUniqueKey, getSignedUrl } from '@/lib/storage'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { createOmnivoiceClone } from '@/lib/providers/omnivoice'

/**
 * POST /api/asset-hub/voice-clone-upload
 *
 * 一步式 OmniVoice 声音克隆：上传参考音频 → 注册 MediaObject →
 * 调用 OmniVoice clone 生成 profile → 落库为 omnivoice-clone 音色。
 *
 * 合并了「上传 + 克隆」两步，避免现有 upload-temp（temp- key、无 MediaObject）
 * 与 voice-clone（需 refAudioMediaId）之间的衔接缺口。
 *
 * FormData: { file, name, folderId?, language? }
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const name = (formData.get('name') as string | null)?.trim() ?? ''
  const folderIdRaw = formData.get('folderId') as string | null
  const folderId = folderIdRaw && folderIdRaw.trim() ? folderIdRaw.trim() : null
  const languageRaw = (formData.get('language') as string | null)?.trim()
  const language = languageRaw || 'Auto'

  if (!file) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (!name) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 校验音频类型
  const audioTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/x-m4a', 'audio/aac']
  const isAudioFile = audioTypes.includes(file.type) || !!file.name.match(/\.(mp3|wav|ogg|m4a|aac)$/i)
  if (!isAudioFile) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 校验 folderId 归属
  if (folderId) {
    const folder = await prisma.globalAssetFolder.findUnique({ where: { id: folderId } })
    if (!folder || folder.userId !== session.user.id) {
      throw new ApiError('INVALID_PARAMS')
    }
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const ext = file.name.split('.').pop()?.toLowerCase() || 'wav'

  // 关键：使用 voices/<userId>/... 约定，使所有权可由 key 前缀校验
  const storageKey = generateUniqueKey(`voices/${session.user.id}/${Date.now()}`, ext)
  await uploadObject(buffer, storageKey)

  const media = await ensureMediaObjectFromStorageKey(storageKey, {
    mimeType: file.type || undefined,
    sizeBytes: buffer.length,
  })

  const cloneResult = await createOmnivoiceClone({
    name,
    refAudio: buffer,
    refAudioFilename: `${name}.${ext}`,
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

  const previewUrl = getSignedUrl(storageKey, 7200)

  const created = await prisma.globalVoice.create({
    data: {
      userId: session.user.id,
      folderId,
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
