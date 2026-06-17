import fs from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { PROMPT_CATALOG } from '@/lib/prompt-i18n/catalog'
import type { PromptId } from '@/lib/prompt-i18n'
import type { PromptLocale } from '@/lib/prompt-i18n/types'
import { PROMPT_VERSION_STATUS } from './types'
import { extractPromptPlaceholders } from './validation'

const PROMPT_FILE_PATTERN = /^(.*)\.(zh|en)\.txt$/
const INITIAL_IMPORT_CHANGE_NOTE = 'Initial import from lib/prompts'

export interface PromptSeedFile {
  pathStem: string
  locale: PromptLocale
  filePath: string
  content: string
}

export interface SeedPromptConfigOptions {
  rootDir?: string
  now?: () => Date
}

export interface SeedPromptConfigResult {
  definitions: number
  files: number
}

interface CatalogPathEntry {
  promptId: PromptId
  variableKeys: readonly string[]
  literalVariableKeys: readonly string[]
}

async function walkPromptFiles(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const files: string[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walkPromptFiles(fullPath))
      continue
    }
    if (entry.isFile() && PROMPT_FILE_PATTERN.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

export function categoryFromPathStem(pathStem: string): string {
  return pathStem.split('/').find(Boolean) || 'general'
}

export function fallbackPromptIdFromPathStem(pathStem: string): string {
  return pathStem.replace(/\//g, '.')
}

export async function listPromptFiles(rootDir = process.cwd()): Promise<PromptSeedFile[]> {
  const promptRoot = path.join(rootDir, 'lib', 'prompts')
  const filePaths = await walkPromptFiles(promptRoot)
  const files: PromptSeedFile[] = []

  for (const filePath of filePaths) {
    const relativePath = path.relative(promptRoot, filePath).split(path.sep).join('/')
    const match = relativePath.match(PROMPT_FILE_PATTERN)
    if (!match) continue
    files.push({
      pathStem: match[1],
      locale: match[2] as PromptLocale,
      filePath,
      content: await fs.readFile(filePath, 'utf8'),
    })
  }

  return files
}

function buildCatalogByPathStem(): Map<string, CatalogPathEntry> {
  const entries = Object.entries(PROMPT_CATALOG) as Array<[PromptId, (typeof PROMPT_CATALOG)[PromptId]]>
  return new Map(entries.map(([promptId, entry]) => [
    entry.pathStem,
    {
      promptId,
      variableKeys: entry.variableKeys,
      literalVariableKeys: entry.literalVariableKeys ?? [],
    },
  ]))
}

function groupPromptFiles(files: PromptSeedFile[]): Map<string, PromptSeedFile[]> {
  const grouped = new Map<string, PromptSeedFile[]>()
  for (const file of files) {
    const group = grouped.get(file.pathStem) || []
    group.push(file)
    grouped.set(file.pathStem, group)
  }
  return grouped
}

function collectPromptVariableKeys(files: PromptSeedFile[]): string[] {
  const keys = new Set<string>()
  for (const file of files) {
    for (const key of extractPromptPlaceholders(file.content)) {
      keys.add(key)
    }
  }
  return Array.from(keys).sort((left, right) => left.localeCompare(right))
}

function resolveSeedVariableKeys(pathStem: string, promptFiles: PromptSeedFile[], catalogEntry?: CatalogPathEntry): string[] {
  const templateVariableKeys = collectPromptVariableKeys(promptFiles)
  if (!catalogEntry) return templateVariableKeys

  const declared = new Set(catalogEntry.variableKeys)
  const literal = new Set(catalogEntry.literalVariableKeys)
  for (const key of templateVariableKeys) {
    if (!declared.has(key) && !literal.has(key)) {
      throw new Error(`PROMPT_SEED_VARIABLE_MISMATCH: ${pathStem}:${key}`)
    }
  }

  return Array.from(catalogEntry.variableKeys)
}

export async function seedPromptConfig(options: SeedPromptConfigOptions = {}): Promise<SeedPromptConfigResult> {
  const rootDir = options.rootDir || process.cwd()
  const now = options.now || (() => new Date())
  const files = await listPromptFiles(rootDir)
  const grouped = groupPromptFiles(files)
  const catalogByPathStem = buildCatalogByPathStem()

  for (const [pathStem, promptFiles] of Array.from(grouped.entries()).sort(([left], [right]) => left.localeCompare(right))) {
    const catalogEntry = catalogByPathStem.get(pathStem)
    const promptId = catalogEntry?.promptId || fallbackPromptIdFromPathStem(pathStem)
    const category = categoryFromPathStem(pathStem)
    const variableKeys = JSON.stringify(resolveSeedVariableKeys(pathStem, promptFiles, catalogEntry))
    const isRegistered = Boolean(catalogEntry)

    const definition = await prisma.promptDefinition.upsert({
      where: { promptId },
      create: {
        promptId,
        pathStem,
        category,
        name: promptId,
        description: null,
        variableKeys,
        isRegistered,
      },
      update: {
        pathStem,
        category,
        name: promptId,
        variableKeys,
        isRegistered,
      },
    })

    for (const file of promptFiles.sort((left, right) => left.locale.localeCompare(right.locale))) {
      await prisma.promptVersion.upsert({
        where: {
          promptDefinitionId_locale_version: {
            promptDefinitionId: definition.id,
            locale: file.locale,
            version: 1,
          },
        },
        create: {
          promptDefinitionId: definition.id,
          locale: file.locale,
          version: 1,
          status: PROMPT_VERSION_STATUS.PUBLISHED,
          content: file.content,
          publishedAt: now(),
          changeNote: INITIAL_IMPORT_CHANGE_NOTE,
        },
        update: {},
      })
    }
  }

  return { definitions: grouped.size, files: files.length }
}
