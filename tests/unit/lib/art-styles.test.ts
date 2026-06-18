import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  normalizeArtStyleId,
  getArtStyleLabelSync,
  getArtStylePromptSync,
  isSystemArtStyle,
  getAvailableArtStyles,
  getArtStyleById,
  getArtStyleLabel,
  getArtStylePrompt,
} from '@/lib/art-styles'

const mockArtStyles: Array<{ id: string; name: string; description: string; prompt: string; sortOrder: number; scope: string; enabled: boolean }> = []

vi.mock('@/lib/prisma', () => ({
  prisma: {
    artStyle: {
      findMany: vi.fn().mockImplementation(() => Promise.resolve([...mockArtStyles])),
      findFirst: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        const found = mockArtStyles.find((s) => s.id === where.id && s.enabled)
        return Promise.resolve(found || null)
      }),
    },
  },
}))

describe('art-styles utility functions', () => {
  describe('normalizeArtStyleId', () => {
    it('should return null for null or undefined input', () => {
      expect(normalizeArtStyleId(null)).toBeNull()
      expect(normalizeArtStyleId(undefined)).toBeNull()
    })

    it('should remove system- prefix from system style IDs', () => {
      expect(normalizeArtStyleId('system-realistic')).toBe('realistic')
      expect(normalizeArtStyleId('system-american-comic')).toBe('american-comic')
      expect(normalizeArtStyleId('system-chinese-comic')).toBe('chinese-comic')
      expect(normalizeArtStyleId('system-japanese-anime')).toBe('japanese-anime')
    })

    it('should return original ID for non-system styles', () => {
      expect(normalizeArtStyleId('user-custom-style')).toBe('user-custom-style')
      expect(normalizeArtStyleId('realistic')).toBe('realistic')
      expect(normalizeArtStyleId('my-custom-style')).toBe('my-custom-style')
    })

    it('should handle empty string gracefully', () => {
      expect(normalizeArtStyleId('')).toBe('')
    })
  })

  describe('getArtStyleLabelSync', () => {
    it('should return fallback for null or undefined input', () => {
      expect(getArtStyleLabelSync(null)).toBe('')
      expect(getArtStyleLabelSync(undefined)).toBe('')
      expect(getArtStyleLabelSync(null, '自定义')).toBe('自定义')
    })

    it('should find label for system styles by database ID', () => {
      expect(getArtStyleLabelSync('system-realistic')).toBe('真人风格')
      expect(getArtStyleLabelSync('system-american-comic')).toBe('漫画风')
      expect(getArtStyleLabelSync('system-chinese-comic')).toBe('精致国漫')
      expect(getArtStyleLabelSync('system-japanese-anime')).toBe('日系动漫风')
    })

    it('should find label for legacy value format', () => {
      expect(getArtStyleLabelSync('realistic')).toBe('真人风格')
      expect(getArtStyleLabelSync('american-comic')).toBe('漫画风')
    })

    it('should return original ID for unknown styles', () => {
      expect(getArtStyleLabelSync('unknown-style')).toBe('unknown-style')
    })

    it('should return custom fallback for unknown styles when provided', () => {
      expect(getArtStyleLabelSync('unknown-style', '自定义风格')).toBe('自定义风格')
    })
  })

  describe('getArtStylePromptSync', () => {
    it('should return empty string for null or undefined input', () => {
      expect(getArtStylePromptSync(null)).toBe('')
      expect(getArtStylePromptSync(undefined)).toBe('')
    })

    it('should return Chinese prompt for system styles', () => {
      const prompt = getArtStylePromptSync('system-realistic', 'zh')
      expect(prompt).toContain('真实电影级画面质感')
    })

    it('should return English prompt for system styles', () => {
      const prompt = getArtStylePromptSync('system-realistic', 'en')
      expect(prompt).toContain('Realistic cinematic look')
    })

    it('should return prompt for legacy value format', () => {
      const prompt = getArtStylePromptSync('realistic', 'zh')
      expect(prompt).toContain('真实电影级画面质感')
    })

    it('should return empty string for unknown styles', () => {
      expect(getArtStylePromptSync('unknown-style')).toBe('')
    })
  })

  describe('isSystemArtStyle', () => {
    it('should return false for null or undefined', () => {
      expect(isSystemArtStyle(null)).toBe(false)
      expect(isSystemArtStyle(undefined)).toBe(false)
    })

    it('should return true for system-prefixed IDs', () => {
      expect(isSystemArtStyle('system-realistic')).toBe(true)
      expect(isSystemArtStyle('system-custom')).toBe(true)
    })

    it('should return true for known legacy style values', () => {
      expect(isSystemArtStyle('realistic')).toBe(true)
      expect(isSystemArtStyle('american-comic')).toBe(true)
      expect(isSystemArtStyle('chinese-comic')).toBe(true)
      expect(isSystemArtStyle('japanese-anime')).toBe(true)
    })

    it('should return false for user custom styles', () => {
      expect(isSystemArtStyle('user-custom-style')).toBe(false)
      expect(isSystemArtStyle('my-style')).toBe(false)
    })
  })
})

