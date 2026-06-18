import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCompositedStoryboardImage } from '@/lib/storyboard-images/service'

const {
  prismaMock,
  transactionState,
  generateUniqueKeyMock,
  getSignedUrlMock,
  toFetchableUrlMock,
  uploadObjectMock,
  resolveStorageKeyFromMediaValueMock,
  ensureMediaObjectFromStorageKeyMock,
} = vi.hoisted(() => {
  const transactionState = {
    storyboardUpdate: vi.fn(),
    versionCreate: vi.fn(),
  }
  return {
    transactionState,
    prismaMock: {
      novelPromotionStoryboard: {
        findFirst: vi.fn(),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          novelPromotionStoryboard: {
            update: transactionState.storyboardUpdate,
          },
          storyboardImageVersion: {
            create: transactionState.versionCreate,
          },
        }
        return await fn(tx)
      }),
    },
    generateUniqueKeyMock: vi.fn(),
    getSignedUrlMock: vi.fn(),
    toFetchableUrlMock: vi.fn(),
    uploadObjectMock: vi.fn(),
    resolveStorageKeyFromMediaValueMock: vi.fn(),
    ensureMediaObjectFromStorageKeyMock: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/storage', () => ({
  generateUniqueKey: generateUniqueKeyMock,
  getSignedUrl: getSignedUrlMock,
  toFetchableUrl: toFetchableUrlMock,
  uploadObject: uploadObjectMock,
}))

vi.mock('@/lib/media/service', () => ({
  resolveStorageKeyFromMediaValue: resolveStorageKeyFromMediaValueMock,
  ensureMediaObjectFromStorageKey: ensureMediaObjectFromStorageKeyMock,
}))

async function createPng(color: string) {
  return await sharp({
    create: {
      width: 12,
      height: 8,
      channels: 4,
      background: color,
    },
  }).png().toBuffer()
}

describe('createCompositedStoryboardImage', () => {
  let imageByUrl: Map<string, Buffer>

  beforeEach(async () => {
    vi.clearAllMocks()
    imageByUrl = new Map([
      ['https://signed.example/images/panel-1.png', await createPng('#ff0000')],
      ['https://signed.example/images/panel-2.png', await createPng('#00ff00')],
    ])
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const buffer = imageByUrl.get(url)
      if (!buffer) return new Response('missing', { status: 404 })
      return new Response(new Uint8Array(buffer), { status: 200, headers: { 'content-type': 'image/png' } })
    }))

    prismaMock.novelPromotionStoryboard.findFirst.mockResolvedValue({
      id: 'storyboard-1',
      storyboardTextJson: '[{"panel":1}]',
      panels: [
        { id: 'panel-1', panelIndex: 0, panelNumber: 1, imageUrl: 'images/panel-1.png', imageMediaId: 'media-panel-1' },
        { id: 'panel-2', panelIndex: 1, panelNumber: 2, imageUrl: 'images/panel-2.png', imageMediaId: 'media-panel-2' },
      ],
    })
    resolveStorageKeyFromMediaValueMock.mockImplementation(async (value: string) => value)
    getSignedUrlMock.mockImplementation((key: string) => `https://signed.example/${key}`)
    toFetchableUrlMock.mockImplementation((url: string) => url)
    generateUniqueKeyMock.mockReturnValue('images/storyboard-output.png')
    uploadObjectMock.mockResolvedValue('images/storyboard-output.png')
    ensureMediaObjectFromStorageKeyMock.mockResolvedValue({
      id: 'media-storyboard-1',
      publicId: 'storyboard-output-public',
      url: '/m/storyboard-output-public',
      storageKey: 'images/storyboard-output.png',
      mimeType: 'image/png',
      sizeBytes: 123,
      width: 12,
      height: 8,
      durationMs: null,
      sha256: null,
      updatedAt: new Date().toISOString(),
    })
    transactionState.storyboardUpdate.mockResolvedValue({})
    transactionState.versionCreate.mockResolvedValue({ id: 'version-1' })
  })

  it('uploads the composed grid, updates the storyboard, and writes an image version', async () => {
    const result = await createCompositedStoryboardImage({
      projectId: 'project-1',
      storyboardId: 'storyboard-1',
      userId: 'user-1',
      gridPreset: 'grid_3',
    })

    expect(result).toMatchObject({
      storyboardId: 'storyboard-1',
      imageUrl: '/m/storyboard-output-public',
      imageMediaId: 'media-storyboard-1',
      versionId: 'version-1',
      mode: 'composited_storyboard',
      gridPreset: 'grid_3',
    })
    expect(uploadObjectMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      'images/storyboard-output.png',
      1,
      'image/png',
    )
    expect(transactionState.storyboardUpdate).toHaveBeenCalledWith({
      where: { id: 'storyboard-1' },
      data: { storyboardImageUrl: 'images/storyboard-output.png' },
    })
    expect(transactionState.versionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storyboardId: 'storyboard-1',
        mode: 'composited_storyboard',
        imageUrl: '/m/storyboard-output-public',
        imageMediaId: 'media-storyboard-1',
        gridPreset: 'grid_3',
        createdByUserId: 'user-1',
      }),
    })
  })
})
