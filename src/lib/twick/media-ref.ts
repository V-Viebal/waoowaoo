import type { MediaObjRef } from './types'

/**
 * 纯字符串 media 引用工具（不依赖 prisma/storage/sharp 等服务端模块）。
 * 客户端组件可安全 import，不会把服务端依赖打进 bundle。
 */

export const MEDIA_OBJ_PREFIX = 'mediaobj://'

export function isMediaObjRef(src: string): src is MediaObjRef {
  return src.startsWith(MEDIA_OBJ_PREFIX) && src.slice(MEDIA_OBJ_PREFIX.length).trim().length > 0
}

export function toMediaObjRef(mediaObjectId: string): MediaObjRef {
  const normalizedId = mediaObjectId.trim()
  if (!normalizedId) {
    throw new Error('Media object id is required')
  }
  return `${MEDIA_OBJ_PREFIX}${normalizedId}` as MediaObjRef
}

export function extractMediaObjectId(ref: MediaObjRef | string): string | null {
  if (!isMediaObjRef(ref)) return null
  return ref.slice(MEDIA_OBJ_PREFIX.length) || null
}
