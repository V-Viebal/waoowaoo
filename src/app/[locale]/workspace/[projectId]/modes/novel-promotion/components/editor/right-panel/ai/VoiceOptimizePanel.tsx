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

type VoiceOptimizeResponse = {
  data?: {
    taskId?: string
  }
}

type SelectedVoiceClip = {
  elementId: string
  voiceLineId: string
  durationSeconds: number
  content: string
  speaker: string
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

function findSelectedVoiceClip(params: {
  selectedElementId: string | null
  present: { tracks?: Array<{ elements?: TwickTimelineElement[] }> } | null
  voiceLineSources: Array<{ voiceLineId: string; duration?: number; text?: string; speaker?: string }>
}): SelectedVoiceClip | null {
  if (!params.selectedElementId || !params.present?.tracks) return null
  for (const track of params.present.tracks) {
    const elements = Array.isArray(track.elements) ? track.elements : []
    for (const element of elements) {
      if (element.id !== params.selectedElementId || element.type !== 'audio') continue
      const metadata = element.metadata && typeof element.metadata === 'object'
        ? element.metadata as Record<string, unknown>
        : {}
      const voiceLineId = readString(metadata.voiceLineId)
      if (!voiceLineId) return null
      const source = params.voiceLineSources.find((line) => line.voiceLineId === voiceLineId)
      const start = readNumber(element.s) ?? 0
      const end = readNumber(element.e) ?? start
      const durationSeconds = Math.max(1, end - start || source?.duration || 1)
      return {
        elementId: element.id,
        voiceLineId,
        durationSeconds,
        content: readString(metadata.content) || source?.text || '',
        speaker: readString(metadata.speaker) || source?.speaker || '',
      }
    }
  }
  return null
}

export function VoiceOptimizePanel() {
  const t = useTranslations('novelPromotion.editor.rightPanel.ai')
  const queryClient = useQueryClient()
  const { projectId, episodeId, subscribeTaskEvents } = useWorkspaceProvider()
  const { present, selectedItem } = useTimelineContext()
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
  const [content, setContent] = useState('')
  const [speaker, setSpeaker] = useState('')
  const [speed, setSpeed] = useState(1)
  const completedTaskIdsRef = useRef(new Set<string>())

  const selectedElementId = getSelectedElementId(selectedItem)
  const selectedVoiceClip = useMemo(() => findSelectedVoiceClip({
    selectedElementId,
    present,
    voiceLineSources,
  }), [present, selectedElementId, voiceLineSources])

  useEffect(() => {
    setContent(selectedVoiceClip?.content || '')
    setSpeaker(selectedVoiceClip?.speaker || '')
    setSpeed(1)
    setLocalError(null)
  }, [selectedVoiceClip?.elementId, selectedVoiceClip?.content, selectedVoiceClip?.speaker])

  const taskStatus = useTaskStatus({
    projectId,
    targetType: 'NovelPromotionEditorProject',
    targetId: editorProjectId,
    type: [TASK_TYPE.EDITOR_AI_VOICE_OPTIMIZE],
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
      if (!episodeId || !editorProjectId || !selectedVoiceClip) throw new Error(t('voiceOptimize.missingContext'))
      const trimmedContent = content.trim()
      const trimmedSpeaker = speaker.trim()
      if (!trimmedContent) throw new Error(t('voiceOptimize.emptyText'))
      if (!trimmedSpeaker) throw new Error(t('voiceOptimize.emptySpeaker'))
      setLocalError(null)
      await flushProjectSave()
      const durationSeconds = Math.max(1, selectedVoiceClip.durationSeconds)
      const res = await apiFetch(`/api/novel-promotion/${projectId}/editor/ai/voice-optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId,
          editorProjectId,
          voiceLineId: selectedVoiceClip.voiceLineId,
          selectedElementId: selectedVoiceClip.elementId,
          content: trimmedContent,
          speaker: trimmedSpeaker,
          speed,
          durationSeconds,
          requestId: `voice-optimize:${editorProjectId}:${selectedVoiceClip.elementId}:${Date.now()}`,
        }),
      })
      const json = await res.json().catch(() => ({})) as VoiceOptimizeResponse & Record<string, unknown>
      if (!res.ok) {
        throw new Error(readErrorMessage(json, t('voiceOptimize.failed')))
      }
      const taskId = json.data?.taskId
      if (typeof taskId === 'string' && taskId) setSubmittedTaskId(taskId)
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId) })
      return json
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : null
      if (message === 'conflict') {
        setLocalError(t('voiceOptimize.saveConflict'))
      } else if (message === 'unsaved-changes') {
        setLocalError(t('voiceOptimize.unsavedChanges'))
      } else if (message === 'VOICE_OPTIMIZE_AUDIO_ELEMENT_NOT_FOUND') {
        setLocalError(t('voiceOptimize.audioElementNotFound'))
      } else if (message === 'VOICE_OPTIMIZE_NO_VOICE_LINE') {
        setLocalError(t('voiceOptimize.noVoiceLine'))
      } else if (message === 'VOICE_OPTIMIZE_EMPTY_TEXT') {
        setLocalError(t('voiceOptimize.emptyText'))
      } else if (message === 'VOICE_OPTIMIZE_EMPTY_SPEAKER') {
        setLocalError(t('voiceOptimize.emptySpeaker'))
      } else if (message === 'VOICE_OPTIMIZE_DURATION_OVERLAP') {
        setLocalError(t('voiceOptimize.durationOverlap'))
      } else {
        setLocalError(message || t('voiceOptimize.failed'))
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
    if (!episodeId || !editorProjectId) return t('voiceOptimize.missingContext')
    if (isLoadingData || isLoadingProject) return t('voiceOptimize.loading')
    if (!selectedVoiceClip) return t('voiceOptimize.selectAudio')
    if (!content.trim()) return t('voiceOptimize.emptyText')
    return null
  }, [content, editorProjectId, episodeId, isLoadingData, isLoadingProject, selectedVoiceClip, t])

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
        setLocalError(readErrorMessage(payload?.error || payload, t('voiceOptimize.failed')))
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
      setLocalError(latestTask.error?.message || latestTask.errorMessage || t('voiceOptimize.failed'))
    }
  }, [handleCompletedTask, latestTask, submittedTaskId, t])

  const canRun = !disabledReason && !isRunning
  const statusText = isRunning
    ? t('voiceOptimize.running', { progress: typeof progress === 'number' ? progress : 0 })
    : localError
      ? localError
      : latestTask?.status === 'completed'
        ? t('voiceOptimize.done')
        : disabledReason

  return (
    <AiCard
      tone="pink"
      icon="mic"
      title={t('voiceOptimize.title')}
      description={t('voiceOptimize.description')}
      status={statusText || null}
      isError={!!localError}
      actionLabel={isRunning ? t('voiceOptimize.runningButton') : t('voiceOptimize.button')}
      onAction={() => { void mutation.mutateAsync() }}
      disabled={!canRun}
      running={isRunning}
    >
      {selectedVoiceClip ? (
        <div className="rounded-xl bg-white/70 p-2 ring-1 ring-inset ring-slate-100">
          <label className="block text-[11px] font-medium text-slate-600">
            {t('voiceOptimize.textLabel')}
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              disabled={isRunning}
              rows={3}
              className="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-200/50 disabled:bg-slate-100"
            />
          </label>
          <label className="mt-2 block text-[11px] font-medium text-slate-600">
            {t('voiceOptimize.speakerLabel')}
            <input
              value={speaker}
              onChange={(event) => setSpeaker(event.target.value)}
              disabled={isRunning}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-200/50 disabled:bg-slate-100"
            />
          </label>
          <label className="mt-2 block text-[11px] font-medium text-slate-600">
            {t('voiceOptimize.speedLabel', { speed: speed.toFixed(2) })}
            <input
              type="range"
              min="0.75"
              max="1.5"
              step="0.05"
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
              disabled={isRunning}
              className="mt-1 w-full accent-pink-500"
            />
          </label>
          <div className="mt-1 text-[10px] text-slate-400">
            {t('voiceOptimize.selected', { id: selectedVoiceClip.voiceLineId, seconds: selectedVoiceClip.durationSeconds.toFixed(1) })}
          </div>
        </div>
      ) : null}
    </AiCard>
  )
}
