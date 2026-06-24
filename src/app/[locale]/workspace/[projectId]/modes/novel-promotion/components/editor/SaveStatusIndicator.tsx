'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { useEditorStageRuntime } from '@/lib/novel-promotion/stages/editor-stage-runtime-core'

export function SaveStatusIndicator() {
  const t = useTranslations('novelPromotion.editor.saveStatus')
  const {
    projectStatus,
    isSaving,
    hasConflict,
    lastSavedAt,
    saveError,
    reloadProject,
    forceSave,
  } = useEditorStageRuntime()

  const statusText = useMemo(() => {
    if (hasConflict) return t('conflict')
    if (isSaving || projectStatus === 'saving') return t('saving')
    if (projectStatus === 'loading') return t('loading')
    if (projectStatus === 'error') return t('error')
    if (projectStatus === 'saved') {
      return lastSavedAt ? t('savedAt', { time: formatTime(lastSavedAt) }) : t('saved')
    }
    return t('idle')
  }, [hasConflict, isSaving, lastSavedAt, projectStatus, t])

  if (hasConflict || projectStatus === 'conflict') {
    return (
      <div className="flex items-center gap-2 text-xs text-amber-600">
        <span>{t('conflictDescription')}</span>
        <button
          type="button"
          onClick={() => { void reloadProject() }}
          className="rounded-lg border border-amber-300/70 px-2 py-1 font-medium hover:bg-amber-50"
        >
          {t('reload')}
        </button>
        <button
          type="button"
          onClick={forceSave}
          className="rounded-lg bg-amber-500 px-2 py-1 font-medium text-white hover:bg-amber-600"
        >
          {t('forceSave')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 text-xs text-[var(--glass-text-tertiary)]" title={saveError || statusText}>
      <span className={statusDotClass(projectStatus, isSaving)} />
      <span>{statusText}</span>
    </div>
  )
}

function statusDotClass(status: string, isSaving: boolean): string {
  const base = 'h-2 w-2 rounded-full'
  if (isSaving || status === 'saving' || status === 'loading') return `${base} animate-pulse bg-sky-500`
  if (status === 'error') return `${base} bg-red-500`
  if (status === 'saved') return `${base} bg-emerald-500`
  return `${base} bg-slate-300`
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
