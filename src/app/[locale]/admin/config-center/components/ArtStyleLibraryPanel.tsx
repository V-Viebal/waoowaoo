'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { ArtStyleEditor, type ArtStyleEditorValues } from '@/app/[locale]/profile/components/art-style-library/ArtStyleEditor'
import { useToast } from '@/contexts/ToastContext'

export type ArtStyleScope = 'system' | 'user'
export type FilterStatus = 'all' | 'enabled' | 'disabled'

export interface ArtStyle {
  id: string
  scope: ArtStyleScope
  name: string
  description: string | null
  prompt: string
  previewImageUrl: string | null
  enabled: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

function artStyleMatchesFilters(style: ArtStyle, statusFilter: FilterStatus, searchQuery: string) {
  const statusMatches = statusFilter === 'all' ||
    (statusFilter === 'enabled' && style.enabled) ||
    (statusFilter === 'disabled' && !style.enabled)

  const searchLower = searchQuery.trim().toLowerCase()
  const searchMatches = !searchLower ||
    style.name.toLowerCase().includes(searchLower) ||
    (style.description?.toLowerCase().includes(searchLower) ?? false)

  return statusMatches && searchMatches
}

function buildEditorValues(style: ArtStyle): ArtStyleEditorValues {
  return {
    name: style.name,
    description: style.description || '',
    prompt: style.prompt,
    previewImageUrl: style.previewImageUrl || '',
    sortOrder: style.sortOrder,
  }
}

export default function ArtStyleLibraryPanel() {
  const t = useTranslations('configCenter.artStyles')
  const { showToast, showError: showToastError } = useToast()
  const [artStyles, setArtStyles] = useState<ArtStyle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [editingStyleId, setEditingStyleId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [togglingStyleId, setTogglingStyleId] = useState<string | null>(null)
  const [deletingStyleId, setDeletingStyleId] = useState<string | null>(null)

  const loadArtStyles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch('/api/admin/config-center/art-styles')
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, t('loadFailed')))
      }
      const payload: unknown = await response.json()
      const nextArtStyles = Array.isArray((payload as { artStyles?: unknown }).artStyles)
        ? ((payload as { artStyles: ArtStyle[] }).artStyles)
        : []
      setArtStyles(nextArtStyles)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadArtStyles()
  }, [loadArtStyles])

  const filteredArtStyles = useMemo(
    () => artStyles.filter((style) => artStyleMatchesFilters(style, statusFilter, searchQuery)),
    [artStyles, statusFilter, searchQuery],
  )

  const handleToggleEnabled = useCallback(async (style: ArtStyle) => {
    setTogglingStyleId(style.id)
    setError(null)
    try {
      const response = await apiFetch(`/api/admin/config-center/art-styles/${style.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !style.enabled }),
      })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, t('toggleFailed')))
      }
      setArtStyles((current) =>
        current.map((s) => (s.id === style.id ? { ...s, enabled: !s.enabled } : s)),
      )
      showToast(style.enabled ? t('messages.disabled') : t('messages.enabled'), 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('toggleFailed')
      setError(message)
      showToastError(message)
    } finally {
      setTogglingStyleId(null)
    }
  }, [t, showToast, showToastError])

  const handleDelete = useCallback(async (style: ArtStyle) => {
    if (!window.confirm(t('actions.deleteConfirm'))) {
      return
    }
    setDeletingStyleId(style.id)
    setError(null)
    try {
      const response = await apiFetch(`/api/admin/config-center/art-styles/${style.id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, t('deleteFailed')))
      }
      setArtStyles((current) => current.filter((s) => s.id !== style.id))
      if (editingStyleId === style.id) {
        setEditingStyleId(null)
      }
      showToast(t('messages.deleted'), 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('deleteFailed')
      setError(message)
      showToastError(message)
    } finally {
      setDeletingStyleId(null)
    }
  }, [editingStyleId, t, showToast, showToastError])

  const handleEditStart = useCallback((styleId: string) => {
    setEditingStyleId(styleId)
    setIsCreating(false)
  }, [])

  const handleEditorCancel = useCallback(() => {
    setIsCreating(false)
    setEditingStyleId(null)
  }, [])

  const handleEditorSubmit = useCallback(async (values: ArtStyleEditorValues) => {
    setSaving(true)
    setError(null)
    try {
      if (editingStyleId) {
        const currentStyle = artStyles.find((s) => s.id === editingStyleId)
        const response = await apiFetch(`/api/admin/config-center/art-styles/${editingStyleId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...values,
            enabled: currentStyle?.enabled ?? true,
          }),
        })
        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response, t('updateFailed')))
        }
        const updated = await response.json() as { artStyle: ArtStyle }
        setArtStyles((current) =>
          current.map((s) => (s.id === editingStyleId ? updated.artStyle : s)),
        )
        showToast(t('messages.updated'), 'success')
      } else {
        const response = await apiFetch('/api/admin/config-center/art-styles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...values,
            enabled: true,
          }),
        })
        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response, t('createFailed')))
        }
        const created = await response.json() as { artStyle: ArtStyle }
        setArtStyles((current) => [...current, created.artStyle])
        showToast(t('messages.created'), 'success')
      }
      setIsCreating(false)
      setEditingStyleId(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('saveFailed')
      setError(message)
      showToastError(message)
    } finally {
      setSaving(false)
    }
  }, [editingStyleId, artStyles, t, showToast, showToastError])

  const editingStyle = useMemo(() => {
    if (!editingStyleId) return undefined
    const style = artStyles.find((s) => s.id === editingStyleId)
    if (!style) return undefined
    return {
      name: style.name,
      description: style.description ?? '',
      prompt: style.prompt,
      previewImageUrl: style.previewImageUrl ?? '',
      sortOrder: style.sortOrder,
    }
  }, [editingStyleId, artStyles])

  const editorLabels = useMemo(() => ({
    name: t('editor.name'),
    description: t('editor.description'),
    prompt: t('editor.prompt'),
    previewImageUrl: t('editor.previewImageUrl'),
    sortOrder: t('editor.sortOrder'),
    save: t('editor.save'),
    cancel: t('editor.cancel'),
    generate: t('editor.generate'),
    generating: t('editor.generating'),
    selectModel: t('editor.selectModel'),
    generatePreview: t('editor.generatePreview'),
    generatingPreview: t('editor.generatingPreview'),
    selectImageModel: t('editor.selectImageModel'),
  }), [t])

  if (isCreating || editingStyle) {
    return (
      <section className="glass-surface-elevated min-h-[620px] rounded-2xl">
        <div className="border-b border-[var(--glass-stroke-base)] px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-lg font-semibold text-[var(--glass-text-primary)]">
              {isCreating ? t('editor.createTitle') : t('editor.editTitle')}
            </h1>
            {error && (
              <p className="text-xs text-[var(--glass-tone-danger-fg)]">{error}</p>
            )}
          </div>
        </div>
        <ArtStyleEditor
          initialValues={editingStyle}
          labels={editorLabels}
          saving={saving}
          onSubmit={handleEditorSubmit}
          onCancel={handleEditorCancel}
          styleId={editingStyleId}
          generatePreviewApiPath={editingStyleId
            ? `/api/admin/config-center/art-styles/${editingStyleId}/generate-preview`
            : undefined
          }
        />
      </section>
    )
  }

  if (loading) {
    return (
      <section className="glass-surface-elevated flex min-h-[620px] items-center justify-center rounded-2xl">
        <div className="flex items-center gap-2 text-sm text-[var(--glass-text-secondary)]">
          <AppIcon name="loader" className="h-4 w-4 animate-spin" />
          {t('loading')}
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="glass-surface-elevated flex min-h-[620px] items-center justify-center rounded-2xl px-6">
        <div className="max-w-md text-center">
          <AppIcon name="alert" className="mx-auto mb-3 h-9 w-9 text-[var(--glass-tone-danger-fg)]" />
          <p className="break-words text-sm text-[var(--glass-text-secondary)]">{error}</p>
          <button
            type="button"
            onClick={() => void loadArtStyles()}
            className="glass-btn-base glass-btn-tone-info mt-4 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
          >
            <AppIcon name="refresh" className="h-4 w-4" />
            {t('retry')}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="glass-surface-elevated min-h-[620px] rounded-2xl">
      <div className="border-b border-[var(--glass-stroke-base)] px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-[var(--glass-text-primary)]">{t('title')}</h1>
            <span className="rounded-full border border-[var(--glass-stroke-base)] px-2 py-0.5 text-[11px] text-[var(--glass-text-tertiary)]">
              {t('total', { count: artStyles.length })}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-[var(--glass-text-secondary)]">
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as FilterStatus)}
                className="rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-2 py-2 text-xs text-[var(--glass-text-primary)] outline-none focus:border-[var(--glass-stroke-focus)]"
              >
                <option value="all">{t('filters.allStatuses')}</option>
                <option value="enabled">{t('filters.enabled')}</option>
                <option value="disabled">{t('filters.disabled')}</option>
              </select>
            </label>

            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('searchPlaceholder')}
              className="w-48 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-xs text-[var(--glass-text-primary)] outline-none focus:border-[var(--glass-stroke-focus)]"
            />

            <button
              type="button"
              onClick={() => {
                setIsCreating(true)
                setEditingStyleId(null)
              }}
              className="glass-btn-base glass-btn-tone-info flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
              disabled={saving}
            >
              <AppIcon name="plus" className="h-4 w-4" />
              {t('create')}
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {filteredArtStyles.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-[var(--glass-text-tertiary)]">
            {artStyles.length === 0 ? t('empty') : t('emptyFiltered')}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {/* Task 3 会填充卡片内容 */}
            {filteredArtStyles.map((style) => (
              <article
                key={style.id}
                className="grid min-h-52 grid-rows-[auto_1fr_auto] rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] p-4"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-base)]">
                    {style.previewImageUrl ? (
                      <img
                        src={style.previewImageUrl}
                        alt={style.name}
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none'
                        }}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[var(--glass-text-tertiary)]">
                        <AppIcon name="image" className="h-6 w-6" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="break-words text-sm font-semibold text-[var(--glass-text-primary)]">{style.name}</h3>
                      <span className={`rounded-full border border-[var(--glass-stroke-base)] px-2 py-0.5 text-[11px] ${style.enabled
                        ? 'bg-[var(--glass-tone-success-bg)] text-[var(--glass-tone-success-fg)]'
                        : 'text-[var(--glass-text-tertiary)]'
                      }`}>
                        {style.enabled ? t('status.enabled') : t('status.disabled')}
                      </span>
                    </div>
                    <p className="mt-1 break-words text-xs leading-5 text-[var(--glass-text-secondary)]">
                      {style.description || t('noDescription')}
                    </p>
                  </div>
                </div>

                <p className="mt-4 line-clamp-4 break-words text-sm leading-6 text-[var(--glass-text-primary)]">
                  {style.prompt}
                </p>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-xs text-[var(--glass-text-tertiary)]">{t('sortOrder', { value: style.sortOrder })}</span>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleToggleEnabled(style)}
                      className="glass-btn-base rounded-xl p-2"
                      disabled={saving || togglingStyleId === style.id || deletingStyleId === style.id}
                      aria-label={style.enabled ? t('actions.disable') : t('actions.enable')}
                    >
                      <AppIcon name={togglingStyleId === style.id ? 'loader' : (style.enabled ? 'pause' : 'play')} className={`h-4 w-4 ${togglingStyleId === style.id ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEditStart(style.id)}
                      className="glass-btn-base rounded-xl p-2"
                      disabled={saving || togglingStyleId === style.id || deletingStyleId === style.id}
                      aria-label={t('actions.edit')}
                    >
                      <AppIcon name="edit" className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(style)}
                      className="glass-btn-base glass-btn-tone-danger rounded-xl p-2"
                      disabled={saving || togglingStyleId === style.id || deletingStyleId === style.id}
                      aria-label={t('actions.delete')}
                    >
                      <AppIcon name={deletingStyleId === style.id ? 'loader' : 'trash'} className={`h-4 w-4 ${deletingStyleId === style.id ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
