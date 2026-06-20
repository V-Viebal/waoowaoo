import { describe, it, expect } from 'vitest'
import { parseAndValidateRecommendation } from '@/lib/providers/omnivoice/instruct-recommend'
import type { CharacterProfileData } from '@/types/character-profile'

function profile(overrides: Partial<CharacterProfileData> = {}): CharacterProfileData {
  return {
    role_level: 'A',
    archetype: '霸道总裁',
    personality_tags: ['沉稳', '强势'],
    era_period: '现代',
    social_class: '上流',
    costume_tier: 3,
    suggested_colors: [],
    visual_keywords: [],
    gender: '男',
    age_range: '中年',
    ...overrides,
  }
}

describe('parseAndValidateRecommendation', () => {
  it('returns llm source when LLM output is fully valid', () => {
    const r = parseAndValidateRecommendation('男、中年、低音调', profile())
    expect(r).toEqual({ instruct: '男、中年、低音调', source: 'llm' })
  })

  it('keeps valid tokens, drops invalid ones (still llm source)', () => {
    // 「磁性」越表,validateOmnivoiceInstruct 会判 UNKNOWN_TOKEN → 整体不合法 → 走兜底
    // 因此该用例验证:有越表词时整体走 fallback(validateOmnivoiceInstruct 是全有或全无)
    const r = parseAndValidateRecommendation('男、磁性', profile())
    expect(r.source).toBe('fallback')
    expect(r.instruct).toBe('男、中年')
  })

  it('falls back to profileData gender+age when LLM output all invalid', () => {
    const r = parseAndValidateRecommendation('磁性、浑厚', profile({ gender: '男', age_range: '中年' }))
    expect(r).toEqual({ instruct: '男、中年', source: 'fallback' })
  })

  it('falls back when LLM output is empty', () => {
    const r = parseAndValidateRecommendation('', profile({ gender: '女', age_range: '青年' }))
    expect(r).toEqual({ instruct: '女、青年', source: 'fallback' })
  })

  it('falls back when LLM mixes languages', () => {
    const r = parseAndValidateRecommendation('男, male', profile({ gender: '男', age_range: '老年' }))
    expect(r).toEqual({ instruct: '男、老年', source: 'fallback' })
  })

  it('falls back to 男、青年 when profileData is null', () => {
    const r = parseAndValidateRecommendation('磁性', null)
    expect(r).toEqual({ instruct: '男、青年', source: 'fallback' })
  })

  it('maps English-ish gender/age in profileData', () => {
    const r = parseAndValidateRecommendation('xxx', profile({ gender: 'female', age_range: 'young adult' }))
    expect(r).toEqual({ instruct: '女、青年', source: 'fallback' })
  })

  it('maps child / teenager / elderly age ranges', () => {
    expect(parseAndValidateRecommendation('xx', profile({ gender: '男', age_range: '儿童' })).instruct).toBe('男、儿童')
    expect(parseAndValidateRecommendation('xx', profile({ gender: '男', age_range: '少年' })).instruct).toBe('男、少年')
    expect(parseAndValidateRecommendation('xx', profile({ gender: '男', age_range: '老年人' })).instruct).toBe('男、老年')
  })

  it('defaults gender to 男 and age to 青年 when profileData fields are unrecognized', () => {
    const r = parseAndValidateRecommendation('xx', profile({ gender: '不明', age_range: '不明' }))
    expect(r).toEqual({ instruct: '男、青年', source: 'fallback' })
  })
})
