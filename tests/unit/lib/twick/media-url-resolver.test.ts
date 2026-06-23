import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  extractMediaObjectId,
  isMediaObjRef,
  resolveMediaUrl,
  resolveMediaUrlForServerRender,
  resolveMediaUrls,
  resolveMediaUrlsForServerRender,
  toMediaObjRef,
} from '@/lib/twick/media-url-resolver'

const prismaMock = vi.hoisted(() => ({
  project: { findFirst: vi.fn<() => Promise<{ id: string } | null>>(async () => null) },
  novelPromotionEditorAsset: { findFirst: vi.fn<() => Promise<{ id: string } | null>>(async () => null) },
  user: { findFirst: vi.fn<() => Promise<{ id: string } | null>>(async () => null) },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

vi.mock('@/lib/media/service', () => ({
  getMediaObjectById: vi.fn(async (id: string) => {
    if (id === 'missing') return null
    return {
      id,
      publicId: `public-${id}`,
      url: `/m/public-${id}`,
      storageKey: `videos/${id}.mp4`,
      sha256: null,
      mimeType: 'video/mp4',
      sizeBytes: null,
      width: null,
      height: null,
      durationMs: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
  }),
}))

vi.mock('@/lib/storage', () => ({
  getSignedObjectUrl: vi.fn(async (key: string) => `/api/storage/sign?key=${encodeURIComponent(key)}`),
  toFetchableUrl: vi.fn((url: string) => url.startsWith('/') ? `http://localhost:3000${url}` : url),
}))

const serverRenderContext = {
  userId: 'user-1',
  projectId: 'project-1',
  editorProjectId: 'editor-project-1',
  episodeId: 'episode-1',
}

describe('media-url-resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.project.findFirst.mockResolvedValue({ id: 'project-1' })
    prismaMock.novelPromotionEditorAsset.findFirst.mockResolvedValue(null)
    prismaMock.user.findFirst.mockResolvedValue(null)
  })

  describe('isMediaObjRef', () => {
    it('returns true for mediaobj references with a non-empty id', () => {
      expect(isMediaObjRef('mediaobj://abc123')).toBe(true)
    })

    it('returns false for external URLs and empty mediaobj references', () => {
      expect(isMediaObjRef('https://example.com/video.mp4')).toBe(false)
      expect(isMediaObjRef('')).toBe(false)
      expect(isMediaObjRef('mediaobj://')).toBe(false)
    })
  })

  describe('toMediaObjRef', () => {
    it('creates mediaobj references from ids', () => {
      expect(toMediaObjRef('abc123')).toBe('mediaobj://abc123')
    })

    it('rejects blank media object ids', () => {
      expect(() => toMediaObjRef('  ')).toThrow('Media object id is required')
    })
  })

  describe('extractMediaObjectId', () => {
    it('extracts the id from a mediaobj reference', () => {
      expect(extractMediaObjectId('mediaobj://abc123')).toBe('abc123')
    })

    it('returns null for non-mediaobj strings or empty ids', () => {
      expect(extractMediaObjectId('https://example.com')).toBeNull()
      expect(extractMediaObjectId('mediaobj://')).toBeNull()
    })
  })

  describe('resolveMediaUrl', () => {
    it('returns external URLs unchanged', async () => {
      await expect(resolveMediaUrl('https://example.com/video.mp4')).resolves.toBe('https://example.com/video.mp4')
    })

    it('resolves mediaobj references through the existing /m/<publicId> media route', async () => {
      await expect(resolveMediaUrl('mediaobj://mo-video-1')).resolves.toBe('/m/public-mo-video-1')
    })

    it('throws when a media object does not exist', async () => {
      await expect(resolveMediaUrl('mediaobj://missing')).rejects.toThrow('Media object not found: missing')
    })
  })

  describe('resolveMediaUrls', () => {
    it('resolves a batch while preserving external URLs', async () => {
      const result = await resolveMediaUrls([
        'mediaobj://mo-video-1',
        'https://example.com/audio.mp3',
        'mediaobj://mo-audio-1',
      ])

      expect(result.get('mediaobj://mo-video-1')).toBe('/m/public-mo-video-1')
      expect(result.get('https://example.com/audio.mp3')).toBe('https://example.com/audio.mp3')
      expect(result.get('mediaobj://mo-audio-1')).toBe('/m/public-mo-audio-1')
    })
  })

  describe('resolveMediaUrlForServerRender', () => {
    it('returns non-mediaobj refs unchanged for server rendering', async () => {
      await expect(resolveMediaUrlForServerRender('/api/files/video.mp4')).resolves.toBe('/api/files/video.mp4')
      await expect(resolveMediaUrlForServerRender('https://example.com/video.mp4')).resolves.toBe('https://example.com/video.mp4')
    })

    it('resolves accessible mediaobj references to signed fetchable storage URLs', async () => {
      await expect(resolveMediaUrlForServerRender('mediaobj://mo-video-1', serverRenderContext))
        .resolves.toBe('http://localhost:3000/api/storage/sign?key=videos%2Fmo-video-1.mp4')
      expect(prismaMock.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'project-1', userId: 'user-1' }),
      }))
    })

    it('rejects mediaobj references without server render ownership context', async () => {
      await expect(resolveMediaUrlForServerRender('mediaobj://mo-video-1'))
        .rejects.toThrow('Media object render context is required: mo-video-1')
    })

    it('rejects mediaobj references that are not reachable from project, editor assets, or user global assets', async () => {
      prismaMock.project.findFirst.mockResolvedValueOnce(null)
      prismaMock.novelPromotionEditorAsset.findFirst.mockResolvedValueOnce(null)
      prismaMock.user.findFirst.mockResolvedValueOnce(null)

      await expect(resolveMediaUrlForServerRender('mediaobj://mo-video-foreign', serverRenderContext))
        .rejects.toThrow('Media object is not accessible for editor render: mo-video-foreign')
    })
  })

  describe('resolveMediaUrlsForServerRender', () => {
    it('resolves a batch for server rendering', async () => {
      const result = await resolveMediaUrlsForServerRender([
        'mediaobj://mo-video-1',
        '/api/files/audio.mp3',
      ], serverRenderContext)

      expect(result.get('mediaobj://mo-video-1')).toBe('http://localhost:3000/api/storage/sign?key=videos%2Fmo-video-1.mp4')
      expect(result.get('/api/files/audio.mp3')).toBe('/api/files/audio.mp3')
    })
  })
})
