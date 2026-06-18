import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getArtStylePrompt } from '@/lib/constants'
import {
  listAvailableArtStyles,
  resolveArtStylePrompt,
} from '@/lib/config-center/art-styles/service'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    artStyle: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

describe('art styles runtime service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists enabled system styles and enabled styles owned by the current user', async () => {
    const styles = [
      { id: 'system-1', scope: 'system', ownerUserId: null, name: 'System', prompt: 'system prompt', enabled: true },
      { id: 'user-1-style', scope: 'user', ownerUserId: 'user-1', name: 'Mine', prompt: 'mine prompt', enabled: true },
    ]
    prismaMock.artStyle.findMany.mockResolvedValue(styles)

    const result = await listAvailableArtStyles('user-1')

    expect(result).toEqual(styles)
    expect(prismaMock.artStyle.findMany).toHaveBeenCalledWith({
      where: {
        enabled: true,
        OR: [
          { scope: 'system' },
          { scope: 'user', ownerUserId: 'user-1' },
        ],
      },
      orderBy: [
        { scope: 'asc' },
        { sortOrder: 'asc' },
        { createdAt: 'asc' },
      ],
    })
  })

  it('uses the selected accessible art style before legacy fallback values', async () => {
    prismaMock.artStyle.findFirst.mockResolvedValue({
      id: 'style-1',
      scope: 'user',
      ownerUserId: 'user-1',
      prompt: 'selected prompt',
    })

    const result = await resolveArtStylePrompt({
      artStyleId: 'style-1',
      legacyArtStyle: 'realistic',
      legacyArtStylePrompt: 'legacy prompt',
      userId: 'user-1',
      locale: 'zh',
    })

    expect(result).toEqual({
      artStyleId: 'style-1',
      prompt: 'selected prompt',
      fallbackReason: null,
    })
    expect(prismaMock.artStyle.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'style-1',
        enabled: true,
        OR: [
          { scope: 'system' },
          { scope: 'user', ownerUserId: 'user-1' },
        ],
      },
      select: { id: true, prompt: true },
    })
  })

  it('falls back to the persisted legacy prompt when the selected style is unavailable', async () => {
    prismaMock.artStyle.findFirst.mockResolvedValue(null)

    const result = await resolveArtStylePrompt({
      artStyleId: 'missing-style',
      legacyArtStyle: 'realistic',
      legacyArtStylePrompt: '  persisted legacy prompt  ',
      userId: 'user-1',
      locale: 'zh',
    })

    expect(result).toEqual({
      artStyleId: null,
      prompt: 'persisted legacy prompt',
      fallbackReason: 'ART_STYLE_UNAVAILABLE',
    })
  })

  it('falls back to the legacy built-in art style prompt after the persisted prompt', async () => {
    const result = await resolveArtStylePrompt({
      artStyleId: null,
      legacyArtStyle: 'realistic',
      legacyArtStylePrompt: '   ',
      userId: 'user-1',
      locale: 'en',
    })

    expect(result).toEqual({
      artStyleId: null,
      prompt: getArtStylePrompt('realistic', 'en'),
      fallbackReason: null,
    })
    expect(prismaMock.artStyle.findFirst).not.toHaveBeenCalled()
  })

  it('uses the default legacy built-in art style before querying system defaults', async () => {
    const result = await resolveArtStylePrompt({
      artStyleId: null,
      legacyArtStyle: null,
      legacyArtStylePrompt: null,
      userId: 'user-1',
      locale: 'zh',
    })

    expect(result).toEqual({
      artStyleId: null,
      prompt: getArtStylePrompt('american-comic', 'zh'),
      fallbackReason: null,
    })
    expect(prismaMock.artStyle.findFirst).not.toHaveBeenCalled()
  })

  it('falls back to the first enabled system art style when no legacy prompt is available', async () => {
    prismaMock.artStyle.findFirst.mockResolvedValue({
      id: 'system-default',
      prompt: 'default system prompt',
    })

    const result = await resolveArtStylePrompt({
      artStyleId: null,
      legacyArtStyle: 'not-supported',
      legacyArtStylePrompt: null,
      userId: 'user-1',
      locale: 'zh',
    })

    expect(result).toEqual({
      artStyleId: 'system-default',
      prompt: 'default system prompt',
      fallbackReason: 'DEFAULT_STYLE_USED',
    })
    expect(prismaMock.artStyle.findFirst).toHaveBeenCalledWith({
      where: {
        scope: 'system',
        enabled: true,
      },
      orderBy: [
        { sortOrder: 'asc' },
        { createdAt: 'asc' },
      ],
      select: { id: true, prompt: true },
    })
  })
})
