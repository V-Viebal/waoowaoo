import { ApiError } from '@/lib/api-errors'

type ArtStyleMutationInput = {
  name?: string
  description?: string | null
  prompt?: string
  previewImageUrl?: string | null
  sortOrder?: number
  enabled?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

function normalizeNullableString(value: unknown): string | null | undefined {
  if (value === null) return null
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new ApiError('INVALID_PARAMS')
  }
  return value.trim() || null
}

function normalizeSortOrder(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiError('INVALID_PARAMS')
  }
  return Math.trunc(value)
}

function normalizeEnabled(value: unknown): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new ApiError('INVALID_PARAMS')
  }
  return value
}

export function parseCreateArtStyleInput(body: unknown): Required<Pick<ArtStyleMutationInput, 'name' | 'prompt' | 'sortOrder' | 'enabled'>> & {
  description: string | null
  previewImageUrl: string | null
} {
  if (!isRecord(body)) throw new ApiError('INVALID_PARAMS')

  const name = normalizeString(body.name)
  const prompt = normalizeString(body.prompt)
  if (!name || !prompt) {
    throw new ApiError('INVALID_PARAMS')
  }

  return {
    name,
    description: normalizeNullableString(body.description) ?? null,
    prompt,
    previewImageUrl: normalizeNullableString(body.previewImageUrl) ?? null,
    sortOrder: normalizeSortOrder(body.sortOrder) ?? 0,
    enabled: normalizeEnabled(body.enabled) ?? true,
  }
}

export function parseUpdateArtStyleInput(body: unknown): ArtStyleMutationInput {
  if (!isRecord(body)) throw new ApiError('INVALID_PARAMS')

  const updateData: ArtStyleMutationInput = {}
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = normalizeString(body.name)
    if (!name) throw new ApiError('INVALID_PARAMS')
    updateData.name = name
  }
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    updateData.description = normalizeNullableString(body.description)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'prompt')) {
    const prompt = normalizeString(body.prompt)
    if (!prompt) throw new ApiError('INVALID_PARAMS')
    updateData.prompt = prompt
  }
  if (Object.prototype.hasOwnProperty.call(body, 'previewImageUrl')) {
    updateData.previewImageUrl = normalizeNullableString(body.previewImageUrl)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'sortOrder')) {
    updateData.sortOrder = normalizeSortOrder(body.sortOrder)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'enabled')) {
    updateData.enabled = normalizeEnabled(body.enabled)
  }

  if (Object.keys(updateData).length === 0) {
    throw new ApiError('INVALID_PARAMS')
  }

  return updateData
}
