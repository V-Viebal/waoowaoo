import { describe, expect, it } from 'vitest'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'

describe('buildPrompt literal placeholders', () => {
  it('renders skills system prompt variables while preserving literal template placeholders', () => {
    const prompt = buildPrompt({
      promptId: PROMPT_IDS.SKILL_API_CONFIG_TEMPLATE_SYSTEM,
      locale: 'zh',
      variables: { providerId: 'provider-1' },
    })

    expect(prompt).toContain('当前 providerId=provider-1')
    expect(prompt).toContain('{{task_id}}')
    expect(prompt).toContain('{{prompt}}')
    expect(prompt).not.toContain('{{providerId}}')
  })
})
