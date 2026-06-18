'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import { getArtStyleLabelSync } from '@/lib/art-styles'

export interface ArtStyleOption {
  id: string
  name: string
  value: string
  label: string
  description: string | null
  prompt: string
  sortOrder: number
  scope: 'system' | 'user'
}

export interface UseArtStylesOptions {
  enabled?: boolean
}

export interface UseArtStylesResult {
  artStyles: ArtStyleOption[]
  systemStyles: ArtStyleOption[]
  userStyles: ArtStyleOption[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  getStyleById: (id: string | null | undefined) => ArtStyleOption | null
  getStyleLabel: (id: string | null | undefined) => string
}

type ApiArtStyle = {
  id: string
  scope: 'system' | 'user'
  name: string
  description: string | null
  prompt: string
  sortOrder: number
  enabled: boolean
}

/**
 * Hook for fetching and managing art styles
 * Fetches system and user-defined art styles from API
 */
export function useArtStyles(options: UseArtStylesOptions = {}): UseArtStylesResult {
  const { enabled = true } = options

  const [artStyles, setArtStyles] = useState<ArtStyleOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchArtStyles = useCallback(async () => {
    if (!enabled) return

    setLoading(true)
    setError(null)

    try {
      const response = await apiFetch('/api/art-styles')

      if (!response.ok) {
        throw new Error(`Failed to fetch art styles (${response.status})`)
      }

      const data = await response.json() as { artStyles: ApiArtStyle[] }

      // Convert API response to option format matching ART_STYLES structure
      const formattedStyles: ArtStyleOption[] = (data.artStyles || []).map((style) => ({
        id: style.id,
        name: style.name,
        value: style.id,
        label: style.name,
        description: style.description,
        prompt: style.prompt,
        sortOrder: style.sortOrder,
        scope: style.scope,
      }))

      setArtStyles(formattedStyles)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(message)
      console.error('[useArtStyles] Failed to fetch art styles:', err)
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    void fetchArtStyles()
  }, [fetchArtStyles])

  const systemStyles = artStyles.filter((style) => style.scope === 'system')
  const userStyles = artStyles.filter((style) => style.scope === 'user')

  const getStyleById = useCallback(
    (id: string | null | undefined): ArtStyleOption | null => {
      if (!id) return null
      return artStyles.find((style) => style.id === id) || null
    },
    [artStyles],
  )

  const getStyleLabel = useCallback(
    (id: string | null | undefined, fallback?: string): string => {
      if (!id) return ''
      // 优先从 API 获取的列表中查找
      const fromApi = getStyleById(id)
      if (fromApi) return fromApi.label
      // 回退到静态常量（处理系统风格的兼容）
      const staticLabel = getArtStyleLabelSync(id)
      if (staticLabel !== id) return staticLabel
      // 最后返回 ID 本身（用户自定义风格的情况）
      return fallback ?? id
    },
    [getStyleById],
  )

  return {
    artStyles,
    systemStyles,
    userStyles,
    loading,
    error,
    refresh: fetchArtStyles,
    getStyleById,
    getStyleLabel,
  }
}
