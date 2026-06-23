// @vitest-environment jsdom

import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelVideoSource, TwickTimelineProject, VoiceLineSource } from '@/lib/twick/types'
import {
  createDebouncedAction,
  EDITOR_PROJECT_SAVE_DEBOUNCE_MS,
  useEditorProjectSync,
  type UseEditorProjectSyncParams,
} from '@/lib/novel-promotion/stages/editor-stage-runtime/useEditorProjectSync'
import {
  mapStoryboardsToPanelVideos,
  mapVoiceLinesToSources,
} from '@/lib/novel-promotion/stages/editor-stage-runtime/useEditorStageDataLoader'
import { applyTwickTransitionToProject } from '@/lib/twick/transition'

const apiFetchMock = vi.hoisted(() => vi.fn())

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api-fetch', () => ({
  apiFetch: apiFetchMock,
}))

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  apiFetchMock.mockReset()

  for (const { root, container } of mountedRoots.splice(0)) {
    act(() => {
      root.unmount()
    })
    container.remove()
  }
})

function okJson(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function createEmptyEditorApiMock() {
  const savedProjects: TwickTimelineProject[] = []
  const saveAttempts: Array<{ projectData: TwickTimelineProject; version: number }> = []

  apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
    if (options?.method === 'PUT') {
      const body = JSON.parse(String(options.body)) as { projectData: TwickTimelineProject; version: number }
      saveAttempts.push({ projectData: body.projectData, version: body.version })
      savedProjects.push(body.projectData)
      return okJson({
        data: {
          id: 'editor-project-1',
          version: savedProjects.length,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      })
    }

    if (url.includes('/editor?episodeId=')) {
      return okJson({ data: null })
    }

    return okJson({ data: null })
  })

  return { savedProjects, saveAttempts }
}

function createProject(overrides: Partial<TwickTimelineProject> = {}): TwickTimelineProject {
  return {
    version: 1,
    metadata: {
      custom: {
        width: 1920,
        height: 1080,
        fps: 30,
        duration: 3,
      },
    },
    tracks: [
      {
        id: 'track-video-main',
        name: '视频',
        type: 'video',
        elements: [],
      },
    ],
    ...overrides,
  } as TwickTimelineProject
}

const panelVideo: PanelVideoSource = {
  panelId: 'panel-1',
  storyboardId: 'storyboard-1',
  videoMediaObjectId: 'video-media-1',
  duration: 3,
  description: 'panel motion',
}

const voiceLine: VoiceLineSource = {
  voiceLineId: 'voice-line-1',
  audioMediaObjectId: 'audio-media-1',
  duration: 2,
  text: 'Hello',
  speaker: 'Alice',
}

const defaultHookProps: UseEditorProjectSyncParams = {
  projectId: 'project-1',
  episodeId: 'episode-1',
  panelVideos: [],
  voiceLineSources: [],
  isAssetDataLoaded: true,
  videoWidth: 1920,
  videoHeight: 1080,
}

function renderEditorProjectSyncHook(initialProps: UseEditorProjectSyncParams) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const result: { current: ReturnType<typeof useEditorProjectSync> | null } = { current: null }

  function HookHarness(props: UseEditorProjectSyncParams) {
    result.current = useEditorProjectSync(props)
    return null
  }

  function render(props: UseEditorProjectSyncParams) {
    act(() => {
      root.render(createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(HookHarness, props),
      ))
    })
  }

  render(initialProps)
  mountedRoots.push({ root, container })

  return {
    result,
    rerender: render,
    unmount: () => {
      act(() => {
        root.unmount()
      })
      const index = mountedRoots.findIndex((entry) => entry.root === root)
      if (index >= 0) mountedRoots.splice(index, 1)
      container.remove()
    },
  }
}

async function waitForExpectation(assertion: () => void) {
  const start = Date.now()
  let lastError: unknown

  while (Date.now() - start < 2000) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
    }
  }

  throw lastError
}

