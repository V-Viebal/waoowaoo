'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api-fetch'
import { queryKeys } from '@/lib/query/keys'
import { useTaskStatus } from '@/lib/query/hooks/useTaskStatus'
import { useEditorStageRuntime } from '@/lib/novel-promotion/stages/editor-stage-runtime-core'
import { TASK_EVENT_TYPE, TASK_TYPE, type SSEEvent } from '@/lib/task/types'
import { useWorkspaceProvider } from '../../../../WorkspaceProvider'

type CaptionResponse = {
  data?: {
    taskId?: string
  }
}

function readErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (typeof record.message === 'string') return record.message
    if (typeof record.errorMessage === 'string') return record.errorMessage
    if (typeof record.error === 'string') return record.error
  }
  return fallback
}

function estimateDurationMinutes(voiceLineSources: Array<{ duration?: number }>): number {
  const totalSeconds = voiceLineSources.reduce((sum, line) => {
    const duration = typeof line.duration === 'number' && Number.isFinite(line.duration) && line.duration > 0
      ? line.duration
      : 0
    return sum + duration
  }, 0)
  return Math.max(0.01, totalSeconds / 60)
}

export function CaptionPanel() {
  const t = useTranslations('novelPromotion.editor.rightPanel.ai')
  const queryClient = useQueryClient()
  const { projectId, episodeId, subscribeTaskEvents } = useWorkspaceProvider()
  const {
    editorProjectId,
    voiceLineSources,
    isLoadingData,
    isLoadingProject,
    reloadProject,
    flushProjectSave,
  } = useEditorStageRuntime()
  const [submittedTaskId, setSubmittedTaskId] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const completedTaskIdsRef = useRef(new Set<string>())

  const taskStatus = useTaskStatus({
    projectId,
    targetType: 'NovelPromotionEditorProject',
    targetId: editorProjectId,
    type: [TASK_TYPE.EDITOR_AI_CAPTION],
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

  const durationMinutes = useMemo(() => estimateDurationMinutes(voiceLineSources), [voiceLineSources])

  const mutation = useMutation({
    mutationFn: async () => {
      if (!episodeId || !editorProjectId) throw new Error(t('caption.missingContext'))
      setLocalError(null)
      await flushProjectSave()
      const res = await apiFetch(`/api/novel-promotion/${projectId}/editor/ai/caption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId,
          editorProjectId,
          durationMinutes,
          requestId: `caption:${editorProjectId}:${Date.now()}`,
        }),
      })
      const json = await res.json().catch(() => ({})) as CaptionResponse & Record<string, unknown>
      if (!res.ok) {
        throw new Error(readErrorMessage(json, t('caption.failed')))
      }
      const taskId = json.data?.taskId
      if (typeof taskId === 'string' && taskId) setSubmittedTaskId(taskId)
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId) })
      return json
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : null
      if (message === 'conflict') {
        setLocalError(t('caption.saveConflict'))
      } else if (message === 'unsaved-changes') {
        setLocalError(t('caption.unsavedChanges'))
      } else if (message === 'CAPTION_NO_VOICE_LINES') {
        setLocalError(t('caption.noVoiceLines'))
      } else {
        setLocalError(message || t('caption.failed'))
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
    if (!episodeId || !editorProjectId) return t('caption.missingContext')
    if (isLoadingData || isLoadingProject) return t('caption.loading')
    if (voiceLineSources.length === 0) return t('caption.noVoiceLines')
    return null
  }, [editorProjectId, episodeId, isLoadingData, isLoadingProject, t, voiceLineSources.length])

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
        setLocalError(readErrorMessage(payload?.error || payload, t('caption.failed')))
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
      setLocalError(latestTask.error?.message || latestTask.errorMessage || t('caption.failed'))
    }
  }, [handleCompletedTask, latestTask, submittedTaskId, t])

  const canRun = !disabledReason && !isRunning
  const statusText = isRunning
    ? t('caption.running', { progress: typeof progress === 'number' ? progress : 0 })
    : localError
      ? localError
      : latestTask?.status === 'completed'
        ? t('caption.done')
        : disabledReason

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="font-medium text-slate-950">{t('captions.title')}</div>
      <div className="mt-1 leading-5 text-slate-500">{t('captions.description')}</div>
      <div className="mt-2 text-[11px] leading-4 text-slate-400">
        {t('caption.estimate', { count: voiceLineSources.length, minutes: durationMinutes.toFixed(2) })}
      </div>
      {statusText ? (
        <div className={`mt-2 text-[11px] leading-4 ${localError ? 'text-red-600' : 'text-slate-500'}`}>
          {statusText}
        </div>
      ) : null}
      <button
        type="button"
        disabled={!canRun}
        onClick={() => { void mutation.mutateAsync() }}
        className="mt-3 w-full rounded-xl bg-slate-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isRunning ? t('caption.runningButton') : t('caption.button')}
      </button>
    </div>
  )
}
