import { prisma } from '@/lib/prisma'
import { PROMPT_CATALOG } from '@/lib/prompt-i18n/catalog'
import type { PromptId } from '@/lib/prompt-i18n/prompt-ids'
import type { PromptLocale } from '@/lib/prompt-i18n/types'
import { PROMPT_VERSION_STATUS } from './types'

export interface ResolvePromptTemplateInput {
  promptId: PromptId | string
  locale: PromptLocale
  projectId?: string | null
}

function parseVariableKeys(variableKeys: string): string[] {
  try {
    const parsed = JSON.parse(variableKeys)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((key): key is string => typeof key === 'string')
  } catch {
    return []
  }
}

export async function resolvePromptTemplate(input: ResolvePromptTemplateInput): Promise<string | null> {
  if (input.projectId) {
    const override = await prisma.projectPromptOverride.findFirst({
      where: {
        projectId: input.projectId,
        locale: input.locale,
        promptDefinition: { promptId: input.promptId },
      },
      select: { promptVersion: { select: { content: true } } },
    })

    const overrideContent = override?.promptVersion?.content
    if (overrideContent != null) {
      return overrideContent
    }
  }

  const published = await prisma.promptVersion.findFirst({
    where: {
      locale: input.locale,
      status: PROMPT_VERSION_STATUS.PUBLISHED,
      promptDefinition: { promptId: input.promptId },
    },
    orderBy: [{ publishedAt: 'desc' }, { version: 'desc' }],
    select: { content: true },
  })

  return published?.content ?? null
}

export async function listPromptDefinitions() {
  const definitions = await prisma.promptDefinition.findMany({
    orderBy: [{ category: 'asc' }, { promptId: 'asc' }],
    include: {
      versions: {
        orderBy: [{ locale: 'asc' }, { version: 'desc' }],
        select: {
          id: true,
          promptDefinitionId: true,
          locale: true,
          version: true,
          status: true,
          createdByUserId: true,
          publishedByUserId: true,
          publishedAt: true,
          disabledAt: true,
          changeNote: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  })

  return definitions.map((definition) => ({
    ...definition,
    variableKeys: parseVariableKeys(definition.variableKeys),
  }))
}

export function getCatalogVariables(promptId: PromptId | string): readonly string[] {
  return PROMPT_CATALOG[promptId as PromptId]?.variableKeys || []
}
