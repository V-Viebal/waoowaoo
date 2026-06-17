import { buildCharactersLibInfo, type CharacterBrief } from './analyze-global-parse'
import type { Locale } from '@/i18n/routing'
import { getPromptTemplateAsync, PROMPT_IDS } from '@/lib/prompt-i18n'

export type AnalyzeGlobalPromptTemplates = {
  characterPromptTemplate: string
  locationPromptTemplate: string
  propPromptTemplate: string
}

export async function loadAnalyzeGlobalPromptTemplates(
  locale: Locale,
  projectId: string,
): Promise<AnalyzeGlobalPromptTemplates> {
  const [
    characterPromptTemplate,
    locationPromptTemplate,
    propPromptTemplate,
  ] = await Promise.all([
    getPromptTemplateAsync(PROMPT_IDS.NP_AGENT_CHARACTER_PROFILE, locale, { projectId }),
    getPromptTemplateAsync(PROMPT_IDS.NP_SELECT_LOCATION, locale, { projectId }),
    getPromptTemplateAsync(PROMPT_IDS.NP_SELECT_PROP, locale, { projectId }),
  ])

  return {
    characterPromptTemplate,
    locationPromptTemplate,
    propPromptTemplate,
  }
}

export function buildAnalyzeGlobalPrompts(params: {
  chunk: string
  templates: AnalyzeGlobalPromptTemplates
  existingCharacters: CharacterBrief[]
  existingLocationInfo: string[]
  existingPropNames: string[]
}) {
  const characterPrompt = params.templates.characterPromptTemplate
    .replace('{input}', params.chunk)
    .replace('{characters_lib_info}', buildCharactersLibInfo(params.existingCharacters))
  const locationPrompt = params.templates.locationPromptTemplate
    .replace('{input}', params.chunk)
    .replace('{locations_lib_name}', params.existingLocationInfo.join(', ') || '无')
  const propPrompt = params.templates.propPromptTemplate
    .replace('{input}', params.chunk)
    .replace('{props_lib_name}', params.existingPropNames.join(', ') || '无')
  return {
    characterPrompt,
    locationPrompt,
    propPrompt,
  }
}
