import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROMPT_IDS } from '@/lib/prompt-i18n'
import { seedPromptConfig } from '@/lib/config-center/prompts/seed'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    promptDefinition: {
      upsert: vi.fn(),
    },
    promptVersion: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

async function writePrompt(rootDir: string, pathStem: string, locale: 'zh' | 'en', content: string) {
  const promptPath = path.join(rootDir, 'lib', 'prompts', `${pathStem}.${locale}.txt`)
  await fs.mkdir(path.dirname(promptPath), { recursive: true })
  await fs.writeFile(promptPath, content, 'utf8')
}

describe('prompt config seed', () => {
  let rootDir: string

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-config-seed-'))
    vi.clearAllMocks()
    prismaMock.promptDefinition.upsert.mockImplementation(async (args) => ({
      id: `definition:${args.where.promptId}`,
      ...args.create,
      ...args.update,
    }))
    prismaMock.promptVersion.findUnique.mockResolvedValue(null)
    prismaMock.promptVersion.create.mockImplementation(async (args) => ({
      id: `version:${args.data.promptDefinitionId}:${args.data.locale}`,
      ...args.data,
    }))
  })

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true })
  })

  it('upserts registered and unregistered definitions from prompt files', async () => {
    await writePrompt(rootDir, 'novel-promotion/storyboard_grid_image', 'zh', 'registered {style}')
    await writePrompt(rootDir, 'custom/unregistered_prompt', 'en', 'unregistered {input}')

    const result = await seedPromptConfig({ rootDir })

    expect(result).toEqual({ definitions: 2, files: 2 })
    expect(prismaMock.promptDefinition.upsert).toHaveBeenCalledTimes(2)

    const upsertCalls = prismaMock.promptDefinition.upsert.mock.calls.map(([args]) => args)
    const registered = upsertCalls.find((args) => args.create.pathStem === 'novel-promotion/storyboard_grid_image')
    const unregistered = upsertCalls.find((args) => args.create.pathStem === 'custom/unregistered_prompt')

    expect(registered?.create).toMatchObject({
      promptId: PROMPT_IDS.NP_STORYBOARD_GRID_IMAGE,
      pathStem: 'novel-promotion/storyboard_grid_image',
      category: 'novel-promotion',
      name: PROMPT_IDS.NP_STORYBOARD_GRID_IMAGE,
      description: null,
      isRegistered: true,
    })
    expect(JSON.parse(registered?.create.variableKeys)).toEqual([
      'storyboard_text_json_input',
      'source_text',
      'aspect_ratio',
      'style',
      'grid_layout',
      'panel_count',
    ])
    expect(unregistered?.create).toMatchObject({
      promptId: 'custom.unregistered_prompt',
      pathStem: 'custom/unregistered_prompt',
      category: 'custom',
      name: 'custom.unregistered_prompt',
      description: null,
      variableKeys: '[]',
      isRegistered: false,
    })
    expect(prismaMock.promptVersion.create).toHaveBeenCalledTimes(2)
  })

  it('does not recreate existing version 1 for the same definition and locale', async () => {
    await writePrompt(rootDir, 'novel-promotion/storyboard_grid_image', 'zh', 'registered zh')
    await writePrompt(rootDir, 'novel-promotion/storyboard_grid_image', 'en', 'registered en')
    prismaMock.promptVersion.findUnique.mockImplementation(async (args) => (
      args.where.promptDefinitionId_locale_version.locale === 'zh'
        ? { id: 'existing-version' }
        : null
    ))

    await seedPromptConfig({ rootDir })

    expect(prismaMock.promptVersion.findUnique).toHaveBeenCalledTimes(2)
    expect(prismaMock.promptVersion.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.promptVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        locale: 'en',
        version: 1,
        content: 'registered en',
      }),
    }))
  })
})
