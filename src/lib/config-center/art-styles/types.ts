import type { ArtStyle } from '@prisma/client'

export type ArtStyleScope = 'system' | 'user'

export type ArtStyleFallbackReason =
  | 'ART_STYLE_UNAVAILABLE'
  | 'DEFAULT_STYLE_USED'

export type ArtStyleRecord = Omit<ArtStyle, 'scope'> & {
  scope: ArtStyleScope
}

export interface ResolvedArtStylePrompt {
  artStyleId: string | null
  prompt: string
  fallbackReason: ArtStyleFallbackReason | null
}
