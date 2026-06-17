import { getPromptTemplate, PROMPT_IDS, type PromptId } from '@/lib/prompt-i18n'

export type AssistantPromptId = 'api-config-template' | 'tutorial'

const PROMPT_ID_BY_ASSISTANT_ID: Record<AssistantPromptId, PromptId> = {
  'api-config-template': PROMPT_IDS.SKILL_API_CONFIG_TEMPLATE_SYSTEM,
  tutorial: PROMPT_IDS.SKILL_TUTORIAL_SYSTEM,
}

const promptCache = new Map<AssistantPromptId, string>()

function normalizePromptTemplate(promptI18nId: PromptId, content: string): string {
  const trimmed = content.trim()
  if (!trimmed) {
    throw new Error(`ASSISTANT_SYSTEM_PROMPT_EMPTY: ${promptI18nId}`)
  }
  return trimmed
}

function loadPromptTemplate(promptId: AssistantPromptId): string {
  const promptI18nId = PROMPT_ID_BY_ASSISTANT_ID[promptId]
  const cached = promptCache.get(promptId)
  if (cached) return normalizePromptTemplate(promptI18nId, cached)

  const content = getPromptTemplate(promptI18nId, 'zh')

  promptCache.set(promptId, content)
  return normalizePromptTemplate(promptI18nId, content)
}

function replacePromptVariables(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, keyRaw: string) => {
    const key = keyRaw.trim()
    return vars[key] || ''
  })
}

export function renderAssistantSystemPrompt(
  promptId: AssistantPromptId,
  vars?: Record<string, string>,
): string {
  const template = loadPromptTemplate(promptId)
  if (!vars || Object.keys(vars).length === 0) return template
  return replacePromptVariables(template, vars)
}
