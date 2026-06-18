import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { seedSystemArtStyles } from '@/lib/config-center/art-styles/seed'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    artStyle: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

describe('art-styles seed function', () => {
  const mockSystemStyles = [
    {
      id: 'system-american-comic',
      name: '漫画风',
      description: '日式动漫风格',
      promptZh: '日式动漫风格',
      sortOrder: 10,
    },
    {
      id: 'system-chinese-comic',
      name: '精致国漫',
      description: '现代高质量漫画风格，动漫风格，细节丰富精致，线条锐利干净，质感饱满，超清，干净的画面风格，2D风格，动漫风格。',
      promptZh: '现代高质量漫画风格，动漫风格，细节丰富精致，线条锐利干净，质感饱满，超清，干净的画面风格，2D风格，动漫风格。',
      sortOrder: 20,
    },
    {
      id: 'system-japanese-anime',
      name: '日系动漫风',
      description: '现代日系动漫风格，赛璐璐上色，清晰干净的线条，视觉小说CG感。高质量2D风格',
      promptZh: '现代日系动漫风格，赛璐璐上色，清晰干净的线条，视觉小说CG感。高质量2D风格',
      sortOrder: 30,
    },
    {
      id: 'system-realistic',
      name: '真人风格',
      description: '真实电影级画面质感，真实现实场景，色彩饱满通透，画面干净精致，真实感',
      promptZh: '真实电影级画面质感，真实现实场景，色彩饱满通透，画面干净精致，真实感',
      sortOrder: 40,
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create all 4 system art styles when none exist', async () => {
    // Setup: no existing styles
    vi.mocked(prisma.artStyle.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.artStyle.create).mockResolvedValue({} as never)

    const result = await seedSystemArtStyles()

    expect(result.created).toBe(4)
    expect(result.existing).toBe(0)
    expect(result.total).toBe(4)
    expect(prisma.artStyle.create).toHaveBeenCalledTimes(4)
    expect(prisma.artStyle.update).not.toHaveBeenCalled()
  })

  it('should not create styles that already exist', async () => {
    // Setup: all styles already exist
    vi.mocked(prisma.artStyle.findUnique).mockResolvedValue({ id: 'existing-style' } as never)
    vi.mocked(prisma.artStyle.create).mockResolvedValue({} as never)

    const result = await seedSystemArtStyles()

    expect(result.created).toBe(0)
    expect(result.existing).toBe(4)
    expect(result.total).toBe(4)
    expect(prisma.artStyle.create).not.toHaveBeenCalled()
    expect(prisma.artStyle.update).not.toHaveBeenCalled()
  })

  it('should update existing styles when force option is true', async () => {
    // Setup: all styles already exist
    vi.mocked(prisma.artStyle.findUnique).mockResolvedValue({ id: 'existing-style' } as never)
    vi.mocked(prisma.artStyle.update).mockResolvedValue({} as never)

    const result = await seedSystemArtStyles({ force: true })

    expect(result.created).toBe(0)
    expect(result.existing).toBe(4)
    expect(result.total).toBe(4)
    expect(prisma.artStyle.update).toHaveBeenCalledTimes(4)
    expect(prisma.artStyle.create).not.toHaveBeenCalled()
  })

  it('should create only missing styles', async () => {
    // Setup: first style exists, others don't
    let callCount = 0
    vi.mocked(prisma.artStyle.findUnique).mockImplementation(() => {
      callCount++
      return Promise.resolve(callCount === 1 ? { id: 'system-american-comic' } : null) as never
    })
    vi.mocked(prisma.artStyle.create).mockResolvedValue({} as never)

    const result = await seedSystemArtStyles()

    expect(result.created).toBe(3)
    expect(result.existing).toBe(1)
    expect(result.total).toBe(4)
    expect(prisma.artStyle.create).toHaveBeenCalledTimes(3)
  })

  it('should create styles with correct data structure', async () => {
    vi.mocked(prisma.artStyle.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.artStyle.create).mockResolvedValue({} as never)

    await seedSystemArtStyles()

    // Verify first style creation
    expect(prisma.artStyle.create).toHaveBeenCalledWith({
      data: {
        id: 'system-american-comic',
        scope: 'system',
        ownerUserId: null,
        name: '漫画风',
        description: '日式动漫风格',
        prompt: '日式动漫风格',
        previewImageUrl: null,
        sortOrder: 10,
        enabled: true,
      },
    })

    // Verify realistic style
    expect(prisma.artStyle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'system-realistic',
          name: '真人风格',
          scope: 'system',
          sortOrder: 40,
        }),
      }),
    )
  })

  it('should handle database errors gracefully', async () => {
    const dbError = new Error('Database connection failed')
    vi.mocked(prisma.artStyle.findUnique).mockRejectedValue(dbError)

    await expect(seedSystemArtStyles()).rejects.toThrow('Database connection failed')
  })

  it('should have consistent sort order values', async () => {
    vi.mocked(prisma.artStyle.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.artStyle.create).mockResolvedValue({} as never)

    await seedSystemArtStyles()

    const sortOrders = vi.mocked(prisma.artStyle.create).mock.calls.map(
      (call) => call[0].data.sortOrder,
    )

    // Sort orders should be in increasing order
    for (let i = 1; i < sortOrders.length; i++) {
      expect(sortOrders[i] as number).toBeGreaterThan(sortOrders[i - 1] as number)
    }

    // Verify specific expected values
    expect(sortOrders).toContain(10) // Comic
    expect(sortOrders).toContain(20) // Chinese comic
    expect(sortOrders).toContain(30) // Japanese anime
    expect(sortOrders).toContain(40) // Realistic
  })

  it('should mark all system styles as enabled', async () => {
    vi.mocked(prisma.artStyle.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.artStyle.create).mockResolvedValue({} as never)

    await seedSystemArtStyles()

    for (const call of vi.mocked(prisma.artStyle.create).mock.calls) {
      expect(call[0].data.enabled).toBe(true)
    }
  })

  it('should set ownerUserId to null for system styles', async () => {
    vi.mocked(prisma.artStyle.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.artStyle.create).mockResolvedValue({} as never)

    await seedSystemArtStyles()

    for (const call of vi.mocked(prisma.artStyle.create).mock.calls) {
      expect(call[0].data.ownerUserId).toBeNull()
    }
  })
})
