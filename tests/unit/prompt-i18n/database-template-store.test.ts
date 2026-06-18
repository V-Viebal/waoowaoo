import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolvePromptTemplate } from '@/lib/config-center/prompts/service'
import {
  buildPromptAsync,
  getPromptTemplateAsync,
  PROMPT_IDS,
} from '@/lib/prompt-i18n'

const { createScopedLoggerMock, loggerWarnMock, resolvePromptTemplateMock } = vi.hoisted(() => {
  const warnMock = vi.fn()
  return {
    loggerWarnMock: warnMock,
    createScopedLoggerMock: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: warnMock,
      error: vi.fn(),
      event: vi.fn(),
      child: vi.fn(),
    })),
    resolvePromptTemplateMock: vi.fn(),
  }
})

vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: createScopedLoggerMock,
}))

vi.mock('@/lib/config-center/prompts/service', () => ({
  resolvePromptTemplate: resolvePromptTemplateMock,
}))

const mockedResolvePromptTemplate = vi.mocked(resolvePromptTemplate)

describe('database prompt template store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps config center service out of template-store static imports', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/prompt-i18n/template-store.ts'),
      'utf8',
    )

    expect(source).not.toContain("from '@/lib/config-center/prompts/service'")
    expect(source).toContain("await import('@/lib/config-center/prompts/service')")
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

    const template = await getPromptTemplateAsync(PROMPT_IDS.NP_SELECT_PROP, 'zh', {
      projectId: 'project-1',
    })

    expect(template).toContain('关键剧情道具资产分析师')
    expect(mockedResolvePromptTemplate).toHaveBeenCalledWith({
      promptId: PROMPT_IDS.NP_SELECT_PROP,
      locale: 'zh',
      projectId: 'project-1',
    })
    expect(loggerWarnMock).toHaveBeenCalledTimes(1)
    expect(loggerWarnMock).toHaveBeenCalledWith({
      action: 'prompt_template_db_miss_fallback',
      message: 'prompt_template_db_miss_fallback',
      details: {
        promptId: PROMPT_IDS.NP_SELECT_PROP,
        locale: 'zh',
        projectId: 'project-1',
      },
    })
  })

  it('deduplicates database miss fallback logs by prompt, locale, and project', async () => {
    mockedResolvePromptTemplate.mockResolvedValue(null)

    await getPromptTemplateAsync(PROMPT_IDS.NP_SELECT_PROP, 'zh', {
      projectId: 'project-dedupe-1',
    })
    await getPromptTemplateAsync(PROMPT_IDS.NP_SELECT_PROP, 'zh', {
      projectId: 'project-dedupe-1',
    })
    await getPromptTemplateAsync(PROMPT_IDS.NP_SELECT_PROP, 'zh', {
      projectId: 'project-dedupe-2',
    })

    expect(loggerWarnMock).toHaveBeenCalledTimes(2)
    expect(loggerWarnMock).toHaveBeenNthCalledWith(1, {
      action: 'prompt_template_db_miss_fallback',
      message: 'prompt_template_db_miss_fallback',
      details: {
        promptId: PROMPT_IDS.NP_SELECT_PROP,
        locale: 'zh',
        projectId: 'project-dedupe-1',
      },
    })
    expect(loggerWarnMock).toHaveBeenNthCalledWith(2, {
      action: 'prompt_template_db_miss_fallback',
      message: 'prompt_template_db_miss_fallback',
      details: {
        promptId: PROMPT_IDS.NP_SELECT_PROP,
        locale: 'zh',
        projectId: 'project-dedupe-2',
      },
    })
  })

  it('returns empty database template without file fallback or miss log', async () => {
    mockedResolvePromptTemplate.mockResolvedValue('')

    const template = await getPromptTemplateAsync(PROMPT_IDS.NP_SELECT_PROP, 'zh', {
      projectId: 'project-1',
    })

    expect(template).toBe('')
    expect(loggerWarnMock).not.toHaveBeenCalled()
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

  it('propagates database lookup errors from getPromptTemplateAsync', async () => {
    mockedResolvePromptTemplate.mockRejectedValue(new Error('database unavailable'))

    await expect(getPromptTemplateAsync(PROMPT_IDS.NP_SELECT_PROP, 'zh')).rejects.toThrow(
      'database unavailable',
    )
    expect(loggerWarnMock).not.toHaveBeenCalled()
  })

  it('propagates database lookup errors from buildPromptAsync', async () => {
    mockedResolvePromptTemplate.mockRejectedValue(new Error('database unavailable'))

    await expect(buildPromptAsync({
      promptId: PROMPT_IDS.NP_AI_STORY_EXPAND,
      locale: 'zh',
      variables: { input: '正文' },
    })).rejects.toThrow('database unavailable')
    expect(loggerWarnMock).not.toHaveBeenCalled()
  })
})
