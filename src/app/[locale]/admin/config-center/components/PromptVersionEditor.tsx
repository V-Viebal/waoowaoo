'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type { PromptDefinition, PromptLocale, PromptVersion } from './PromptLibraryPanel'

interface PromptVersionEditorProps {
  prompt: PromptDefinition
  variableKeys: string[]
  onChanged: () => Promise<void>
}

type VersionAction = 'publish' | 'disable'

function formatDate(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

function sortVersions(versions: PromptVersion[]) {
  return [...versions].sort((a, b) => {
    if (a.locale !== b.locale) return a.locale.localeCompare(b.locale)
    return b.version - a.version
  })
}

export default function PromptVersionEditor({ prompt, variableKeys, onChanged }: PromptVersionEditorProps) {
  const t = useTranslations('configCenter')
  const versions = useMemo(() => sortVersions(prompt.versions), [prompt.versions])
  const [draftLocale, setDraftLocale] = useState<PromptLocale>('zh')
  const [draftContent, setDraftContent] = useState('')
  const [changeNote, setChangeNote] = useState('')
  const [savingDraft, setSavingDraft] = useState(false)
  const [versionAction, setVersionAction] = useState<string | null>(null)
  const [overrideVersionId, setOverrideVersionId] = useState('')
  const [overrideProjectId, setOverrideProjectId] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [savingOverride, setSavingOverride] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const latestForDraftLocale = useMemo(
    () => versions.find((version) => version.locale === draftLocale),
    [draftLocale, versions],
  )

  useEffect(() => {
    setDraftContent(latestForDraftLocale?.content ?? '')
    setChangeNote('')
  }, [latestForDraftLocale?.content, latestForDraftLocale?.id, prompt.promptId])

  useEffect(() => {
    const preferred = versions.find((version) => version.status === 'published') ?? versions[0]
    setOverrideVersionId(preferred?.id ?? '')
    setOverrideProjectId('')
    setOverrideReason('')
    setMessage(null)
    setError(null)
  }, [prompt.promptId, versions])

  const selectedOverrideVersion = versions.find((version) => version.id === overrideVersionId) ?? null

  async function handleCreateDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    setError(null)
    if (!draftContent.trim()) {
      setError(t('errors.emptyContent'))
      return
    }

    setSavingDraft(true)
    try {
      const response = await apiFetch(`/api/admin/config-center/prompts/${encodeURIComponent(prompt.promptId)}/versions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          locale: draftLocale,
          content: draftContent,
          changeNote: changeNote.trim() || undefined,
        }),
      })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, t('errors.createFailed')))
      }
      setMessage(t('messages.draftCreated'))
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.createFailed'))
    } finally {
      setSavingDraft(false)
    }
  }

  async function handleVersionAction(version: PromptVersion, action: VersionAction) {
    setMessage(null)
    setError(null)
    setVersionAction(`${version.id}:${action}`)
    try {
      const response = await apiFetch(
        `/api/admin/config-center/prompts/${encodeURIComponent(prompt.promptId)}/versions/${encodeURIComponent(version.id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      )
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, t('errors.actionFailed')))
      }
      setMessage(action === 'publish' ? t('messages.published') : t('messages.disabled'))
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.actionFailed'))
    } finally {
      setVersionAction(null)
    }
  }

  async function handleOverrideSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    setError(null)
    if (!overrideProjectId.trim() || !selectedOverrideVersion) {
      setError(t('errors.overrideRequired'))
      return
    }

    setSavingOverride(true)
    try {
      const response = await apiFetch(
        `/api/admin/config-center/projects/${encodeURIComponent(overrideProjectId.trim())}/prompt-overrides`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            promptDefinitionId: prompt.id,
            promptVersionId: selectedOverrideVersion.id,
            locale: selectedOverrideVersion.locale,
            reason: overrideReason.trim() || undefined,
          }),
        },
      )
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, t('errors.overrideFailed')))
      }
      setMessage(t('messages.overrideSaved'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.overrideFailed'))
    } finally {
      setSavingOverride(false)
    }
  }

  return (
    <div className="glass-surface-elevated flex h-[calc(100vh-116px)] min-h-[620px] min-w-0 flex-col overflow-hidden rounded-2xl">
      <header className="border-b border-[var(--glass-stroke-base)] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-[var(--glass-text-primary)]">{prompt.name}</h2>
              <span className="rounded-full border border-[var(--glass-stroke-base)] px-2 py-0.5 text-[11px] text-[var(--glass-text-secondary)]">
                {prompt.category}
              </span>
            </div>
            <p className="mt-1 break-all text-xs text-[var(--glass-text-tertiary)]">{prompt.promptId}</p>
          </div>
          <div className="flex max-w-full flex-wrap gap-1.5">
            {variableKeys.length > 0 ? variableKeys.map((key) => (
              <span
                key={key}
                className="rounded-full bg-[var(--glass-bg-muted)] px-2 py-1 text-[11px] font-medium text-[var(--glass-text-secondary)]"
              >
                {`{${key}}`}
              </span>
            )) : (
              <span className="rounded-full bg-[var(--glass-bg-muted)] px-2 py-1 text-[11px] text-[var(--glass-text-tertiary)]">
                {t('variables.none')}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {message ? (
          <div className="mb-4 rounded-xl border border-[var(--glass-stroke-success)] bg-[var(--glass-tone-success-bg)] px-3 py-2 text-sm text-[var(--glass-tone-success-fg)]">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mb-4 rounded-xl border border-[var(--glass-stroke-danger)] bg-[var(--glass-tone-danger-bg)] px-3 py-2 text-sm text-[var(--glass-tone-danger-fg)]">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0 rounded-xl border border-[var(--glass-stroke-base)]">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--glass-stroke-base)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('versions.title')}</h3>
              <span className="text-xs text-[var(--glass-text-tertiary)]">{t('versions.count', { count: versions.length })}</span>
            </div>
            <div className="divide-y divide-[var(--glass-stroke-base)]">
              {versions.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-[var(--glass-text-tertiary)]">{t('versions.empty')}</div>
              ) : versions.map((version) => {
                const busyPublish = versionAction === `${version.id}:publish`
                const busyDisable = versionAction === `${version.id}:disable`
                return (
                  <div key={version.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--glass-text-primary)]">
                          {t('versions.versionLabel', { version: version.version, locale: t(`locales.${version.locale}`) })}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${version.status === 'published'
                          ? 'bg-[var(--glass-tone-success-bg)] text-[var(--glass-tone-success-fg)]'
                          : version.status === 'draft'
                            ? 'bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]'
                            : 'bg-[var(--glass-bg-muted)] text-[var(--glass-text-tertiary)]'
                        }`}
                        >
                          {t(`status.${version.status}`)}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-[var(--glass-text-tertiary)]">
                        {version.changeNote || t('versions.noChangeNote')}
                      </p>
                      <p className="mt-1 text-[11px] text-[var(--glass-text-tertiary)]">
                        {t('versions.updatedAt', { value: formatDate(version.updatedAt) })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 md:justify-end">
                      <button
                        type="button"
                        onClick={() => void handleVersionAction(version, 'publish')}
                        disabled={busyPublish || version.status === 'published'}
                        className="glass-btn-base glass-btn-tone-success inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <AppIcon name={busyPublish ? 'loader' : 'upload'} className={`h-3.5 w-3.5 ${busyPublish ? 'animate-spin' : ''}`} />
                        {t('actions.publish')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleVersionAction(version, 'disable')}
                        disabled={busyDisable || version.status === 'disabled'}
                        className="glass-btn-base glass-btn-tone-danger inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <AppIcon name={busyDisable ? 'loader' : 'close'} className={`h-3.5 w-3.5 ${busyDisable ? 'animate-spin' : ''}`} />
                        {t('actions.disable')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <form onSubmit={handleOverrideSubmit} className="rounded-xl border border-[var(--glass-stroke-base)] p-4">
            <h3 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('override.title')}</h3>
            <div className="mt-3 space-y-3">
              <label className="block text-xs font-medium text-[var(--glass-text-secondary)]">
                <span className="mb-1 block">{t('override.projectId')}</span>
                <input
                  value={overrideProjectId}
                  onChange={(event) => setOverrideProjectId(event.target.value)}
                  className="w-full rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-sm text-[var(--glass-text-primary)] outline-none focus:border-[var(--glass-stroke-focus)]"
                />
              </label>
              <label className="block text-xs font-medium text-[var(--glass-text-secondary)]">
                <span className="mb-1 block">{t('override.version')}</span>
                <select
                  value={overrideVersionId}
                  onChange={(event) => setOverrideVersionId(event.target.value)}
                  className="w-full rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-sm text-[var(--glass-text-primary)] outline-none focus:border-[var(--glass-stroke-focus)]"
                >
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {t('versions.versionLabel', { version: version.version, locale: t(`locales.${version.locale}`) })} · {t(`status.${version.status}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-[var(--glass-text-secondary)]">
                <span className="mb-1 block">{t('override.reason')}</span>
                <textarea
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-sm text-[var(--glass-text-primary)] outline-none focus:border-[var(--glass-stroke-focus)]"
                />
              </label>
              <button
                type="submit"
                disabled={savingOverride || versions.length === 0}
                className="glass-btn-base glass-btn-tone-info inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon name={savingOverride ? 'loader' : 'bookmark'} className={`h-4 w-4 ${savingOverride ? 'animate-spin' : ''}`} />
                {t('actions.saveOverride')}
              </button>
            </div>
          </form>
        </div>

        <form onSubmit={handleCreateDraft} className="mt-4 rounded-xl border border-[var(--glass-stroke-base)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--glass-stroke-base)] px-4 py-3">
            <h3 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('draft.title')}</h3>
            <div className="inline-flex rounded-lg border border-[var(--glass-stroke-base)] p-1">
              {(['zh', 'en'] as PromptLocale[]).map((locale) => (
                <button
                  key={locale}
                  type="button"
                  onClick={() => setDraftLocale(locale)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${draftLocale === locale
                    ? 'bg-[var(--glass-bg-muted)] text-[var(--glass-text-primary)]'
                    : 'text-[var(--glass-text-secondary)] hover:text-[var(--glass-text-primary)]'
                  }`}
                >
                  {t(`locales.${locale}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 p-4">
            <label className="block text-xs font-medium text-[var(--glass-text-secondary)]">
              <span className="mb-1 block">{t('draft.changeNote')}</span>
              <input
                value={changeNote}
                onChange={(event) => setChangeNote(event.target.value)}
                className="w-full rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-sm text-[var(--glass-text-primary)] outline-none focus:border-[var(--glass-stroke-focus)]"
              />
            </label>
            <label className="block text-xs font-medium text-[var(--glass-text-secondary)]">
              <span className="mb-1 block">{t('draft.content')}</span>
              <textarea
                value={draftContent}
                onChange={(event) => setDraftContent(event.target.value)}
                spellCheck={false}
                className="min-h-[280px] w-full resize-y rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-3 font-mono text-xs leading-5 text-[var(--glass-text-primary)] outline-none focus:border-[var(--glass-stroke-focus)]"
              />
            </label>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingDraft}
                className="glass-btn-base glass-btn-tone-info inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon name={savingDraft ? 'loader' : 'plus'} className={`h-4 w-4 ${savingDraft ? 'animate-spin' : ''}`} />
                {t('actions.createDraft')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
