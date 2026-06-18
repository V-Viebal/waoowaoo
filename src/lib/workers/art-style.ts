import { getArtStylePrompt, type ArtStyleValue } from '@/lib/constants'
import { type TaskJobData } from '@/lib/task/types'

export function resolveWorkerArtStylePrompt(input: {
  payloadArtStyle?: ArtStyleValue
  modelConfigArtStyle?: string | null
  modelConfigArtStylePrompt?: string | null
  locale: TaskJobData['locale']
}): string {
  if (input.payloadArtStyle) {
    return getArtStylePrompt(input.payloadArtStyle, input.locale)
  }

  const configuredPrompt = input.modelConfigArtStylePrompt?.trim()
  if (configuredPrompt) return configuredPrompt

  return getArtStylePrompt(input.modelConfigArtStyle, input.locale)
}
