'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useTimelineContext } from '@twick/timeline'
import { apiFetch } from '@/lib/api-fetch'
import { queryKeys } from '@/lib/query/keys'
import { useTaskStatus } from '@/lib/query/hooks/useTaskStatus'
import { useEditorStageRuntime } from '@/lib/novel-promotion/stages/editor-stage-runtime-core'
import { TASK_EVENT_TYPE, TASK_TYPE, type SSEEvent } from '@/lib/task/types'
import type { TwickTimelineElement } from '@/lib/twick/types'
import { useWorkspaceProvider } from '../../../../WorkspaceProvider'
import { AiCard } from './AiCard'

type EnhanceResponse = {
  data?: {
    taskId?: string
  }
}

type SelectedVideoClip = {
  elementId: string
  panelId: string | null
  durationSeconds: number
}

type EnhanceMode = 'smart_crop' | 'restore'

function readErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (typeof record.message === 'string') return record.message
    if (typeof record.errorMessage === 'string') return record.errorMessage
    if (typeof record.error === 'string') return record.error
  }
  return fallback
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getSelectedElementId(selectedItem: unknown): string | null {
  if (!selectedItem || typeof selectedItem !== 'object') return null
  const maybeGetId = (selectedItem as { getId?: unknown }).getId
  if (typeof maybeGetId === 'function') {
    const id = maybeGetId.call(selectedItem)
    return readString(id)
  }
  return readString((selectedItem as { id?: unknown }).id)
}

function findSelectedVideoClip(params: {
  selectedElementId: string | null
  present: { tracks?: Array<{ elements?: TwickTimelineElement[] }> } | null
}): SelectedVideoClip | null {
  if (!params.selectedElementId || !params.present?.tracks) return null
  for (const track of params.present.tracks) {
    const elements = Array.isArray(track.elements) ? track.elements : []
    for (const element of elements) {
      if (element.id !== params.selectedElementId || element.type !== 'video') continue
      const metadata = element.metadata && typeof element.metadata === 'object'
        ? element.metadata as Record<string, unknown>
        : {}
      const start = readNumber(element.s) ?? 0
      const end = readNumber(element.e) ?? start
      return {
        elementId: element.id,
        panelId: readString(metadata.panelId),
        durationSeconds: Math.max(1, end - start || 1),
      }
    }
  }
  return null
}

