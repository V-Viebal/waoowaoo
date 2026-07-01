import { prisma } from '@/lib/prisma'
import { getMediaObjectById } from '@/lib/media/service'
import { getSignedObjectUrl, toFetchableUrl } from '@/lib/storage'
import type { MediaObjRef } from './types'
import { isMediaObjRef, toMediaObjRef, extractMediaObjectId } from './media-ref'

// 纯字符串工具从 ./media-ref re-export，保持既有服务端调用方的 import 路径不变
export { isMediaObjRef, toMediaObjRef, extractMediaObjectId }

type ServerRenderMediaContext = {
  userId: string
  projectId: string
  editorProjectId: string
  episodeId?: string | null
}

export async function resolveMediaUrl(ref: string): Promise<string> {
  if (!isMediaObjRef(ref)) {
    return ref
  }

  const mediaObjectId = extractMediaObjectId(ref)
  if (!mediaObjectId) {
    throw new Error(`Invalid media object reference: ${ref}`)
  }

  const mediaObject = await getMediaObjectById(mediaObjectId)
  if (!mediaObject) {
    throw new Error(`Media object not found: ${mediaObjectId}`)
  }

  return mediaObject.url
}

async function canAccessMediaObjectForServerRender(
  mediaObjectId: string,
  storageKey: string | null,
  context: ServerRenderMediaContext,
): Promise<boolean> {
  // ponytail: base-panel videos live only in legacy *Url fields (MediaId FK never
  // backfilled after ensureMediaObjectFromStorageKey), so also match by storageKey.
  const legacyOr = storageKey
    ? [
        { voiceLines: { some: { audioUrl: storageKey } } },
        { shots: { some: { imageUrl: storageKey } } },
        { storyboards: { some: { panels: { some: { imageUrl: storageKey } } } } },
        { storyboards: { some: { panels: { some: { videoUrl: storageKey } } } } },
        { storyboards: { some: { panels: { some: { lipSyncVideoUrl: storageKey } } } } },
        { storyboards: { some: { panels: { some: { sketchImageUrl: storageKey } } } } },
        { storyboards: { some: { panels: { some: { previousImageUrl: storageKey } } } } },
      ]
    : []
  const [projectMedia, editorAsset, globalMedia] = await Promise.all([
    prisma.project.findFirst({
      where: {
        id: context.projectId,
        userId: context.userId,
        novelPromotionData: {
          episodes: {
            some: {
              ...(context.episodeId ? { id: context.episodeId } : {}),
              OR: [
                { audioMediaId: mediaObjectId },
                { voiceLines: { some: { audioMediaId: mediaObjectId } } },
                { shots: { some: { imageMediaId: mediaObjectId } } },
                { storyboards: { some: { panels: { some: { imageMediaId: mediaObjectId } } } } },
                { storyboards: { some: { panels: { some: { videoMediaId: mediaObjectId } } } } },
                { storyboards: { some: { panels: { some: { lipSyncVideoMediaId: mediaObjectId } } } } },
                { storyboards: { some: { panels: { some: { sketchImageMediaId: mediaObjectId } } } } },
                { storyboards: { some: { panels: { some: { previousImageMediaId: mediaObjectId } } } } },
                { storyboards: { some: { supplementaryPanels: { some: { imageMediaId: mediaObjectId } } } } },
                { storyboards: { some: { imageVersions: { some: { imageMediaId: mediaObjectId } } } } },
                ...legacyOr,
              ],
            },
          },
        },
      },
      select: { id: true },
    }),
    prisma.novelPromotionEditorAsset.findFirst({
      where: {
        editorProjectId: context.editorProjectId,
        mediaObjectId,
        editorProject: {
          episode: {
            ...(context.episodeId ? { id: context.episodeId } : {}),
            novelPromotionProject: {
              projectId: context.projectId,
              project: { userId: context.userId },
            },
          },
        },
      },
      select: { id: true },
    }),
    prisma.user.findFirst({
      where: {
        id: context.userId,
        OR: [
          { globalCharacters: { some: { customVoiceMediaId: mediaObjectId } } },
          { globalCharacters: { some: { appearances: { some: { imageMediaId: mediaObjectId } } } } },
          { globalCharacters: { some: { appearances: { some: { previousImageMediaId: mediaObjectId } } } } },
          { globalLocations: { some: { images: { some: { imageMediaId: mediaObjectId } } } } },
          { globalLocations: { some: { images: { some: { previousImageMediaId: mediaObjectId } } } } },
          { globalVoices: { some: { customVoiceMediaId: mediaObjectId } } },
        ],
      },
      select: { id: true },
    }),
  ])

  return !!projectMedia || !!editorAsset || !!globalMedia
}

export async function resolveMediaUrlForServerRender(
  ref: string,
  context?: ServerRenderMediaContext,
): Promise<string> {
  if (!isMediaObjRef(ref)) {
    throw new Error(`Invalid editor render media source: ${ref}`)
  }

  const mediaObjectId = extractMediaObjectId(ref)
  if (!mediaObjectId) {
    throw new Error(`Invalid media object reference: ${ref}`)
  }

  const mediaObject = await getMediaObjectById(mediaObjectId)
  if (!mediaObject) {
    throw new Error(`Media object not found: ${mediaObjectId}`)
  }

  if (!context) {
    throw new Error(`Media object render context is required: ${mediaObjectId}`)
  }

  const canAccess = await canAccessMediaObjectForServerRender(mediaObjectId, mediaObject.storageKey ?? null, context)
  if (!canAccess) {
    throw new Error(`Media object is not accessible for editor render: ${mediaObjectId}`)
  }

  if (!mediaObject.storageKey) {
    throw new Error(`Media object has no storage key: ${mediaObjectId}`)
  }

  return toFetchableUrl(await getSignedObjectUrl(mediaObject.storageKey, 24 * 60 * 60))
}

export async function resolveMediaUrls(refs: string[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>()

  await Promise.all(refs.map(async (ref) => {
    resolved.set(ref, await resolveMediaUrl(ref))
  }))

  return resolved
}

export async function resolveMediaUrlsForServerRender(
  refs: string[],
  context?: ServerRenderMediaContext,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>()

  await Promise.all(refs.map(async (ref) => {
    resolved.set(ref, await resolveMediaUrlForServerRender(ref, context))
  }))

  return resolved
}
