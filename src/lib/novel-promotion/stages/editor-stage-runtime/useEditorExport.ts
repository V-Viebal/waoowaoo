'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import { TASK_EVENT_TYPE, TASK_TYPE, type SSEEvent } from '@/lib/task/types'

export type EditorExportFormat = 'mp4' | 'webm'
export type EditorRenderStatus = 'IDLE' | 'PROCESSING' | 'DONE' | 'FAILED'
export type EditorExportPhase = 'idle' | 'starting' | 'processing' | 'done' | 'failed' | 'cancelled'

export interface EditorExportSettings {
  width: number
  height: number
  fps: number
  bitrate: string
  format: EditorExportFormat
}

export interface EditorExportState {
  phase: EditorExportPhase
  renderStatus: EditorRenderStatus
  taskId: string | null
  progress: number
  outputMediaObjectId: string | null
  downloadUrl: string | null
  error: string | null
  isConcurrencyConflict: boolean
  settings: EditorExportSettings | null
}

type TaskEventSubscriber = (listener: (event: SSEEvent) => void) => () => void

export interface InitialEditorExportRenderState {
  renderStatus?: EditorRenderStatus | string | null
  renderTaskId?: string | null
  renderOutputMediaObjectId?: string | null
  renderSettings?: Partial<EditorExportSettings> | Record<string, unknown> | null
}

export interface UseEditorExportParams {
  projectId: string | null
  episodeId: string | null
  editorProjectId: string | null
  flushProjectSave: () => Promise<void>
  subscribeTaskEvents?: TaskEventSubscriber
  initialRenderState?: InitialEditorExportRenderState | null
  pollIntervalMs?: number
  t?: (key: string) => string
}

type RenderStartResponse = {
  data?: {
    taskId?: string
    status?: string
    settings?: Partial<EditorExportSettings>
  }
  taskId?: string
  status?: string
  error?: {
    details?: {
      taskId?: string
      status?: string
    }
  }
}

type RenderStatusResponse = {
  data?: {
    task?: RenderTask
    editorProject?: {
      renderStatus?: EditorRenderStatus | string | null
      renderOutputMediaObjectId?: string | null
      renderSettings?: Partial<EditorExportSettings> | null
      renderTaskId?: string | null
    } | null
  }
}

type RenderTask = {
  id?: string
  status?: string
  progress?: number | null
  errorMessage?: string | null
  error?: { message?: string | null } | null
  result?: Record<string, unknown> | null
}

const DEFAULT_POLL_INTERVAL_MS = 2500
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'canceled', 'cancelled'])

export const DEFAULT_EDITOR_EXPORT_SETTINGS: EditorExportSettings = {
  width: 1080,
  height: 1920,
  fps: 30,
  bitrate: '8M',
  format: 'mp4',
}

function clampProgress(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(0, Math.min(100, Math.round(numeric)))
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    const direct = readString(record.message) || readString(record.errorMessage) || readString(record.error)
    if (direct) return direct
    if (record.error && typeof record.error === 'object') {
      const nested = record.error as Record<string, unknown>
      return readString(nested.message) || fallback
    }
  }
  return fallback
}

function readOutputFromRecord(record: Record<string, unknown> | null | undefined) {
  return {
    outputMediaObjectId: readString(record?.mediaObjectId) || readString(record?.renderOutputMediaObjectId),
    downloadUrl: readString(record?.outputUrl) || readString(record?.downloadUrl) || readString(record?.url),
  }
}

function readConflictTaskId(payload: RenderStartResponse & Record<string, unknown>): string | null {
  return readString(payload.data?.taskId)
    || readString(payload.taskId)
    || readString(payload.error?.details?.taskId)
}

function normalizeRenderStatus(value: unknown, taskStatus?: string | null): EditorRenderStatus {
  if (value === 'DONE' || taskStatus === 'completed') return 'DONE'
  if (value === 'FAILED' || taskStatus === 'failed' || taskStatus === 'canceled' || taskStatus === 'cancelled') return 'FAILED'
  if (value === 'PROCESSING' || taskStatus === 'queued' || taskStatus === 'processing') return 'PROCESSING'
  return 'IDLE'
}

