'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api-fetch'
import { AppIcon } from '@/components/ui/icons'
import { ArtStyleEditor, type ArtStyleEditorValues } from './art-style-library/ArtStyleEditor'

type ArtStyleScope = 'system' | 'user'

type ArtStyle = {
  id: string
  scope: ArtStyleScope
  ownerUserId: string | null
  name: string
  description: string | null
  prompt: string
  previewImageUrl: string | null
  sortOrder: number
  enabled: boolean
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

export default function ArtStyleLibraryTab() {
  const t = useTranslations('profile.artStyleLibraryTab')
  const [artStyles, setArtStyles] = useState<ArtStyle[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [editingStyleId, setEditingStyleId] = useState<string | null>(null)

  const editorLabels = useMemo(() => ({
    name: t('name'),
    description: t('description'),
    prompt: t('prompt'),
    previewImageUrl: t('previewImageUrl'),
    sortOrder: t('sortOrder'),
    save: t('save'),
    cancel: t('cancel'),
  }), [t])

  const systemStyles = useMemo(
    () => artStyles.filter((style) => style.scope === 'system'),
    [artStyles],
  )
  const userStyles = useMemo(
    () => artStyles.filter((style) => style.scope === 'user'),
    [artStyles],
  )
  const editingStyle = useMemo(
    () => artStyles.find((style) => style.id === editingStyleId) || null,
    [artStyles, editingStyleId],
  )
  const editingValues = useMemo(
    () => (editingStyle ? buildEditorValues(editingStyle) : undefined),
    [editingStyle],
  )

  const loadArtStyles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch('/api/art-styles')
      if (!response.ok) throw new Error(t('loadFailed'))
      const data = await response.json() as { artStyles?: ArtStyle[] }
      setArtStyles(data.artStyles || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadArtStyles()
  }, [loadArtStyles])

  const handleCreate = async (values: ArtStyleEditorValues) => {
    setSaving(true)
    setError(null)
    try {
      const response = await apiFetch('/api/art-styles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!response.ok) throw new Error(t('saveFailed'))
      const data = await response.json() as { artStyle: ArtStyle }
      setArtStyles((current) => [...current, data.artStyle])
      setIsCreating(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async (values: ArtStyleEditorValues) => {
    if (!editingStyleId) return
    setSaving(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/art-styles/${editingStyleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!response.ok) throw new Error(t('saveFailed'))
      const data = await response.json() as { artStyle: ArtStyle }
      setArtStyles((current) => current.map((style) => style.id === data.artStyle.id ? data.artStyle : style))
      setEditingStyleId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (styleId: string) => {
    if (!window.confirm(t('deleteConfirm'))) return
    setSaving(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/art-styles/${styleId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(t('saveFailed'))
      setArtStyles((current) => current.filter((style) => style.id !== styleId))
      if (editingStyleId === styleId) setEditingStyleId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const renderStyleCard = (style: ArtStyle) => {
    const isUserStyle = style.scope === 'user'
    return (
      <article
        key={style.id}
        className="grid min-h-52 grid-rows-[auto_1fr_auto] rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] p-4"
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-base)]">
            {style.previewImageUrl ? (
              // 预览图来自用户或管理员配置，失败时保留兜底图标区域，不影响画风文本可读性。
              <img
                src={style.previewImageUrl}
                alt={t('previewAlt', { name: style.name })}
                className="h-full w-full object-cover"
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
              <span className="rounded-full border border-[var(--glass-stroke-base)] px-2 py-0.5 text-[11px] text-[var(--glass-text-tertiary)]">
                {isUserStyle ? t('userScope') : t('systemScope')}
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
          <span className="text-xs text-[var(--glass-text-tertiary)]">{t('sortOrderValue', { value: style.sortOrder })}</span>
          {isUserStyle ? (
            <div className="flex flex-shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingStyleId(style.id)
                  setIsCreating(false)
                }}
                className="glass-btn-base rounded-xl p-2"
                disabled={saving}
                aria-label={t('edit')}
              >
                <AppIcon name="edit" className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(style.id)}
                className="glass-btn-base glass-btn-tone-danger rounded-xl p-2"
                disabled={saving}
                aria-label={t('delete')}
              >
                <AppIcon name="trash" className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </div>
      </article>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--glass-stroke-base)] p-5">
        <div>
          <h2 className="text-lg font-semibold text-[var(--glass-text-primary)]">{t('title')}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadArtStyles()}
            className="glass-btn-base rounded-xl p-2"
            disabled={loading || saving}
            aria-label={t('refresh')}
          >
            <AppIcon name="refresh" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => {
              setIsCreating(true)
              setEditingStyleId(null)
            }}
            className="glass-btn-base glass-btn-tone-info flex items-center gap-2 rounded-xl px-4 py-2 text-sm"
            disabled={saving}
          >
            <AppIcon name="plus" className="h-4 w-4" />
            {t('create')}
          </button>
        </div>
      </div>

      {error ? (
        <div className="border-b border-[var(--glass-tone-danger-border)] bg-[var(--glass-tone-danger-bg)] px-5 py-3 text-sm text-[var(--glass-tone-danger-fg)]">
          {error}
        </div>
      ) : null}

      {isCreating ? (
        <ArtStyleEditor
          labels={editorLabels}
          saving={saving}
          onSubmit={handleCreate}
          onCancel={() => setIsCreating(false)}
        />
      ) : null}

      {editingStyle ? (
        <ArtStyleEditor
          initialValues={editingValues}
          labels={editorLabels}
          saving={saving}
          onSubmit={handleUpdate}
          onCancel={() => setEditingStyleId(null)}
        />
      ) : null}

      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="flex h-full items-center justify-center text-[var(--glass-text-tertiary)]">{t('loading')}</div>
        ) : (
          <div className="space-y-6">
            <section>
              <h3 className="mb-3 text-sm font-semibold text-[var(--glass-text-primary)]">{t('systemStyles')}</h3>
              <div className="grid gap-4 xl:grid-cols-2">
                {systemStyles.map(renderStyleCard)}
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold text-[var(--glass-text-primary)]">{t('userStyles')}</h3>
              {userStyles.length > 0 ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  {userStyles.map(renderStyleCard)}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--glass-stroke-base)] px-4 py-8 text-center text-sm text-[var(--glass-text-secondary)]">
                  {t('emptyUserStyles')}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
