import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolvePromptTemplate } from '@/lib/config-center/prompts/service'
import {
  buildPromptAsync,
  getPromptTemplateAsync,
  PROMPT_IDS,
} from '@/lib/prompt-i18n'

const { resolvePromptTemplateMock } = vi.hoisted(() => ({
  resolvePromptTemplateMock: vi.fn(),
}))

vi.mock('@/lib/config-center/prompts/service', () => ({
  resolvePromptTemplate: resolvePromptTemplateMock,
}))

const mockedResolvePromptTemplate = vi.mocked(resolvePromptTemplate)

describe('database prompt template store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns database template before file template', async () => {
    mockedResolvePromptTemplate.mockResolvedValue('db-template')

    const template = await getPromptTemplateAsync(PROMPT_IDS.NP_SELECT_PROP, 'zh', {
      projectId: 'project-1',
    })

    expect(template).toBe('db-template')
    expect(mockedResolvePromptTemplate).toHaveBeenCalledWith({
      promptId: PROMPT_IDS.NP_SELECT_PROP,
      locale: 'zh',
      projectId: 'project-1',
    })
  })

  it('falls back to file template when database template is absent', async () => {
    mockedResolvePromptTemplate.mockResolvedValue(null)

    const template = await getPromptTemplateAsync(PROMPT_IDS.NP_SELECT_PROP, 'zh')

    expect(template).toContain('关键剧情道具资产分析师')
    expect(mockedResolvePromptTemplate).toHaveBeenCalledWith(expect.objectContaining({
      promptId: PROMPT_IDS.NP_SELECT_PROP,
      locale: 'zh',
    }))
  })

  it('buildPromptAsync renders variables from database template', async () => {
    mockedResolvePromptTemplate.mockResolvedValue('hello {input}')

    const prompt = await buildPromptAsync({
      promptId: PROMPT_IDS.NP_AI_STORY_EXPAND,
      locale: 'zh',
      variables: { input: '正文' },
      projectId: 'project-1',
    })

    expect(prompt).toBe('hello 正文')
  })

  it('buildPromptAsync preserves literal placeholders from database template', async () => {
    mockedResolvePromptTemplate.mockResolvedValue('当前 providerId={providerId}\n保留 {{task_id}} {{prompt}}')

    const prompt = await buildPromptAsync({
      promptId: PROMPT_IDS.SKILL_API_CONFIG_TEMPLATE_SYSTEM,
      locale: 'zh',
      variables: { providerId: 'provider-1' },
      projectId: 'project-1',
    })

    expect(prompt).toContain('当前 providerId=provider-1')
    expect(prompt).toContain('{{task_id}}')
    expect(prompt).toContain('{{prompt}}')
    expect(prompt).not.toContain('{providerId}')
  })
})
