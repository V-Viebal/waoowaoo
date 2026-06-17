'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import PromptVersionEditor from './PromptVersionEditor'

export type PromptVersionStatus = 'draft' | 'published' | 'disabled'
export type PromptLocale = 'zh' | 'en'

export interface PromptVersion {
  id: string
  promptDefinitionId: string
  locale: PromptLocale
  version: number
  status: PromptVersionStatus
  content: string
  createdByUserId: string | null
  publishedByUserId: string | null
  publishedAt: string | null
  disabledAt: string | null
  changeNote: string | null
  createdAt: string
  updatedAt: string
}

export interface PromptDefinition {
  id: string
  promptId: string
  pathStem: string
  category: string
  name: string
  description: string | null
  variableKeys: string | string[]
  isRegistered: boolean
  versions: PromptVersion[]
}

type StatusFilter = 'all' | PromptVersionStatus
type LocaleFilter = 'all' | PromptLocale

function parseVariableKeys(value: PromptDefinition['variableKeys']): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function getStatusCounts(versions: PromptVersion[]) {
  return versions.reduce(
    (counts, version) => {
      counts[version.status] += 1
      return counts
    },
    { draft: 0, published: 0, disabled: 0 },
  )
}

function promptMatchesFilters(prompt: PromptDefinition, locale: LocaleFilter, status: StatusFilter) {
  if (locale === 'all' && status === 'all') return true
  return prompt.versions.some((version) => {
    const localeMatches = locale === 'all' || version.locale === locale
    const statusMatches = status === 'all' || version.status === status
    return localeMatches && statusMatches
  })
}

export default function PromptLibraryPanel() {
  const t = useTranslations('configCenter')
  const [prompts, setPrompts] = useState<PromptDefinition[]>([])
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [localeFilter, setLocaleFilter] = useState<LocaleFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadPrompts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch('/api/admin/config-center/prompts')
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, t('errors.loadFailed')))
      }
      const payload: unknown = await response.json()
      const nextPrompts = Array.isArray((payload as { prompts?: unknown }).prompts)
        ? ((payload as { prompts: PromptDefinition[] }).prompts)
        : []
      setPrompts(nextPrompts)
      setSelectedPromptId((current) => current ?? nextPrompts[0]?.promptId ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadPrompts()
  }, [loadPrompts])

  const filteredPrompts = useMemo(
    () => prompts.filter((prompt) => promptMatchesFilters(prompt, localeFilter, statusFilter)),
    [localeFilter, prompts, statusFilter],
  )

  const selectedPrompt = useMemo(() => {
    return filteredPrompts.find((prompt) => prompt.promptId === selectedPromptId) ?? filteredPrompts[0] ?? null
  }, [filteredPrompts, selectedPromptId])

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
            onClick={() => void loadPrompts()}
            className="glass-btn-base glass-btn-tone-info mt-4 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
          >
            <AppIcon name="refresh" className="h-4 w-4" />
            {t('actions.retry')}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="grid min-h-[620px] gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="glass-surface-elevated flex h-[calc(100vh-116px)] min-h-[620px] flex-col overflow-hidden rounded-2xl">
        <div className="border-b border-[var(--glass-stroke-base)] px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-[var(--glass-text-primary)]">{t('title')}</h1>
              <p className="mt-1 text-xs text-[var(--glass-text-tertiary)]">{t('promptCount', { count: prompts.length })}</p>
            </div>
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--glass-stroke-base)] text-[var(--glass-tone-info-fg)]">
              <AppIcon name="settingsHex" className="h-4 w-4" />
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <label className="min-w-0 text-xs font-medium text-[var(--glass-text-secondary)]">
              <span className="mb-1 block">{t('filters.locale')}</span>
              <select
                value={localeFilter}
                onChange={(event) => setLocaleFilter(event.target.value as LocaleFilter)}
                className="w-full rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-2 py-2 text-xs text-[var(--glass-text-primary)] outline-none focus:border-[var(--glass-stroke-focus)]"
              >
                <option value="all">{t('filters.allLocales')}</option>
                <option value="zh">{t('locales.zh')}</option>
                <option value="en">{t('locales.en')}</option>
              </select>
            </label>
            <label className="min-w-0 text-xs font-medium text-[var(--glass-text-secondary)]">
              <span className="mb-1 block">{t('filters.status')}</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                className="w-full rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-2 py-2 text-xs text-[var(--glass-text-primary)] outline-none focus:border-[var(--glass-stroke-focus)]"
              >
                <option value="all">{t('filters.allStatuses')}</option>
                <option value="published">{t('status.published')}</option>
                <option value="draft">{t('status.draft')}</option>
                <option value="disabled">{t('status.disabled')}</option>
              </select>
            </label>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {filteredPrompts.length === 0 ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-sm text-[var(--glass-text-tertiary)]">
              {t('empty.filtered')}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredPrompts.map((prompt) => {
                const counts = getStatusCounts(prompt.versions)
                const active = prompt.promptId === selectedPrompt?.promptId
                return (
                  <button
                    key={prompt.id}
                    type="button"
                    onClick={() => setSelectedPromptId(prompt.promptId)}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${active
                      ? 'border-[var(--glass-stroke-focus)] bg-[var(--glass-bg-muted)]'
                      : 'border-[var(--glass-stroke-base)] bg-transparent hover:bg-[var(--glass-bg-muted)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--glass-text-primary)]">{prompt.name}</p>
                        <p className="mt-1 truncate text-[11px] text-[var(--glass-text-tertiary)]">{prompt.promptId}</p>
                      </div>
                      <span className="shrink-0 rounded-full border border-[var(--glass-stroke-base)] px-2 py-0.5 text-[10px] text-[var(--glass-text-secondary)]">
                        {prompt.category}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-medium">
                      <span className="rounded-full bg-[var(--glass-tone-success-bg)] px-2 py-0.5 text-[var(--glass-tone-success-fg)]">
                        {t('statusCount.published', { count: counts.published })}
                      </span>
                      <span className="rounded-full bg-[var(--glass-tone-info-bg)] px-2 py-0.5 text-[var(--glass-tone-info-fg)]">
                        {t('statusCount.draft', { count: counts.draft })}
                      </span>
                      <span className="rounded-full bg-[var(--glass-bg-muted)] px-2 py-0.5 text-[var(--glass-text-tertiary)]">
                        {t('statusCount.disabled', { count: counts.disabled })}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </aside>

      <div className="min-w-0">
        {selectedPrompt ? (
          <PromptVersionEditor
            prompt={selectedPrompt}
            variableKeys={parseVariableKeys(selectedPrompt.variableKeys)}
            onChanged={loadPrompts}
          />
        ) : (
          <div className="glass-surface-elevated flex h-[calc(100vh-116px)] min-h-[620px] items-center justify-center rounded-2xl px-6 text-center text-sm text-[var(--glass-text-tertiary)]">
            {prompts.length === 0 ? t('empty.prompts') : t('empty.filtered')}
          </div>
        )}
      </div>
    </section>
  )
}