describe('editor-stage-runtime data mapping', () => {
  it('maps storyboard groups to Twick panel video sources using video media object ids', () => {
    const result = mapStoryboardsToPanelVideos({
      groups: [
        {
          id: 'storyboard-1',
          stageIndex: 0,
          panels: [
            {
              id: 'panel-1',
              shotId: 'shot-1',
              stageIndex: 0,
              shotIndex: 0,
              imageUrl: null,
              motionPrompt: 'camera move',
              voiceText: 'voice text',
              voiceUrl: null,
              videoUrl: '/video.mp4',
              videoMedia: {
                id: 'media-video-1',
                publicId: 'public-video-1',
                url: '/video.mp4',
                mimeType: 'video/mp4',
                sizeBytes: null,
                width: 1080,
                height: 1920,
                durationMs: 4500,
              },
              errorMessage: null,
              candidates: [],
              pendingCandidateCount: 0,
            },
            {
              id: 'panel-without-video-media',
              shotId: 'shot-2',
              stageIndex: 0,
              shotIndex: 1,
              imageUrl: null,
              motionPrompt: null,
              voiceText: null,
              voiceUrl: null,
              videoUrl: null,
              errorMessage: null,
              candidates: [],
              pendingCandidateCount: 0,
            },
          ],
        },
      ],
    })

    expect(result).toEqual([
      {
        panelId: 'panel-1',
        storyboardId: 'storyboard-1',
        videoMediaObjectId: 'media-video-1',
        duration: 4.5,
        description: 'camera move',
      },
    ])
  })

  it('maps matched voice lines to Twick audio sources using audio media object ids', () => {
    const result = mapVoiceLinesToSources({
      voiceLines: [
        {
          id: 'line-1',
          lineIndex: 0,
          speaker: 'Alice',
          content: 'Hello',
          audioUrl: '/audio.mp3',
          audioDuration: 1.25,
          audioMedia: {
            id: 'media-audio-1',
            durationMs: 1300,
          },
          matchedStoryboardId: 'storyboard-1',
          matchedPanelIndex: 0,
        },
        {
          id: 'line-without-media',
          lineIndex: 1,
          speaker: 'Bob',
          content: 'Skipped',
          audioUrl: '/legacy.mp3',
          audioDuration: 2,
          matchedStoryboardId: null,
          matchedPanelIndex: null,
        },
      ],
    })

    expect(result).toEqual([
      {
        voiceLineId: 'line-1',
        audioMediaObjectId: 'media-audio-1',
        duration: 1.25,
        text: 'Hello',
        speaker: 'Alice',
      },
    ])
  })
})

describe('editor-stage-runtime debounce helper', () => {
  it('runs only the latest scheduled action after the delay and supports cancel', () => {
    vi.useFakeTimers()
    const action = vi.fn()
    const debounced = createDebouncedAction(action, 1000)

    debounced.schedule('first')
    vi.advanceTimersByTime(500)
    debounced.schedule('second')
    vi.advanceTimersByTime(999)
    expect(action).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(action).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledWith('second')

    debounced.schedule('third')
    debounced.cancel()
    vi.advanceTimersByTime(1000)
    expect(action).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })
})

