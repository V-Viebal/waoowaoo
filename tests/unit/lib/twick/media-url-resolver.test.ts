import { describe, expect, it, vi } from 'vitest'
import {
  extractMediaObjectId,
  isMediaObjRef,
  resolveMediaUrl,
  resolveMediaUrlForServerRender,
  resolveMediaUrls,
  resolveMediaUrlsForServerRender,
  toMediaObjRef,
} from '@/lib/twick/media-url-resolver'

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

describe('media-url-resolver', () => {
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
    it('returns absolute fetchable URLs for external and root-relative refs', async () => {
      await expect(resolveMediaUrlForServerRender('/api/files/video.mp4')).resolves.toBe('http://localhost:3000/api/files/video.mp4')
      await expect(resolveMediaUrlForServerRender('https://example.com/video.mp4')).resolves.toBe('https://example.com/video.mp4')
    })

    it('resolves mediaobj references to signed fetchable storage URLs', async () => {
      await expect(resolveMediaUrlForServerRender('mediaobj://mo-video-1'))
        .resolves.toBe('http://localhost:3000/api/storage/sign?key=videos%2Fmo-video-1.mp4')
    })
  })

  describe('resolveMediaUrlsForServerRender', () => {
    it('resolves a batch for server rendering', async () => {
      const result = await resolveMediaUrlsForServerRender([
        'mediaobj://mo-video-1',
        '/api/files/audio.mp3',
      ])

      expect(result.get('mediaobj://mo-video-1')).toBe('http://localhost:3000/api/storage/sign?key=videos%2Fmo-video-1.mp4')
      expect(result.get('/api/files/audio.mp3')).toBe('http://localhost:3000/api/files/audio.mp3')
    })
  })
})