export function EnhancePanel() {
  const t = useTranslations('novelPromotion.editor.rightPanel.ai')
  const queryClient = useQueryClient()
  const { projectId, episodeId, subscribeTaskEvents } = useWorkspaceProvider()
  const { present, selectedItem } = useTimelineContext()
  const {
    editorProjectId,
    isLoadingData,
    isLoadingProject,
    reloadProject,
    flushProjectSave,
  } = useEditorStageRuntime()
  const [submittedTaskId, setSubmittedTaskId] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [mode, setMode] = useState<EnhanceMode>('smart_crop')
  const [targetAspectRatio, setTargetAspectRatio] = useState('9:16')
  const [anchor, setAnchor] = useState('center')
  const completedTaskIdsRef = useRef(new Set<string>())

  const selectedElementId = getSelectedElementId(selectedItem)
  const selectedVideoClip = useMemo(() => findSelectedVideoClip({
    selectedElementId,
    present,
  }), [present, selectedElementId])

  useEffect(() => {
    setLocalError(null)
  }, [selectedVideoClip?.elementId, mode])

  const taskStatus = useTaskStatus({
    projectId,
    targetType: 'NovelPromotionEditorProject',
    targetId: editorProjectId,
    type: [TASK_TYPE.EDITOR_AI_ENHANCE],
    enabled: !!projectId && !!editorProjectId,
    refetchInterval: submittedTaskId ? 2500 : false,
  })

  const handleCompletedTask = useCallback(async (taskId: string) => {
    if (completedTaskIdsRef.current.has(taskId)) return
    completedTaskIdsRef.current.add(taskId)
    setLocalError(null)
    setSubmittedTaskId((current) => (current === taskId ? null : current))
    await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId) })
    await reloadProject()
  }, [projectId, queryClient, reloadProject])

  const mutation = useMutation({
    mutationFn: async () => {
      if (!episodeId || !editorProjectId || !selectedVideoClip) throw new Error(t('enhance.missingContext'))
      if (mode === 'restore') throw new Error('ENHANCE_RESTORE_PROVIDER_UNAVAILABLE')
      setLocalError(null)
      await flushProjectSave()
      const durationSeconds = Math.max(1, Math.ceil(selectedVideoClip.durationSeconds))
      const res = await apiFetch(`/api/novel-promotion/${projectId}/editor/ai/enhance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId,
          editorProjectId,
          selectedElementId: selectedVideoClip.elementId,
          enhanceType: mode,
          targetAspectRatio,
          anchor,
          durationSeconds,
          requestId: `enhance:${editorProjectId}:${selectedVideoClip.elementId}:${mode}:${Date.now()}`,
        }),
      })
      const json = await res.json().catch(() => ({})) as EnhanceResponse & Record<string, unknown>
      if (!res.ok) {
        throw new Error(readErrorMessage(json, t('enhance.failed')))
      }
      const taskId = json.data?.taskId
      if (typeof taskId === 'string' && taskId) setSubmittedTaskId(taskId)
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId) })
      return json
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : null
      if (message === 'conflict') {
        setLocalError(t('enhance.saveConflict'))
      } else if (message === 'unsaved-changes') {
        setLocalError(t('enhance.unsavedChanges'))
      } else if (message === 'ENHANCE_VIDEO_ELEMENT_NOT_FOUND') {
        setLocalError(t('enhance.videoElementNotFound'))
      } else if (message === 'ENHANCE_RESTORE_PROVIDER_UNAVAILABLE') {
        setLocalError(t('enhance.restoreUnavailable'))
      } else {
        setLocalError(message || t('enhance.failed'))
      }
    },
  })

  const latestTask = taskStatus.data.latest
  const activeTask = taskStatus.data.active.find((task) => task.id === submittedTaskId)
    || taskStatus.data.active[0]
    || null
  const progress = activeTask?.progress ?? latestTask?.progress ?? null
  const isRunning = !!activeTask || mutation.isPending

  const disabledReason = useMemo(() => {
    if (!episodeId || !editorProjectId) return t('enhance.missingContext')
    if (isLoadingData || isLoadingProject) return t('enhance.loading')
    if (!selectedVideoClip) return t('enhance.selectVideo')
    if (mode === 'restore') return t('enhance.restoreUnavailable')
    return null
  }, [editorProjectId, episodeId, isLoadingData, isLoadingProject, mode, selectedVideoClip, t])

  useEffect(() => {
    if (!submittedTaskId) return
    return subscribeTaskEvents((event: SSEEvent) => {
      if (event.taskId !== submittedTaskId) return
      const payload = event.payload && typeof event.payload === 'object'
        ? event.payload as Record<string, unknown>
        : null
      const lifecycleType = typeof payload?.lifecycleType === 'string' ? payload.lifecycleType : null
      if (lifecycleType === TASK_EVENT_TYPE.COMPLETED) {
        void handleCompletedTask(submittedTaskId)
      } else if (lifecycleType === TASK_EVENT_TYPE.FAILED) {
        setSubmittedTaskId(null)
        setLocalError(readErrorMessage(payload?.error || payload, t('enhance.failed')))
      }
    })
  }, [handleCompletedTask, submittedTaskId, subscribeTaskEvents, t])

  useEffect(() => {
    if (!submittedTaskId) return
    if (latestTask?.id !== submittedTaskId) return
    if (latestTask.status === 'completed') {
      void handleCompletedTask(submittedTaskId)
    } else if (latestTask.status === 'failed' || latestTask.status === 'canceled') {
      setSubmittedTaskId(null)
      setLocalError(latestTask.error?.message || latestTask.errorMessage || t('enhance.failed'))
    }
  }, [handleCompletedTask, latestTask, submittedTaskId, t])

  const canRun = !disabledReason && !isRunning
  const statusText = isRunning
    ? t('enhance.running', { progress: typeof progress === 'number' ? progress : 0 })
    : localError
      ? localError
      : latestTask?.status === 'completed'
        ? t('enhance.done')
        : disabledReason

  return (
    <AiCard
      tone="emerald"
      icon="sparkles"
      title={t('enhance.title')}
      description={t('enhance.description')}
      status={statusText || null}
      isError={!!localError}
      actionLabel={isRunning ? t('enhance.runningButton') : t('enhance.button')}
      onAction={() => { void mutation.mutateAsync() }}
      disabled={!canRun}
      running={isRunning}
    >
      <div className="rounded-xl bg-white/70 p-2 ring-1 ring-inset ring-slate-100">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode('smart_crop')}
            disabled={isRunning}
            className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition ${mode === 'smart_crop' ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300'}`}
          >
            {t('enhance.smartCrop')}
          </button>
          <button
            type="button"
            onClick={() => setMode('restore')}
            disabled
            title={t('enhance.restoreUnavailable')}
            className="cursor-not-allowed rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-400 opacity-60"
          >
            {t('enhance.restore')}
          </button>
        </div>
        {mode === 'smart_crop' ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block text-[11px] font-medium text-slate-600">
              {t('enhance.ratioLabel')}
              <select
                value={targetAspectRatio}
                onChange={(event) => setTargetAspectRatio(event.target.value)}
                disabled={isRunning}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200/50 disabled:bg-slate-100"
              >
                <option value="9:16">9:16</option>
                <option value="16:9">16:9</option>
                <option value="1:1">1:1</option>
                <option value="4:5">4:5</option>
              </select>
            </label>
            <label className="block text-[11px] font-medium text-slate-600">
              {t('enhance.anchorLabel')}
              <select
                value={anchor}
                onChange={(event) => setAnchor(event.target.value)}
                disabled={isRunning}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200/50 disabled:bg-slate-100"
              >
                <option value="center">{t('enhance.anchorCenter')}</option>
                <option value="top">{t('enhance.anchorTop')}</option>
                <option value="bottom">{t('enhance.anchorBottom')}</option>
                <option value="left">{t('enhance.anchorLeft')}</option>
                <option value="right">{t('enhance.anchorRight')}</option>
              </select>
            </label>
          </div>
        ) : (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] leading-4 text-amber-700">
            {t('enhance.restoreUnavailable')}
          </div>
        )}
        {selectedVideoClip ? (
          <div className="mt-2 text-[10px] text-slate-400">
            {t('enhance.selected', { id: selectedVideoClip.panelId || selectedVideoClip.elementId, seconds: selectedVideoClip.durationSeconds.toFixed(1) })}
          </div>
        ) : null}
      </div>
      <div className="mt-2 text-[10px] leading-4 text-slate-400">{t('enhance.mvpNote')}</div>
    </AiCard>
  )
}
