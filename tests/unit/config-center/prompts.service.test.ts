import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROMPT_IDS } from '@/lib/prompt-i18n'
import { PROMPT_VERSION_STATUS } from '@/lib/config-center/prompts/types'
import {
  getCatalogVariables,
  listPromptDefinitions,
  resolvePromptTemplate,
} from '@/lib/config-center/prompts/service'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    projectPromptOverride: {
      findFirst: vi.fn(),
    },
    promptVersion: {
      findFirst: vi.fn(),
    },
    promptDefinition: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

describe('prompt runtime service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses project override before latest published version', async () => {
    prismaMock.projectPromptOverride.findFirst.mockResolvedValue({
      promptVersion: { content: 'override-template' },
    })
    prismaMock.promptVersion.findFirst.mockResolvedValue({ content: 'published-template' })

    const template = await resolvePromptTemplate({
      promptId: PROMPT_IDS.NP_SELECT_PROP,
      locale: 'zh',
      projectId: 'project-1',
    })

    expect(template).toBe('override-template')
    expect(prismaMock.projectPromptOverride.findFirst).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        locale: 'zh',
        promptDefinition: { promptId: PROMPT_IDS.NP_SELECT_PROP },
      },
      include: { promptVersion: true },
    })
    expect(prismaMock.promptVersion.findFirst).not.toHaveBeenCalled()
  })

  it('falls back to latest published version when project override is absent', async () => {
    prismaMock.projectPromptOverride.findFirst.mockResolvedValue(null)
    prismaMock.promptVersion.findFirst.mockResolvedValue({ content: 'published-template' })

    const template = await resolvePromptTemplate({
      promptId: PROMPT_IDS.NP_SELECT_PROP,
      locale: 'zh',
      projectId: 'project-1',
    })

    expect(template).toBe('published-template')
    expect(prismaMock.promptVersion.findFirst).toHaveBeenCalledWith({
      where: {
        locale: 'zh',
        status: PROMPT_VERSION_STATUS.PUBLISHED,
        promptDefinition: { promptId: PROMPT_IDS.NP_SELECT_PROP },
      },
      orderBy: [{ publishedAt: 'desc' }, { version: 'desc' }],
    })
  })

  it('skips project override lookup without projectId', async () => {
    prismaMock.promptVersion.findFirst.mockResolvedValue({ content: 'published-template' })

    const template = await resolvePromptTemplate({
      promptId: PROMPT_IDS.NP_SELECT_PROP,
      locale: 'zh',
    })

    expect(template).toBe('published-template')
    expect(prismaMock.projectPromptOverride.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.promptVersion.findFirst).toHaveBeenCalledWith({
      where: {
        locale: 'zh',
        status: PROMPT_VERSION_STATUS.PUBLISHED,
        promptDefinition: { promptId: PROMPT_IDS.NP_SELECT_PROP },
      },
      orderBy: [{ publishedAt: 'desc' }, { version: 'desc' }],
    })
  })

  it('parses definition variableKeys JSON and falls back to empty arrays for invalid values', async () => {
    prismaMock.promptDefinition.findMany.mockResolvedValue([
      {
        id: 'definition-1',
        promptId: 'registered',
        category: 'novel-promotion',
        variableKeys: '["input","style"]',
        versions: [],
      },
      {
        id: 'definition-2',
        promptId: 'bad-json',
        category: 'custom',
        variableKeys: '{bad-json',
        versions: [],
      },
      {
        id: 'definition-3',
        promptId: 'not-array',
        category: 'custom',
        variableKeys: '{"input":true}',
        versions: [],
      },
    ])

    const definitions = await listPromptDefinitions()

    expect(prismaMock.promptDefinition.findMany).toHaveBeenCalledWith({
      orderBy: [{ category: 'asc' }, { promptId: 'asc' }],
      include: {
        versions: {
          orderBy: [{ locale: 'asc' }, { version: 'desc' }],
        },
      },
    })
    expect(definitions.map((definition) => definition.variableKeys)).toEqual([
      ['input', 'style'],
      [],
      [],
    ])
  })

  it('returns catalog variable keys for known prompts and empty array for unknown prompts', () => {
    expect(getCatalogVariables(PROMPT_IDS.NP_SELECT_PROP)).toEqual(['input', 'props_lib_name'])
    expect(getCatalogVariables('unknown-prompt')).toEqual([])
  })
})
