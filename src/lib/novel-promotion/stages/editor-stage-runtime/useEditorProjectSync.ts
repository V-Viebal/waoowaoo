'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { queryKeys } from '@/lib/query/keys'
import { buildInitialProject } from '@/lib/twick/project-builder'
import type { PanelVideoSource, TwickTimelineProject, VoiceLineSource } from '@/lib/twick/types'
import type {
  EditorConflictError,
  EditorProjectRecord,
  EditorProjectSaveResult,
  EditorProjectStatus,
} from './types'

export const EDITOR_PROJECT_SAVE_DEBOUNCE_MS = 1000
const FLUSH_PROJECT_SAVE_MAX_ITERATIONS = 4

export function createDebouncedAction<TArgs extends unknown[]>(
  action: (...args: TArgs) => void,
  delayMs: number,
) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let latestArgs: TArgs | null = null

  const cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    latestArgs = null
  }

  const schedule = (...args: TArgs) => {
    cancel()
    latestArgs = args
    timer = setTimeout(() => {
      const argsToFlush = latestArgs
      timer = null
      latestArgs = null
      if (argsToFlush) action(...argsToFlush)
    }, delayMs)
  }

  const flush = () => {
    if (!timer || !latestArgs) return false
    const argsToFlush = latestArgs
    clearTimeout(timer)
    timer = null
    latestArgs = null
    action(...argsToFlush)
    return true
  }

  const hasPending = () => Boolean(timer && latestArgs)

  return { schedule, cancel, flush, hasPending }
}

export function editorProjectQueryKey(projectId: string | null, episodeId: string | null) {
  return ['editor-project', projectId ?? '', episodeId ?? ''] as const
}

function versionFromUpdatedAt(updatedAt?: string | null): number {
  if (!updatedAt) return 0
  const value = Date.parse(updatedAt)
  return Number.isFinite(value) ? value : 0
}

function normalizeEditorProjectResponse(payload: unknown): EditorProjectRecord {
  const envelope = payload as { data?: unknown; projectData?: unknown } | null
  const raw = envelope && 'data' in envelope ? envelope.data : payload
  const record = raw as Partial<EditorProjectRecord> | null

  if (!record || record.projectData === null) {
    return {
      id: null,
      projectData: null,
      version: 0,
    }
  }

  return {
    id: typeof record.id === 'string' ? record.id : null,
    episodeId: typeof record.episodeId === 'string' ? record.episodeId : undefined,
    projectData: record.projectData as TwickTimelineProject,
    version: typeof record.version === 'number' ? record.version : versionFromUpdatedAt(record.updatedAt),
    renderStatus: record.renderStatus,
    renderTaskId: typeof record.renderTaskId === 'string' ? record.renderTaskId : null,
    renderOutputMediaObjectId: typeof record.renderOutputMediaObjectId === 'string' ? record.renderOutputMediaObjectId : null,
    renderSettings: record.renderSettings && typeof record.renderSettings === 'object'
      ? record.renderSettings as Record<string, unknown>
      : null,
    outputUrl: record.outputUrl,
    updatedAt: record.updatedAt,
  }
}

function normalizeSaveResponse(payload: unknown): EditorProjectSaveResult {
  const envelope = payload as { data?: unknown } | null
  const raw = envelope && envelope.data ? envelope.data : payload
  const record = raw as Partial<EditorProjectSaveResult> | null

  return {
    id: typeof record?.id === 'string' ? record.id : null,
    version: typeof record?.version === 'number' ? record.version : versionFromUpdatedAt(record?.updatedAt),
    updatedAt: record?.updatedAt,
  }
}

// Media URL resolution cache — keyed by projectId so signed URLs from one project can't
// resolve back to a mediaobj:// ref that belongs to another. Bounded via simple LRU per project.
type ProjectCache = { urlToRef: Map<string, string>; refToUrl: Map<string, string> }
const MAX_URL_CACHE_ENTRIES_PER_PROJECT = 512
const projectMediaCaches = new Map<string, ProjectCache>()

