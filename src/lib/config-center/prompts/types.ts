import type { PromptId } from '@/lib/prompt-i18n'
import type { PromptLocale } from '@/lib/prompt-i18n/types'

export const PROMPT_VERSION_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  DISABLED: 'disabled',
} as const

export type PromptVersionStatus = (typeof PROMPT_VERSION_STATUS)[keyof typeof PROMPT_VERSION_STATUS]

export interface PromptDefinitionSeed {
  promptId: PromptId | string
  pathStem: string
  category: string
  name: string
  description: string | null
  variableKeys: string[]
  isRegistered: boolean
}

export interface PromptTemplateLookup {
  promptId: PromptId
  locale: PromptLocale
  projectId?: string | null
}
