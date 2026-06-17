import fs from 'fs'
import path from 'path'
import { resolvePromptTemplate } from '@/lib/config-center/prompts/service'
import { PROMPT_CATALOG } from './catalog'
import type { PromptId } from './prompt-ids'
import type { PromptLocale } from './types'
import { PromptI18nError } from './errors'

const templateCache = new Map<string, string>()

function buildCacheKey(promptId: PromptId, locale: PromptLocale) {
  return `${promptId}:${locale}`
}

function readFilePromptTemplate(promptId: PromptId, locale: PromptLocale): string {
  const entry = PROMPT_CATALOG[promptId]
  if (!entry) {
    throw new PromptI18nError(
      'PROMPT_ID_UNREGISTERED',
      promptId,
      `Prompt is not registered: ${promptId}`,
    )
  }

  const cacheKey = buildCacheKey(promptId, locale)
  const cached = templateCache.get(cacheKey)
  if (cached) return cached

  const filePath = path.join(process.cwd(), 'lib', 'prompts', `${entry.pathStem}.${locale}.txt`)
  let template = ''
  try {
    template = fs.readFileSync(filePath, 'utf-8')
  } catch {
    throw new PromptI18nError(
      'PROMPT_TEMPLATE_NOT_FOUND',
      promptId,
      `Prompt template not found: ${filePath}`,
      { filePath, locale },
    )
  }

  templateCache.set(cacheKey, template)
  return template
}

export function getPromptTemplate(promptId: PromptId, locale: PromptLocale): string {
  return readFilePromptTemplate(promptId, locale)
}

export async function getPromptTemplateAsync(
  promptId: PromptId,
  locale: PromptLocale,
  options: { projectId?: string | null } = {},
): Promise<string> {
  const databaseTemplate = await resolvePromptTemplate({
    promptId,
    locale,
    projectId: options.projectId,
  })

  if (databaseTemplate) return databaseTemplate
  return readFilePromptTemplate(promptId, locale)
}