function phaseFromStatus(renderStatus: EditorRenderStatus, taskStatus?: string | null): EditorExportPhase {
  if (renderStatus === 'DONE' || taskStatus === 'completed') return 'done'
  if (taskStatus === 'canceled' || taskStatus === 'cancelled') return 'cancelled'
  if (renderStatus === 'FAILED' || taskStatus === 'failed') return 'failed'
  if (renderStatus === 'PROCESSING' || taskStatus === 'queued' || taskStatus === 'processing') return 'processing'
  return 'idle'
}

async function parseJsonSafely<T>(response: Response): Promise<T & Record<string, unknown>> {
  return await response.json().catch(() => ({})) as T & Record<string, unknown>
}

const initialState: EditorExportState = {
  phase: 'idle',
  renderStatus: 'IDLE',
  taskId: null,
  progress: 0,
  outputMediaObjectId: null,
  downloadUrl: null,
  error: null,
  isConcurrencyConflict: false,
  settings: null,
}

export function useEditorExport({
  projectId,
  episodeId,
  editorProjectId,
  flushProjectSave,
  subscribeTaskEvents,
  initialRenderState,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  t,
}: UseEditorExportParams) {
  const [state, setState] = useState<EditorExportState>(initialState)
  const activeTaskIdRef = useRef<string | null>(null)
  const lastSettingsRef = useRef<EditorExportSettings | null>(null)
  const mountedRef = useRef(true)
  const restoredTaskIdRef = useRef<string | null>(null)

  const translate = useCallback((key: string, fallback: string) => {
    try {
      return t ? t(key) : fallback
    } catch {
      return fallback
    }
  }, [t])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const applyStatusPayload = useCallback((payload: RenderStatusResponse['data']) => {
    const task = payload?.task || null
    const taskStatus = task?.status || null
    const editorProject = payload?.editorProject || null
    const taskResult = task?.result && typeof task.result === 'object' ? task.result : null
    const outputFromTask = readOutputFromRecord(taskResult)
    const renderStatus = normalizeRenderStatus(editorProject?.renderStatus, taskStatus)
    const phase = phaseFromStatus(renderStatus, taskStatus)

    setState((previous) => ({
      ...previous,
      phase,
      renderStatus,
      taskId: task?.id || previous.taskId,
      progress: phase === 'done' ? 100 : clampProgress(task?.progress, previous.progress),
      outputMediaObjectId: outputFromTask.outputMediaObjectId || editorProject?.renderOutputMediaObjectId || previous.outputMediaObjectId,
      downloadUrl: outputFromTask.downloadUrl || previous.downloadUrl,
      error: phase === 'failed' || phase === 'cancelled'
        ? (task?.error?.message || task?.errorMessage || previous.error || translate('failed', 'Export failed. Please try again.'))
        : null,
      isConcurrencyConflict: false,
      settings: (editorProject?.renderSettings as EditorExportSettings | null) || previous.settings,
    }))

    if (task?.id && TERMINAL_TASK_STATUSES.has(taskStatus || '')) {
      activeTaskIdRef.current = null
    }
  }, [translate])

  const pollStatus = useCallback(async (taskId?: string | null) => {
    const currentTaskId = taskId || activeTaskIdRef.current
    if (!projectId || !currentTaskId) return null
    activeTaskIdRef.current = currentTaskId
    const response = await apiFetch(`/api/novel-promotion/${projectId}/editor/render?taskId=${encodeURIComponent(currentTaskId)}`)
    const json = await parseJsonSafely<RenderStatusResponse>(response)
    if (!response.ok) {
      throw new Error(readErrorMessage(json, translate('statusFailed', 'Failed to refresh export status.')))
    }
    applyStatusPayload(json.data)
    return json.data || null
  }, [applyStatusPayload, projectId, translate])

  useEffect(() => {
    if (!initialRenderState || initialRenderState.renderStatus !== 'PROCESSING' || !initialRenderState.renderTaskId) return
    if (restoredTaskIdRef.current === initialRenderState.renderTaskId) return

    restoredTaskIdRef.current = initialRenderState.renderTaskId
    activeTaskIdRef.current = initialRenderState.renderTaskId
    setState((previous) => ({
      ...previous,
      phase: 'processing',
      renderStatus: 'PROCESSING',
      taskId: initialRenderState.renderTaskId || previous.taskId,
      outputMediaObjectId: initialRenderState.renderOutputMediaObjectId || previous.outputMediaObjectId,
      settings: (initialRenderState.renderSettings as EditorExportSettings | null) || previous.settings,
      error: null,
      isConcurrencyConflict: false,
    }))
    void pollStatus(initialRenderState.renderTaskId).catch(() => undefined)
  }, [initialRenderState, pollStatus])

  const startExport = useCallback(async (settings: EditorExportSettings) => {
    if (!projectId || !episodeId || !editorProjectId) {
      setState((previous) => ({
        ...previous,
        phase: 'failed',
        renderStatus: 'FAILED',
        error: translate('missingContext', 'Missing current episode or editor project.'),
      }))
      return null
    }

    lastSettingsRef.current = settings
    setState({
      ...initialState,
      phase: 'starting',
      renderStatus: 'PROCESSING',
      settings,
    })

    try {
      await flushProjectSave()
      const response = await apiFetch(`/api/novel-promotion/${projectId}/editor/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId,
          editorProjectId,
          settings,
          requestId: `editor-render:${editorProjectId}:${Date.now()}`,
        }),
      })
      const json = await parseJsonSafely<RenderStartResponse>(response)

      if (!response.ok) {
        const isConflict = response.status === 409
        const activeTaskId = isConflict ? readConflictTaskId(json) : null
        if (activeTaskId) {
          activeTaskIdRef.current = activeTaskId
          setState((previous) => ({
            ...previous,
            phase: 'processing',
            renderStatus: 'PROCESSING',
            taskId: activeTaskId,
            error: null,
            isConcurrencyConflict: true,
          }))
          void pollStatus(activeTaskId).catch(() => undefined)
          return activeTaskId
        }
        throw Object.assign(
          new Error(isConflict
            ? translate('conflict', 'An export is already in progress.')
            : readErrorMessage(json, translate('startFailed', 'Failed to start export.'))),
          { isConcurrencyConflict: isConflict },
        )
      }

      const taskId = json.data?.taskId || null
      activeTaskIdRef.current = taskId
      setState((previous) => ({
        ...previous,
        phase: 'processing',
        renderStatus: 'PROCESSING',
        taskId,
        progress: 0,
        error: null,
        isConcurrencyConflict: false,
        settings: { ...settings, ...(json.data?.settings || {}) },
      }))
      if (taskId) {
        void pollStatus(taskId).catch(() => undefined)
      }
      return taskId
    } catch (error) {
      const maybeConflict = error as { isConcurrencyConflict?: boolean }
      const message = error instanceof Error ? error.message : translate('startFailed', 'Failed to start export.')
      setState((previous) => ({
        ...previous,
        phase: 'failed',
        renderStatus: 'FAILED',
        error: message === 'conflict'
          ? translate('saveConflict', 'The editor project has a save conflict. Resolve it before exporting.')
          : message === 'unsaved-changes'
            ? translate('unsavedChanges', 'Current editor changes have not been saved. Save successfully before exporting.')
            : message,
        isConcurrencyConflict: !!maybeConflict.isConcurrencyConflict,
      }))
      activeTaskIdRef.current = null
      return null
    }
  }, [editorProjectId, episodeId, flushProjectSave, pollStatus, projectId, translate])

  const retryExport = useCallback(async () => {
    if (!lastSettingsRef.current) return null
    return startExport(lastSettingsRef.current)
  }, [startExport])

  const cancelExport = useCallback(async () => {
    const taskId = activeTaskIdRef.current || state.taskId
    if (!projectId || !taskId) return false
    const response = await apiFetch(`/api/novel-promotion/${projectId}/editor/render?taskId=${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
    })
    const json = await parseJsonSafely<{ data?: { cancelled?: boolean } }>(response)
    if (!response.ok) {
      setState((previous) => ({
        ...previous,
        error: readErrorMessage(json, translate('cancelFailed', 'Failed to cancel export.')),
      }))
      return false
    }
    activeTaskIdRef.current = null
    setState((previous) => ({
      ...previous,
      phase: 'cancelled',
      renderStatus: previous.renderStatus === 'PROCESSING' ? 'FAILED' : previous.renderStatus,
      error: null,
      isConcurrencyConflict: false,
    }))
    return !!json.data?.cancelled
  }, [projectId, state.taskId, translate])

  const download = useCallback(() => {
    if (!state.downloadUrl || typeof document === 'undefined') return false
    const anchor = document.createElement('a')
    anchor.href = state.downloadUrl
    anchor.download = `editor-export.${state.settings?.format || 'mp4'}`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    return true
  }, [state.downloadUrl, state.settings?.format])

  useEffect(() => {
    if (!subscribeTaskEvents) return undefined
    return subscribeTaskEvents((event) => {
      if (event.taskId !== activeTaskIdRef.current) return
      if (event.taskType && event.taskType !== TASK_TYPE.EDITOR_RENDER) return
      const payload = event.payload && typeof event.payload === 'object'
        ? event.payload as Record<string, unknown>
        : {}
      const lifecycleType = typeof payload.lifecycleType === 'string' ? payload.lifecycleType : null
      if (lifecycleType === TASK_EVENT_TYPE.PROGRESS || lifecycleType === TASK_EVENT_TYPE.PROCESSING) {
        setState((previous) => ({
          ...previous,
          phase: 'processing',
          renderStatus: 'PROCESSING',
          progress: clampProgress(payload.progress, previous.progress),
        }))
      } else if (lifecycleType === TASK_EVENT_TYPE.COMPLETED) {
        const output = readOutputFromRecord(payload)
        activeTaskIdRef.current = null
        setState((previous) => ({
          ...previous,
          phase: 'done',
          renderStatus: 'DONE',
          progress: 100,
          outputMediaObjectId: output.outputMediaObjectId || previous.outputMediaObjectId,
          downloadUrl: output.downloadUrl || previous.downloadUrl,
          error: null,
          isConcurrencyConflict: false,
        }))
        void pollStatus(event.taskId).catch(() => undefined)
      } else if (lifecycleType === TASK_EVENT_TYPE.FAILED) {
        activeTaskIdRef.current = null
        setState((previous) => ({
          ...previous,
          phase: 'failed',
          renderStatus: 'FAILED',
          error: readErrorMessage(payload.error || payload, translate('failed', 'Export failed. Please try again.')),
          isConcurrencyConflict: false,
        }))
      }
    })
  }, [pollStatus, subscribeTaskEvents, translate])

  useEffect(() => {
    if (!state.taskId || state.phase !== 'processing') return undefined
    const timer = window.setInterval(() => {
      if (!mountedRef.current || !activeTaskIdRef.current) return
      void pollStatus(activeTaskIdRef.current).catch((error) => {
        setState((previous) => ({
          ...previous,
          error: error instanceof Error ? error.message : translate('statusFailed', 'Failed to refresh export status.'),
        }))
      })
    }, pollIntervalMs)
    return () => window.clearInterval(timer)
  }, [pollIntervalMs, pollStatus, state.phase, state.taskId, translate])

  const isRunning = state.phase === 'starting' || state.phase === 'processing'
  const canStart = useMemo(() => !!projectId && !!episodeId && !!editorProjectId && !isRunning, [editorProjectId, episodeId, isRunning, projectId])

  return {
    state,
    isRunning,
    canStart,
    startExport,
    retryExport,
    cancelExport,
    pollStatus,
    download,
  }
}