describe('art-styles async database functions', () => {
  beforeEach(() => {
    mockArtStyles.length = 0
    vi.clearAllMocks()
  })

  describe('getAvailableArtStyles', () => {
    it('should return system and user-owned styles', async () => {
      mockArtStyles.push(
        { id: 'system-realistic', name: '真人风格', description: '', prompt: 'prompt', sortOrder: 10, scope: 'system', enabled: true },
        { id: 'user-style', name: '用户风格', description: '', prompt: 'user prompt', sortOrder: 20, scope: 'user', enabled: true },
      )

      const result = await getAvailableArtStyles('user-1')

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('system-realistic')
      expect(result[1].id).toBe('user-style')
    })

    it('should return styles with correct format', async () => {
      mockArtStyles.push(
        { id: 'system-realistic', name: '真人风格', description: '描述', prompt: '提示词', sortOrder: 10, scope: 'system', enabled: true },
      )

      const result = await getAvailableArtStyles('user-1')

      expect(result[0]).toEqual({
        id: 'system-realistic',
        name: '真人风格',
        value: 'system-realistic',
        label: '真人风格',
        description: '描述',
        prompt: '提示词',
        sortOrder: 10,
        scope: 'system',
      })
    })
  })

  describe('getArtStyleById', () => {
    it('should return style data when found', async () => {
      mockArtStyles.push(
        { id: 'system-realistic', name: '真人风格', description: '描述', prompt: '提示词', sortOrder: 10, scope: 'system', enabled: true },
      )

      const result = await getArtStyleById('system-realistic', 'user-1')

      expect(result).not.toBeNull()
      expect(result?.id).toBe('system-realistic')
      expect(result?.name).toBe('真人风格')
      expect(result?.prompt).toBe('提示词')
    })

    it('should return null for non-existent style', async () => {
      const result = await getArtStyleById('non-existent', 'user-1')
      expect(result).toBeNull()
    })

    it('should return null for null or undefined input', async () => {
      expect(await getArtStyleById(null, 'user-1')).toBeNull()
      expect(await getArtStyleById(undefined, 'user-1')).toBeNull()
    })
  })

  describe('getArtStyleLabel', () => {
    it('should return label from database when style exists', async () => {
      mockArtStyles.push(
        { id: 'system-realistic', name: '真人风格', description: '', prompt: 'prompt', sortOrder: 10, scope: 'system', enabled: true },
      )

      const label = await getArtStyleLabel('system-realistic', 'user-1')
      expect(label).toBe('真人风格')
    })

    it('should fall back to sync function when style not in database', async () => {
      const label = await getArtStyleLabel('system-realistic', 'user-1')
      expect(label).toBe('真人风格') // From static fallback
    })

    it('should return fallback for unknown styles', async () => {
      const label = await getArtStyleLabel('unknown-style', 'user-1', '自定义')
      expect(label).toBe('自定义')
    })

    it('should return fallback for null input', async () => {
      const label = await getArtStyleLabel(null, 'user-1', '默认风格')
      expect(label).toBe('默认风格')
    })
  })

  describe('getArtStylePrompt', () => {
    it('should return prompt from database when style exists', async () => {
      mockArtStyles.push(
        { id: 'system-realistic', name: '真人风格', description: '', prompt: '数据库提示词', sortOrder: 10, scope: 'system', enabled: true },
      )

      const prompt = await getArtStylePrompt('system-realistic', 'user-1')
      expect(prompt).toBe('数据库提示词')
    })

    it('should fall back to sync function when style not in database', async () => {
      const prompt = await getArtStylePrompt('system-realistic', 'user-1', 'zh')
      expect(prompt).toContain('真实电影级画面质感') // From static fallback
    })

    it('should return empty string for null input', async () => {
      const prompt = await getArtStylePrompt(null, 'user-1')
      expect(prompt).toBe('')
    })
  })
})