function getProjectCache(projectId: string): ProjectCache {
  let cache = projectMediaCaches.get(projectId)
  if (!cache) {
    cache = { urlToRef: new Map(), refToUrl: new Map() }
    projectMediaCaches.set(projectId, cache)
  }
  return cache
}

function cacheMediaMapping(projectId: string, ref: string, url: string) {
  const cache = getProjectCache(projectId)
  // ponytail: cheap FIFO eviction — insertion order is preserved by Map iteration.
  if (cache.refToUrl.size >= MAX_URL_CACHE_ENTRIES_PER_PROJECT) {
    const firstRef = cache.refToUrl.keys().next().value
    if (firstRef) {
      const staleUrl = cache.refToUrl.get(firstRef)
      cache.refToUrl.delete(firstRef)
      if (staleUrl) cache.urlToRef.delete(staleUrl)
    }
  }
  cache.refToUrl.set(ref, url)
  cache.urlToRef.set(url, ref)
}

function isMediaObjRef(src: string): src is `mediaobj://${string}` {
  return src.startsWith('mediaobj://')
}

/**
 * Recursively resolve all mediaobj:// URLs to HTTP URLs
 */
async function resolveMediaUrls<T>(obj: T, projectId: string): Promise<T> {
  const cache = getProjectCache(projectId)
  if (typeof obj === 'string' && isMediaObjRef(obj)) {
    // Check cache first
    if (cache.refToUrl.has(obj)) {
      return cache.refToUrl.get(obj) as T
    }
    // Call the resolve API
    try {
      const response = await fetch(`/api/novel-promotion/${projectId}/media-resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refs: [obj] })
      })
      if (response.ok) {
        const { urls } = await response.json()
        const resolved = urls[obj] || obj
        cacheMediaMapping(projectId, obj, resolved)
        return resolved as T
      }
    } catch {
      // Fall back to original if API fails
    }
    return obj
  }
  if (typeof obj === 'string') {
    return obj
  }
  if (Array.isArray(obj)) {
    return Promise.all(obj.map(item => resolveMediaUrls(item, projectId))) as Promise<T>
  }
  if (!obj || typeof obj !== 'object') {
    return Promise.resolve(obj)
  }
  const result: Record<string, unknown> = {}
  const promises: Promise<void>[] = []
  for (const [key, value] of Object.entries(obj)) {
    promises.push(
      resolveMediaUrls(value, projectId).then(resolved => {
        result[key] = resolved
      })
    )
  }
  await Promise.all(promises)
  return result as T
}

/**
 * Restore HTTP URLs back to mediaobj:// references (best-effort).
 * Scoped to the same project we resolved with — signed URLs collide across projects.
 */
function restoreMediaObjUrls<T>(obj: T, projectId: string): T {
  const cache = getProjectCache(projectId)
  if (typeof obj === 'string') {
    return (cache.urlToRef.get(obj) ?? obj) as T
  }
  if (Array.isArray(obj)) {
    return obj.map(item => restoreMediaObjUrls(item, projectId)) as T
  }
  if (!obj || typeof obj !== 'object') {
    return obj
  }
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    result[key] = restoreMediaObjUrls(value, projectId)
  }
  return result as T
}

async function fetchEditorProject(projectId: string, episodeId: string): Promise<EditorProjectRecord> {
  const response = await apiFetch(`/api/novel-promotion/${projectId}/editor?episodeId=${episodeId}`)
  if (!response.ok) {
    throw new Error('Failed to fetch editor project')
  }
  const record = normalizeEditorProjectResponse(await response.json())
  // Resolve mediaobj URLs before returning
  if (record.projectData) {
    record.projectData = await resolveMediaUrls(record.projectData, projectId)
  }
  return record
}

async function saveEditorProject(params: {
  projectId: string
  episodeId: string
  projectData: TwickTimelineProject
  version: number
}): Promise<EditorProjectSaveResult> {
  // Restore mediaobj references before saving
  const projectData = restoreMediaObjUrls(params.projectData, params.projectId)
  const response = await apiFetch(`/api/novel-promotion/${params.projectId}/editor`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      episodeId: params.episodeId,
      projectData,
      version: params.version,
    }),
  })

  if (response.status === 409) {
    const json = await response.json().catch(() => ({})) as { currentVersion?: number }
    const error = new Error('Editor project version conflict') as EditorConflictError
    error.code = 'CONFLICT'
    error.currentVersion = json.currentVersion
    throw error
  }

  if (!response.ok) {
    throw new Error('Failed to save editor project')
  }

  return normalizeSaveResponse(await response.json())
}

export interface UseEditorProjectSyncParams {
  projectId: string | null
  episodeId: string | null
  panelVideos: PanelVideoSource[]
  voiceLineSources: VoiceLineSource[]
  isAssetDataLoaded: boolean
  videoWidth: number
  videoHeight: number
}

export function useEditorProjectSync({
  projectId,
  episodeId,
  panelVideos,
  voiceLineSources,
  isAssetDataLoaded,
  videoWidth,
  videoHeight,
}: UseEditorProjectSyncParams) {
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => editorProjectQueryKey(projectId, episodeId), [projectId, episodeId])
  const [projectIdState, setProjectIdState] = useState<string | null>(null)
  const [projectData, setProjectData] = useState<TwickTimelineProject | null>(null)
  const [renderState, setRenderState] = useState<Pick<EditorProjectRecord, 'renderStatus' | 'renderTaskId' | 'renderOutputMediaObjectId' | 'renderSettings'> | null>(null)
  const [version, setVersion] = useState(0)
  const [reloadRevision, setReloadRevision] = useState(0)
  const [status, setStatus] = useState<EditorProjectStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [hasConflict, setHasConflict] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const initializedKeyRef = useRef<string | null>(null)
  const projectDataRef = useRef<TwickTimelineProject | null>(null)
  const versionRef = useRef(0)
  const localProjectRevisionRef = useRef(0)
  const lastSavedProjectRevisionRef = useRef(0)
  const savePendingRef = useRef(false)
  const saveMutationPendingRef = useRef(false)
  const saveErrorRef = useRef<string | null>(null)
  const hasConflictRef = useRef(false)
  const inFlightSavePromiseRef = useRef<Promise<void> | null>(null)
  const debounceRef = useRef<ReturnType<typeof createDebouncedAction<[TwickTimelineProject]>> | null>(null)

  useEffect(() => {
    projectDataRef.current = projectData
  }, [projectData])

  useEffect(() => {
    versionRef.current = version
  }, [version])

  useEffect(() => {
    saveErrorRef.current = saveError
  }, [saveError])

  useEffect(() => {
    hasConflictRef.current = hasConflict
  }, [hasConflict])

  const editorProjectQuery = useQuery({
    queryKey,
    queryFn: () => {
      if (!projectId || !episodeId) throw new Error('Project ID and episode ID are required')
      return fetchEditorProject(projectId, episodeId)
    },
    enabled: !!projectId && !!episodeId,
  })

  const saveMutation = useMutation<EditorProjectSaveResult, Error, { projectData: TwickTimelineProject; version: number }>({
    mutationFn: (input) => {
      if (!projectId || !episodeId) throw new Error('Project ID and episode ID are required')
      return saveEditorProject({
        projectId,
        episodeId,
        projectData: input.projectData,
        version: input.version,
      })
    },
    onMutate: () => {
      saveErrorRef.current = null
      setStatus('saving')
      setSaveError(null)
    },
    onSuccess: (result) => {
      saveErrorRef.current = null
      setProjectIdState((previous) => result.id ?? previous)
      setVersion(result.version)
      setLastSavedAt(new Date())
      setStatus('saved')
      setHasConflict(false)
      setSaveError(null)
      queryClient.invalidateQueries({ queryKey })
      if (projectId && episodeId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, episodeId) })
      }
    },
    onError: (error: Error) => {
      const maybeConflict = error as Partial<EditorConflictError>
      if (maybeConflict.code === 'CONFLICT') {
        const message = 'Editor project was changed elsewhere. Reload or force save to continue.'
        saveErrorRef.current = message
        setStatus('conflict')
        setHasConflict(true)
        setSaveError(message)
        if (typeof maybeConflict.currentVersion === 'number') {
          // ponytail: sync versionRef immediately — the state effect that mirrors version
          // → versionRef runs on the next tick, so a forceSave fired right away would use
          // the stale version and re-conflict.
          versionRef.current = maybeConflict.currentVersion
          setVersion(maybeConflict.currentVersion)
        }
        return
      }
      const message = error.message || 'Failed to save editor project'
      saveErrorRef.current = message
      setStatus('error')
      setSaveError(message)
    },
  })

  useEffect(() => {
    saveMutationPendingRef.current = saveMutation.isPending
  }, [saveMutation.isPending])

  const startSave = useCallback((data: TwickTimelineProject, saveVersion = versionRef.current) => {
    if (!projectId || !episodeId) {
      savePendingRef.current = false
      return null
    }
    if (saveMutationPendingRef.current) return null

    const savedRevision = localProjectRevisionRef.current
    savePendingRef.current = false
    saveMutationPendingRef.current = true

    const savePromise: Promise<void> = saveMutation.mutateAsync({ projectData: data, version: saveVersion })
      .then((result) => {
        versionRef.current = result.version
        lastSavedProjectRevisionRef.current = Math.max(lastSavedProjectRevisionRef.current, savedRevision)
      })
      .finally(() => {
        if (inFlightSavePromiseRef.current === savePromise) {
          inFlightSavePromiseRef.current = null
        }
        saveMutationPendingRef.current = false
      })

    inFlightSavePromiseRef.current = savePromise
    void savePromise.catch(() => undefined)
    return savePromise
  }, [episodeId, projectId, saveMutation])

  useEffect(() => {
    if (!saveMutation.isPending && savePendingRef.current && debounceRef.current?.hasPending() === false) {
      const currentProjectData = projectDataRef.current
      if (currentProjectData && !hasConflict) {
        startSave(currentProjectData, versionRef.current)
      }
    }
  }, [hasConflict, saveMutation.isPending, startSave])

  const triggerSaveRef = useRef(startSave)
  useEffect(() => {
    triggerSaveRef.current = startSave
  }, [startSave])

  const triggerSave = useCallback((data: TwickTimelineProject, saveVersion = versionRef.current) => {
    return triggerSaveRef.current(data, saveVersion)
  }, [])

  useEffect(() => {
    // ponytail: create once — using createDebouncedAction with a stable delegate through
    // the ref avoids re-creating the debounce (which flushed pending saves) on every
    // startSave identity change.
    if (!debounceRef.current) {
      debounceRef.current = createDebouncedAction((data: TwickTimelineProject) => {
        triggerSaveRef.current(data, versionRef.current)
      }, EDITOR_PROJECT_SAVE_DEBOUNCE_MS)
    }
    return () => {
      debounceRef.current?.flush()
    }
  }, [])

  const flushPendingSave = useCallback(() => {
    if (hasConflict) return null
    const flushed = debounceRef.current?.flush() ?? false
    if (flushed) return inFlightSavePromiseRef.current
    if (saveMutationPendingRef.current) return inFlightSavePromiseRef.current
    if (!savePendingRef.current) return null
    const currentProjectData = projectDataRef.current
    if (!currentProjectData) {
      savePendingRef.current = false
      return null
    }
    return triggerSave(currentProjectData, versionRef.current)
  }, [hasConflict, triggerSave])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    const handleBlur = () => {
      flushPendingSave()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushPendingSave()
      }
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      // ponytail: browsers stopped honoring custom messages years ago — the return-value
      // just triggers the native "Leave site?" dialog when there is unsaved work.
      const hasUnsaved = savePendingRef.current
        || debounceRef.current?.hasPending() === true
        || saveMutationPendingRef.current
        || lastSavedProjectRevisionRef.current < localProjectRevisionRef.current
      if (!hasUnsaved) return
      flushPendingSave()
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('blur', handleBlur)
    window.addEventListener('pagehide', handleBlur)
    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      flushPendingSave()
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('pagehide', handleBlur)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [flushPendingSave])

  useEffect(() => {
    const key = `${projectId ?? ''}:${episodeId ?? ''}`
    initializedKeyRef.current = null
    setProjectIdState(null)
    setProjectData(null)
    setRenderState(null)
    setVersion(0)
    setReloadRevision(0)
    setStatus(projectId && episodeId ? 'loading' : 'idle')
    setSaveError(null)
    setHasConflict(false)
    setLastSavedAt(null)
    localProjectRevisionRef.current = 0
    lastSavedProjectRevisionRef.current = 0
    debounceRef.current?.cancel()
    if (!projectId || !episodeId) {
      initializedKeyRef.current = key
    }
  }, [episodeId, projectId])

  useEffect(() => {
    if (!projectId || !episodeId || editorProjectQuery.isLoading || !isAssetDataLoaded) return
    const key = `${projectId}:${episodeId}`
    if (initializedKeyRef.current === key) return

    if (editorProjectQuery.error) {
      setStatus('error')
      setSaveError(editorProjectQuery.error.message || 'Failed to load editor project')
      initializedKeyRef.current = key
      return
    }

    const record = editorProjectQuery.data
    if (record?.projectData) {
      setProjectIdState(record.id)
      setProjectData(record.projectData)
      setRenderState({
        renderStatus: record.renderStatus,
        renderTaskId: record.renderTaskId,
        renderOutputMediaObjectId: record.renderOutputMediaObjectId,
        renderSettings: record.renderSettings,
      })
      localProjectRevisionRef.current = 0
      lastSavedProjectRevisionRef.current = 0
      setVersion(record.version)
      setStatus('saved')
      setLastSavedAt(record.updatedAt ? new Date(record.updatedAt) : null)
      initializedKeyRef.current = key
      return
    }

    if (panelVideos.length === 0) {
      setProjectData(null)
      setRenderState(null)
      localProjectRevisionRef.current = 0
      lastSavedProjectRevisionRef.current = 0
      setVersion(0)
      setStatus('idle')
      initializedKeyRef.current = key
      return
    }

    // Build initial project and resolve mediaobj URLs before setting state
    const initialProject = buildInitialProject(panelVideos, voiceLineSources, {
      width: videoWidth,
      height: videoHeight,
      includeAudio: true,
      includeCaptions: false,
    })

    // Mark as initialized immediately to prevent re-runs
    initializedKeyRef.current = key
    setStatus('idle')

    // Resolve mediaobj URLs asynchronously, then set data
    resolveMediaUrls(initialProject, projectId).then((resolved) => {
      setProjectData(resolved)
      setRenderState(null)
      setVersion(0)
      triggerSave(initialProject, 0) // Save the unresolved version (with mediaobj://)
    }).catch(() => {
      // Fall back to unresolved data
      setProjectData(initialProject)
      setRenderState(null)
      setVersion(0)
      triggerSave(initialProject, 0)
    })
  }, [
    editorProjectQuery.data,
    editorProjectQuery.error,
    editorProjectQuery.isLoading,
    episodeId,
    isAssetDataLoaded,
    panelVideos,
    projectId,
    triggerSave,
    videoHeight,
    videoWidth,
    voiceLineSources,
  ])

  const updateProjectData = useCallback((nextData: TwickTimelineProject) => {
    localProjectRevisionRef.current += 1
    setProjectData(nextData)
    projectDataRef.current = nextData
    setSaveError(null)
    if (hasConflict) return
    setStatus('idle')
    savePendingRef.current = true
    debounceRef.current?.schedule(nextData)
  }, [hasConflict])

  const saveNow = useCallback(() => {
    const currentProjectData = projectDataRef.current
    if (!currentProjectData || saveMutation.isPending) return
    debounceRef.current?.cancel()
    savePendingRef.current = true
    triggerSave(currentProjectData, versionRef.current)
  }, [saveMutation.isPending, triggerSave])

  const flushProjectSave = useCallback(async () => {
    const targetRevision = localProjectRevisionRef.current

    for (let iteration = 0; iteration < FLUSH_PROJECT_SAVE_MAX_ITERATIONS; iteration += 1) {
      const savePromise = flushPendingSave() ?? inFlightSavePromiseRef.current
      if (savePromise) {
        try {
          await savePromise
        } catch (error) {
          const maybeConflict = error as Partial<EditorConflictError>
          if (maybeConflict.code === 'CONFLICT') {
            throw new Error('conflict')
          }
          throw error
        }
      }

      if (hasConflictRef.current && lastSavedProjectRevisionRef.current < targetRevision) {
        throw new Error('conflict')
      }

      if (saveErrorRef.current) {
        throw new Error(saveErrorRef.current)
      }

      if (lastSavedProjectRevisionRef.current >= targetRevision) {
        return
      }

      if (!inFlightSavePromiseRef.current && !savePendingRef.current && !debounceRef.current?.hasPending()) {
        if (lastSavedProjectRevisionRef.current < targetRevision) {
          throw new Error(hasConflictRef.current ? 'conflict' : 'unsaved-changes')
        }
        return
      }
    }

    throw new Error('Timed out while flushing editor project save')
  }, [flushPendingSave])

  const forceSave = useCallback(() => {
    const currentProjectData = projectDataRef.current
    if (!currentProjectData || saveMutation.isPending) return
    debounceRef.current?.cancel()
    savePendingRef.current = true
    setHasConflict(false)
    setSaveError(null)
    triggerSave(currentProjectData, versionRef.current)
  }, [saveMutation.isPending, triggerSave])

  const reloadFromServer = useCallback(async (options?: { discardLocal?: boolean }) => {
    // ponytail: default is to flush any pending edits before reloading to avoid silently
    // clobbering user work. AI panels finish tasks that mutate server state, so callers
    // that know they want the server copy pass discardLocal: true.
    if (!options?.discardLocal) {
      const hasUnsaved = savePendingRef.current
        || debounceRef.current?.hasPending() === true
        || saveMutationPendingRef.current
        || lastSavedProjectRevisionRef.current < localProjectRevisionRef.current
      if (hasUnsaved) {
        try {
          await flushPendingSave()
        } catch {
          // If the flush errors (conflict / net), still reload to pick up server state.
        }
      }
    }
    debounceRef.current?.cancel()
    savePendingRef.current = false
    setHasConflict(false)
    setSaveError(null)
    setStatus('loading')
    initializedKeyRef.current = null

    try {
      await queryClient.invalidateQueries({ queryKey })
      const result = await editorProjectQuery.refetch()
      if (result.error) throw result.error

      const record = result.data
      if (record?.projectData) {
        setProjectIdState(record.id)
        setProjectData(record.projectData)
        setRenderState({
          renderStatus: record.renderStatus,
          renderTaskId: record.renderTaskId,
          renderOutputMediaObjectId: record.renderOutputMediaObjectId,
          renderSettings: record.renderSettings,
        })
        projectDataRef.current = record.projectData
        localProjectRevisionRef.current = 0
        lastSavedProjectRevisionRef.current = 0
        setVersion(record.version)
        versionRef.current = record.version
        setLastSavedAt(record.updatedAt ? new Date(record.updatedAt) : null)
        setStatus('saved')
        setReloadRevision((revision) => revision + 1)
        initializedKeyRef.current = `${projectId ?? ''}:${episodeId ?? ''}`
        return
      }

      setProjectData(null)
      setRenderState(null)
      projectDataRef.current = null
      localProjectRevisionRef.current = 0
      lastSavedProjectRevisionRef.current = 0
      setVersion(0)
      versionRef.current = 0
      setStatus('idle')
      setReloadRevision((revision) => revision + 1)
      initializedKeyRef.current = `${projectId ?? ''}:${episodeId ?? ''}`
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reload editor project'
      setStatus('error')
      setSaveError(message)
    }
  }, [editorProjectQuery, episodeId, flushPendingSave, projectId, queryClient, queryKey])

  return {
    id: projectIdState,
    renderState,
    projectData,
    version,
    reloadRevision,
    status,
    isLoading: editorProjectQuery.isLoading || status === 'loading',
    isSaving: saveMutation.isPending || status === 'saving',
    saveError,
    hasConflict,
    lastSavedAt,
    updateProjectData,
    saveNow,
    flushProjectSave,
    forceSave,
    reloadFromServer,
  }
}
