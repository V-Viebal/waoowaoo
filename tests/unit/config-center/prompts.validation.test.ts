import { describe, expect, it } from 'vitest'
import { findMissingPromptVariables, normalizePromptStatus } from '@/lib/config-center/prompts/validation'

describe('prompt validation', () => {
  it('finds missing single-brace variables', () => {
    expect(findMissingPromptVariables('hello {input}', ['input', 'style'])).toEqual(['style'])
  })

  it('accepts double-brace variables too', () => {
    expect(findMissingPromptVariables('hello {{input}} and {style}', ['input', 'style'])).toEqual([])
  })

  it('normalizes valid statuses', () => {
    expect(normalizePromptStatus('draft')).toBe('draft')
    expect(normalizePromptStatus('published')).toBe('published')
    expect(normalizePromptStatus('disabled')).toBe('disabled')
  })

  it('rejects invalid statuses', () => {
    expect(() => normalizePromptStatus('archived')).toThrow('PROMPT_STATUS_INVALID')
  })
})
