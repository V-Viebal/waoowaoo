import { getArtStylePrompt } from '@/lib/constants'
import { prisma } from '@/lib/prisma'
import type { ArtStyleRecord, ResolvedArtStylePrompt } from './types'

type ResolveArtStylePromptInput = {
  artStyleId?: string | null
  legacyArtStyle?: string | null
  legacyArtStylePrompt?: string | null
  userId: string
  locale: string
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function normalizeArtStyleLocale(locale: string): 'zh' | 'en' {
  return locale === 'en' ? 'en' : 'zh'
}

function accessibleArtStyleWhere(userId: string) {
  return {
    enabled: true,
    OR: [
      { scope: 'system' },
      { scope: 'user', ownerUserId: userId },
    ],
  }
}

export async function listAvailableArtStyles(userId: string): Promise<ArtStyleRecord[]> {
  const artStyles = await prisma.artStyle.findMany({
    where: accessibleArtStyleWhere(userId),
    orderBy: [
      { scope: 'asc' },
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
    ],
  })

  return artStyles as ArtStyleRecord[]
}

export async function resolveArtStylePrompt(
  input: ResolveArtStylePromptInput,
): Promise<ResolvedArtStylePrompt> {
  const artStyleId = normalizeOptionalString(input.artStyleId)
  const unavailableFallbackReason = artStyleId ? 'ART_STYLE_UNAVAILABLE' : null

  if (artStyleId) {
    const selected = await prisma.artStyle.findFirst({
      where: {
        id: artStyleId,
        ...accessibleArtStyleWhere(input.userId),
      },
      select: { id: true, prompt: true },
    })
    const selectedPrompt = normalizeOptionalString(selected?.prompt)
    if (selected && selectedPrompt) {
      return {
        artStyleId: selected.id,
        prompt: selectedPrompt,
        fallbackReason: null,
      }
    }
  }

  const legacyArtStylePrompt = normalizeOptionalString(input.legacyArtStylePrompt)
  if (legacyArtStylePrompt) {
    return {
      artStyleId: null,
      prompt: legacyArtStylePrompt,
      fallbackReason: unavailableFallbackReason,
    }
  }

  const legacyArtStyle = normalizeOptionalString(input.legacyArtStyle)
  const legacyPrompt = getArtStylePrompt(legacyArtStyle || 'american-comic', normalizeArtStyleLocale(input.locale)).trim()
  if (legacyPrompt) {
    return {
      artStyleId: null,
      prompt: legacyPrompt,
      fallbackReason: unavailableFallbackReason,
    }
  }

  const systemDefault = await prisma.artStyle.findFirst({
    where: {
      scope: 'system',
      enabled: true,
    },
    orderBy: [
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
    ],
    select: { id: true, prompt: true },
  })

  return {
    artStyleId: systemDefault?.id ?? null,
    prompt: normalizeOptionalString(systemDefault?.prompt) ?? '',
    fallbackReason: 'DEFAULT_STYLE_USED',
  }
}