describe('useEditorProjectSync', () => {
  it('waits for voice line data before building and saving the initial Twick project', async () => {
    const { savedProjects } = createEmptyEditorApiMock()
    const hook = renderEditorProjectSyncHook({
      ...defaultHookProps,
      panelVideos: [panelVideo],
      voiceLineSources: [],
      isAssetDataLoaded: false,
    })

    await waitForExpectation(() => {
      expect(apiFetchMock).toHaveBeenCalledWith('/api/novel-promotion/project-1/editor?episodeId=episode-1')
    })
    expect(savedProjects).toEqual([])

    hook.rerender({
      ...defaultHookProps,
      panelVideos: [panelVideo],
      voiceLineSources: [voiceLine],
      isAssetDataLoaded: true,
    })

    await waitForExpectation(() => {
      expect(savedProjects).toHaveLength(1)
      expect(savedProjects[0].tracks.some((track) => track.type === 'audio' && track.elements.length === 1)).toBe(true)
    })
  })

  it('flushes a pending debounced save on window blur and hidden visibilitychange', async () => {
    const { savedProjects } = createEmptyEditorApiMock()
    const hook = renderEditorProjectSyncHook({
      ...defaultHookProps,
      panelVideos: [panelVideo],
      voiceLineSources: [voiceLine],
      isAssetDataLoaded: true,
    })

    await waitForExpectation(() => {
      expect(savedProjects).toHaveLength(1)
    })

    const editedProject = createProject({
      metadata: {
        custom: {
          width: 1920,
          height: 1080,
          fps: 30,
          duration: 4,
          marker: 'blur-save',
        },
      },
    })

    act(() => {
      hook.result.current?.updateProjectData(editedProject)
    })
    expect(savedProjects).toHaveLength(1)

    act(() => {
      window.dispatchEvent(new Event('blur'))
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(savedProjects).toHaveLength(2)
    expect(savedProjects[1]).toEqual(editedProject)

    const secondEdit = createProject({
      metadata: {
        custom: {
          width: 1920,
          height: 1080,
          fps: 30,
          duration: 5,
          marker: 'visibility-save',
        },
      },
    })
    const visibilityStateSpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')

    act(() => {
      hook.result.current?.updateProjectData(secondEdit)
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(savedProjects).toHaveLength(3)
    expect(savedProjects[2]).toEqual(secondEdit)

    visibilityStateSpy.mockRestore()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, EDITOR_PROJECT_SAVE_DEBOUNCE_MS + 20))
    })
    expect(savedProjects).toHaveLength(3)
  })

  it('flushProjectSave saves the transition revision when the caller updates projectData before flushing', async () => {
    const savedProjects: TwickTimelineProject[] = []

    apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') {
        const body = JSON.parse(String(options.body)) as { projectData: TwickTimelineProject }
        savedProjects.push(body.projectData)
        return okJson({
          data: {
            id: 'editor-project-1',
            version: savedProjects.length + 1,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        })
      }

      if (url.includes('/editor?episodeId=')) {
        return okJson({
          data: {
            id: 'editor-project-1',
            version: 1,
            updatedAt: '2026-01-01T00:00:00.000Z',
            projectData: createProject({
              tracks: [{
                id: 'track-video-main',
                type: 'video',
                elements: [
                  { id: 'clip-1', type: 'video', s: 0, e: 4, props: { src: 'mediaobj://video-1' }, metadata: { panelId: 'panel-1', storyboardId: 'storyboard-1' } },
                  { id: 'clip-2', type: 'video', s: 4, e: 8, props: { src: 'mediaobj://video-2' }, metadata: { panelId: 'panel-2', storyboardId: 'storyboard-1' } },
                ],
              }],
            }),
          },
        })
      }

      return okJson({ data: null })
    })

    const hook = renderEditorProjectSyncHook(defaultHookProps)

    await waitForExpectation(() => {
      expect(hook.result.current?.projectData?.tracks[0]?.elements).toHaveLength(2)
    })

    const latestProject = applyTwickTransitionToProject(hook.result.current!.projectData!, {
      fromElementId: 'clip-1',
      toElementId: 'clip-2',
      kind: 'fade',
      duration: 0.5,
    })
    act(() => {
      hook.result.current?.updateProjectData(latestProject)
    })

    await act(async () => {
      await hook.result.current?.flushProjectSave()
    })

    expect(savedProjects).toHaveLength(1)
    expect(savedProjects[0].tracks[0].elements[0]).toEqual(expect.objectContaining({
      transition: {
        toElementId: 'clip-2',
        duration: 0.5,
        kind: 'fade',
      },
    }))
  })

  it('flushProjectSave waits for a pending debounced save to finish before resolving', async () => {
    const savedProjects: TwickTimelineProject[] = []
    const saveDeferred = createDeferred<unknown>()
    let saveRequestStarted = false

    apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') {
        const body = JSON.parse(String(options.body)) as { projectData: TwickTimelineProject }
        saveRequestStarted = true
        await saveDeferred.promise
        savedProjects.push(body.projectData)
        return okJson({
          data: {
            id: 'editor-project-1',
            version: savedProjects.length,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        })
      }

      if (url.includes('/editor?episodeId=')) {
        return okJson({
          data: {
            id: 'editor-project-1',
            version: 1,
            updatedAt: '2026-01-01T00:00:00.000Z',
            projectData: createProject({ metadata: { custom: { marker: 'server' } } }),
          },
        })
      }

      return okJson({ data: null })
    })

    const hook = renderEditorProjectSyncHook(defaultHookProps)

    await waitForExpectation(() => {
      expect(hook.result.current?.projectData).not.toBeNull()
    })

    const editedProject = createProject({ metadata: { custom: { marker: 'flush-waits' } } })
    act(() => {
      hook.result.current?.updateProjectData(editedProject)
    })

    let flushResolved = false
    const flushPromise = hook.result.current?.flushProjectSave().then(() => {
      flushResolved = true
    })

    await waitForExpectation(() => {
      expect(saveRequestStarted).toBe(true)
    })
    expect(flushResolved).toBe(false)
    expect(savedProjects).toHaveLength(0)

    saveDeferred.resolve({})
    await act(async () => {
      await flushPromise
    })

    expect(flushResolved).toBe(true)
    expect(savedProjects).toEqual([editedProject])
  })

  it('flushProjectSave waits for an in-flight save and then persists edits queued during it', async () => {
    const savedProjects: TwickTimelineProject[] = []
    const saveDeferreds = [createDeferred<unknown>(), createDeferred<unknown>()]
    const saveRequests: TwickTimelineProject[] = []

    apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') {
        const requestIndex = saveRequests.length
        const body = JSON.parse(String(options.body)) as { projectData: TwickTimelineProject }
        saveRequests.push(body.projectData)
        await saveDeferreds[requestIndex].promise
        savedProjects.push(body.projectData)
        return okJson({
          data: {
            id: 'editor-project-1',
            version: savedProjects.length + 1,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        })
      }

      if (url.includes('/editor?episodeId=')) {
        return okJson({
          data: {
            id: 'editor-project-1',
            version: 1,
            updatedAt: '2026-01-01T00:00:00.000Z',
            projectData: createProject({ metadata: { custom: { marker: 'server' } } }),
          },
        })
      }

      return okJson({ data: null })
    })

    const hook = renderEditorProjectSyncHook(defaultHookProps)

    await waitForExpectation(() => {
      expect(hook.result.current?.projectData).not.toBeNull()
    })

    const editA = createProject({ metadata: { custom: { marker: 'in-flight-a' } } })
    act(() => {
      hook.result.current?.updateProjectData(editA)
      hook.result.current?.saveNow()
    })

    await waitForExpectation(() => {
      expect(saveRequests).toEqual([editA])
    })

    const editB = createProject({ metadata: { custom: { marker: 'queued-b' } } })
    act(() => {
      hook.result.current?.updateProjectData(editB)
    })

    let flushResolved = false
    const flushPromise = hook.result.current?.flushProjectSave().then(() => {
      flushResolved = true
    })

    await act(async () => {
      await Promise.resolve()
    })
    expect(flushResolved).toBe(false)
    expect(saveRequests).toEqual([editA])
    expect(savedProjects).toEqual([])

    saveDeferreds[0].resolve({})
    await waitForExpectation(() => {
      expect(saveRequests).toEqual([editA, editB])
    })
    expect(flushResolved).toBe(false)
    expect(savedProjects).toEqual([editA])

    saveDeferreds[1].resolve({})
    await act(async () => {
      await flushPromise
    })

    expect(flushResolved).toBe(true)
    expect(savedProjects).toEqual([editA, editB])
  })

  it('flushProjectSave rejects with conflict when local edits cannot be saved during a conflict', async () => {
    const savedProjects: TwickTimelineProject[] = []
    let shouldConflict = true

    apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') {
        if (shouldConflict) {
          return {
            ok: false,
            status: 409,
            json: async () => ({ currentVersion: 2 }),
          }
        }
        const body = JSON.parse(String(options.body)) as { projectData: TwickTimelineProject }
        savedProjects.push(body.projectData)
        return okJson({
          data: {
            id: 'editor-project-1',
            version: savedProjects.length + 2,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        })
      }

      if (url.includes('/editor?episodeId=')) {
        return okJson({
          data: {
            id: 'editor-project-1',
            version: 1,
            updatedAt: '2026-01-01T00:00:00.000Z',
            projectData: createProject({ metadata: { custom: { marker: 'server' } } }),
          },
        })
      }

      return okJson({ data: null })
    })

    const hook = renderEditorProjectSyncHook(defaultHookProps)

    await waitForExpectation(() => {
      expect(hook.result.current?.projectData).not.toBeNull()
    })

    act(() => {
      hook.result.current?.updateProjectData(createProject({ metadata: { custom: { marker: 'conflict-a' } } }))
    })

    await act(async () => {
      await expect(hook.result.current!.flushProjectSave()).rejects.toThrow('conflict')
    })

    await waitForExpectation(() => {
      expect(hook.result.current?.hasConflict).toBe(true)
    })

    shouldConflict = false
    act(() => {
      hook.result.current?.updateProjectData(createProject({ metadata: { custom: { marker: 'conflict-b' } } }))
    })

    await act(async () => {
      await expect(hook.result.current!.flushProjectSave()).rejects.toThrow('conflict')
    })
    expect(savedProjects).toEqual([])
  })

  it('flushProjectSave rejects when local edits are not saved and no save work can be started', async () => {
    createEmptyEditorApiMock()
    const hook = renderEditorProjectSyncHook({
      ...defaultHookProps,
      projectId: null,
      episodeId: null,
    })

    act(() => {
      hook.result.current?.updateProjectData(createProject({ metadata: { custom: { marker: 'no-save-context' } } }))
    })

    await act(async () => {
      await expect(hook.result.current!.flushProjectSave()).rejects.toThrow('unsaved-changes')
    })
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('flushProjectSave rejects when the pending save fails so callers can stop follow-up work', async () => {
    const saveError = new Error('save failed during flush')

    apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') {
        throw saveError
      }

      if (url.includes('/editor?episodeId=')) {
        return okJson({
          data: {
            id: 'editor-project-1',
            version: 1,
            updatedAt: '2026-01-01T00:00:00.000Z',
            projectData: createProject({ metadata: { custom: { marker: 'server' } } }),
          },
        })
      }

      return okJson({ data: null })
    })

    const hook = renderEditorProjectSyncHook(defaultHookProps)

    await waitForExpectation(() => {
      expect(hook.result.current?.projectData).not.toBeNull()
    })

    act(() => {
      hook.result.current?.updateProjectData(createProject({ metadata: { custom: { marker: 'flush-fails' } } }))
    })

    await act(async () => {
      await expect(hook.result.current!.flushProjectSave()).rejects.toThrow('save failed during flush')
    })
  })

  it('flushProjectSave returns immediately when there are no pending changes', async () => {
    createEmptyEditorApiMock()
    const hook = renderEditorProjectSyncHook({
      ...defaultHookProps,
      panelVideos: [],
      voiceLineSources: [],
      isAssetDataLoaded: true,
    })

    await waitForExpectation(() => {
      expect(hook.result.current?.status).toBe('idle')
    })

    await expect(act(async () => {
      await hook.result.current?.flushProjectSave()
    })).resolves.toBeUndefined()
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
  })

  it('reloads server project data and bumps reload revision even when version is unchanged', async () => {
    const serverProjectA = createProject({ metadata: { custom: { marker: 'server-a' } } })
    const serverProjectB = createProject({ metadata: { custom: { marker: 'server-b' } } })
    let fetchCount = 0

    apiFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/editor?episodeId=')) {
        fetchCount += 1
        return okJson({
          data: {
            id: 'editor-project-1',
            version: 7,
            updatedAt: '2026-01-01T00:00:00.000Z',
            projectData: fetchCount === 1 ? serverProjectA : serverProjectB,
          },
        })
      }

      return okJson({ data: null })
    })

    const hook = renderEditorProjectSyncHook(defaultHookProps)

    await waitForExpectation(() => {
      expect(hook.result.current?.projectData).toEqual(serverProjectA)
      expect(hook.result.current?.version).toBe(7)
      expect(hook.result.current?.reloadRevision).toBe(0)
    })

    await act(async () => {
      await hook.result.current?.reloadFromServer()
    })

    expect(hook.result.current?.projectData).toEqual(serverProjectB)
    expect(hook.result.current?.version).toBe(7)
    expect(hook.result.current?.reloadRevision).toBe(1)
  })

  it('enters idle instead of staying loading when assets are loaded but no panel videos exist', async () => {
    createEmptyEditorApiMock()
    const hook = renderEditorProjectSyncHook({
      ...defaultHookProps,
      panelVideos: [],
      voiceLineSources: [],
      isAssetDataLoaded: true,
    })

    await waitForExpectation(() => {
      expect(hook.result.current?.status).toBe('idle')
      expect(hook.result.current?.isLoading).toBe(false)
      expect(hook.result.current?.projectData).toBeNull()
    })
  })
})
