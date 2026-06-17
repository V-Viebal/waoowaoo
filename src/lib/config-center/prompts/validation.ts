import { PROMPT_VERSION_STATUS, type PromptVersionStatus } from './types'

const SINGLE_PLACEHOLDER_PATTERN = /\{([A-Za-z0-9_]+)\}/g
const DOUBLE_PLACEHOLDER_PATTERN = /\{\{([A-Za-z0-9_]+)\}\}/g

export function extractPromptPlaceholders(template: string): string[] {
  const keys = new Set<string>()
  for (const match of template.matchAll(SINGLE_PLACEHOLDER_PATTERN)) {
    if (match[1]) keys.add(match[1])
  }
  for (const match of template.matchAll(DOUBLE_PLACEHOLDER_PATTERN)) {
    if (match[1]) keys.add(match[1])
  }
  return Array.from(keys)
}

export function findMissingPromptVariables(template: string, requiredVariables: readonly string[]): string[] {
  const placeholders = new Set(extractPromptPlaceholders(template))
  return requiredVariables.filter((key) => !placeholders.has(key))
}

export function normalizePromptStatus(value: unknown): PromptVersionStatus {
  if (
    value === PROMPT_VERSION_STATUS.DRAFT
    || value === PROMPT_VERSION_STATUS.PUBLISHED
    || value === PROMPT_VERSION_STATUS.DISABLED
  ) {
    return value
  }
  throw new Error(`PROMPT_STATUS_INVALID: ${String(value)}`)
}
