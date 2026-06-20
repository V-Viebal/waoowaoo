import { describe, it, expect } from 'vitest'
import {
  validateOmnivoiceInstruct,
  translateInstructToEnglish,
  OMNIVOICE_ZH_VOCABULARY,
  OMNIVOICE_EN_VOCABULARY,
} from '@/lib/providers/omnivoice/instruct-vocabulary'

describe('validateOmnivoiceInstruct', () => {
  it('rejects empty / whitespace-only input', () => {
    expect(validateOmnivoiceInstruct('')).toMatchObject({ ok: false, errorCode: 'OMNIVOICE_INSTRUCT_EMPTY' })
    expect(validateOmnivoiceInstruct('   ')).toMatchObject({ ok: false, errorCode: 'OMNIVOICE_INSTRUCT_EMPTY' })
    expect(validateOmnivoiceInstruct(null)).toMatchObject({ ok: false, errorCode: 'OMNIVOICE_INSTRUCT_EMPTY' })
  })

  it('accepts a single Chinese token', () => {
    const r = validateOmnivoiceInstruct('男')
    expect(r).toEqual({ ok: true, normalized: '男', language: 'zh' })
  })

  it('accepts multi-token Chinese with 、 separator', () => {
    const r = validateOmnivoiceInstruct('男、青年、中音调')
    expect(r).toEqual({ ok: true, normalized: '男、青年、中音调', language: 'zh' })
  })

  it('accepts Chinese with full-width comma as separator', () => {
    const r = validateOmnivoiceInstruct('男,青年,中音调')
    expect(r).toEqual({ ok: true, normalized: '男、青年、中音调', language: 'zh' })
  })

  it('accepts English instruct', () => {
    const r = validateOmnivoiceInstruct('male, young adult, low pitch')
    expect(r).toEqual({ ok: true, normalized: 'male, young adult, low pitch', language: 'en' })
  })

  it('lowercases English tokens', () => {
    const r = validateOmnivoiceInstruct('Male, Young Adult')
    expect(r).toMatchObject({ ok: true, normalized: 'male, young adult', language: 'en' })
  })

  it('dedupes repeated tokens preserving first-seen order', () => {
    const r = validateOmnivoiceInstruct('男、青年、男、中音调、青年')
    expect(r).toEqual({ ok: true, normalized: '男、青年、中音调', language: 'zh' })
  })

  it('rejects mixed Chinese + English', () => {
    const r = validateOmnivoiceInstruct('男, male')
    expect(r).toMatchObject({ ok: false, errorCode: 'OMNIVOICE_INSTRUCT_MIXED_LANGUAGE' })
  })

  it('rejects unknown Chinese tokens with the trigger words', () => {
    const r = validateOmnivoiceInstruct('青年男主音')
    expect(r).toMatchObject({
      ok: false,
      errorCode: 'OMNIVOICE_INSTRUCT_UNKNOWN_TOKEN',
      unknownTokens: ['青年男主音'],
    })
  })

  it('rejects unknown English tokens', () => {
    const r = validateOmnivoiceInstruct('male, broadcaster')
    expect(r).toMatchObject({
      ok: false,
      errorCode: 'OMNIVOICE_INSTRUCT_UNKNOWN_TOKEN',
      unknownTokens: ['broadcaster'],
    })
  })

  it('every Chinese vocab entry validates as a singleton', () => {
    for (const token of OMNIVOICE_ZH_VOCABULARY) {
      const r = validateOmnivoiceInstruct(token)
      expect(r).toEqual({ ok: true, normalized: token, language: 'zh' })
    }
  })

  it('every English vocab entry validates as a singleton', () => {
    for (const token of OMNIVOICE_EN_VOCABULARY) {
      const r = validateOmnivoiceInstruct(token)
      expect(r).toEqual({ ok: true, normalized: token, language: 'en' })
    }
  })
})

describe('translateInstructToEnglish', () => {
  function translate(raw: string) {
    const v = validateOmnivoiceInstruct(raw)
    expect(v.ok).toBe(true)
    return translateInstructToEnglish(v as { ok: true; normalized: string; language: 'zh' | 'en' })
  }

  it('passes English instruct through unchanged', () => {
    const r = translate('male, young adult, low pitch')
    expect(r.translated).toBe('male, young adult, low pitch')
    expect(r.skipped).toEqual([])
  })

  it('translates basic Chinese tokens to English', () => {
    const r = translate('男、青年、中音调')
    expect(r.translated).toBe('male, young adult, moderate pitch')
    expect(r.skipped).toEqual([])
  })

  it('translates all gender/age/pitch tokens', () => {
    const r = translate('女、老年、高音调')
    expect(r.translated).toBe('female, elderly, high pitch')
    expect(r.skipped).toEqual([])
  })

  it('translates extreme pitch tokens', () => {
    const r = translate('极低音调、极高音调、耳语')
    expect(r.translated).toBe('very low pitch, very high pitch, whisper')
    expect(r.skipped).toEqual([])
  })

  it('skips Chinese dialects that have no English equivalent', () => {
    const r = translate('男、青年、四川话')
    expect(r.translated).toBe('male, young adult')
    expect(r.skipped).toEqual(['四川话'])
  })

  it('dedupes after translation', () => {
    // 男、青年、男 → 去重后 male, young adult
    const r = translate('男、青年、男')
    expect(r.translated).toBe('male, young adult')
    expect(r.skipped).toEqual([])
  })

  it('falls back to default when all tokens are dialects', () => {
    const r = translate('四川话、东北话')
    expect(r.translated).toBe('male, young adult')
    expect(r.skipped).toEqual(['四川话', '东北话'])
  })

  it('mix of translatable and dialect tokens', () => {
    const r = translate('女、四川话、东北话、中音调')
    expect(r.translated).toBe('female, moderate pitch')
    expect(r.skipped).toEqual(['四川话', '东北话'])
  })

  it('handles single Chinese token', () => {
    const r = translate('男')
    expect(r.translated).toBe('male')
    expect(r.skipped).toEqual([])
  })

  it('translated output is valid against English vocab', () => {
    const r = translate('男、青年、中音调')
    const enValidate = validateOmnivoiceInstruct(r.translated)
    expect(enValidate.ok).toBe(true)
    if (enValidate.ok) {
      expect(enValidate.language).toBe('en')
    }
  })
})
