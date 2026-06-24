// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_EDITOR_EXPORT_SETTINGS,
  useEditorExport,
  type UseEditorExportParams,
} from '@/lib/novel-promotion/stages/editor-stage-runtime/useEditorExport'

const apiFetchMock = vi.hoisted(() => vi.fn())

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api-fetch', () => ({
  apiFetch: apiFetchMock,
}))

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = []

function okJson(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

function renderEditorExportHook(overrides: Partial<UseEditorExportParams> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const result: { current: ReturnType<typeof useEditorExport> | null } = { current: null }
  const props: UseEditorExportParams = {
    projectId: 'project-1',
    episodeId: 'episode-1',
    editorProjectId: 'editor-project-1',
    flushProjectSave: vi.fn(async () => undefined),
    pollIntervalMs: 60_000,
    ...overrides,
  }

  function HookHarness() {
    result.current = useEditorExport(props)
    return null
  }

  act(() => {
    root.render(createElement(HookHarness))
  })
  mountedRoots.push({ root, container })
  return { result, props }
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

const settings = {
  ...DEFAULT_EDITOR_EXPORT_SETTINGS,
  width: 720,
  height: 1280,
  bitrate: '6M',
}

afterEach(() => {
  vi.restoreAllMocks()
  apiFetchMock.mockReset()

  for (const { root, container } of mountedRoots.splice(0)) {
    act(() => {
      root.unmount()
    })
    container.remove()
  }
})

describe('useEditorExport', () => {
  it('starts render, polls PROCESSING, then exposes DONE download URL', async () => {
    apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        return okJson({ data: { taskId: 'task-render-1', status: 'queued', settings } })
      }
      if (url.includes('taskId=task-render-1')) {
        return okJson({
          data: {
            task: { id: 'task-render-1', status: 'processing', progress: 42 },
            editorProject: { renderStatus: 'PROCESSING', renderOutputMediaObjectId: null, renderSettings: settings },
          },
        })
      }
      return okJson({})
    })
    const { result, props } = renderEditorExportHook()

    await act(async () => {
      await result.current?.startExport(settings)
    })

    expect(props.flushProjectSave).toHaveBeenCalledTimes(1)
    expect(apiFetchMock).toHaveBeenCalledWith('/api/novel-promotion/project-1/editor/render', expect.objectContaining({ method: 'POST' }))
    await waitForExpectation(() => {
      expect(result.current?.state.phase).toBe('processing')
      expect(result.current?.state.progress).toBe(42)
    })

    apiFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('taskId=task-render-1')) {
        return okJson({
          data: {
            task: {
              id: 'task-render-1',
              status: 'completed',
              progress: 100,
              result: { mediaObjectId: 'media-output-1', outputUrl: '/m/public-output-1' },
            },
            editorProject: { renderStatus: 'DONE', renderOutputMediaObjectId: 'media-output-1', renderSettings: settings },
          },
        })
      }
      return okJson({})
    })

    await act(async () => {
      await result.current?.pollStatus('task-render-1')
    })

    expect(result.current?.state.phase).toBe('done')
    expect(result.current?.state.progress).toBe(100)
    expect(result.current?.state.outputMediaObjectId).toBe('media-output-1')
    expect(result.current?.state.downloadUrl).toBe('/m/public-output-1')
  })

  it('marks FAILED and retries with the previous settings', async () => {
    let postCount = 0
    apiFetchMock.mockImplementation(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        postCount += 1
        return okJson({ data: { taskId: `task-render-${postCount}`, status: 'queued', settings } })
      }
      return okJson({
        data: {
          task: { id: `task-render-${postCount}`, status: 'failed', progress: 20, errorMessage: 'Render exploded' },
          editorProject: { renderStatus: 'FAILED', renderOutputMediaObjectId: null, renderSettings: settings },
        },
      })
    })
    const { result } = renderEditorExportHook()

    await act(async () => {
      await result.current?.startExport(settings)
    })
    await waitForExpectation(() => {
      expect(result.current?.state.phase).toBe('failed')
      expect(result.current?.state.error).toBe('Render exploded')
    })

    await act(async () => {
      await result.current?.retryExport()
    })

    expect(postCount).toBe(2)
    expect(JSON.parse(apiFetchMock.mock.calls.find((call) => call[1]?.method === 'POST')?.[1]?.body as string).settings).toEqual(settings)
  })

  it('cancels active render task through DELETE', async () => {
    apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        return okJson({ data: { taskId: 'task-render-1', status: 'queued', settings } })
      }
      if (options?.method === 'DELETE') {
        return okJson({ data: { success: true, cancelled: true } })
      }
      if (url.includes('taskId=task-render-1')) {
        return okJson({
          data: {
            task: { id: 'task-render-1', status: 'processing', progress: 10 },
            editorProject: { renderStatus: 'PROCESSING', renderOutputMediaObjectId: null, renderSettings: settings },
          },
        })
      }
      return okJson({})
    })
    const { result } = renderEditorExportHook()

    await act(async () => {
      await result.current?.startExport(settings)
    })
    await waitForExpectation(() => expect(result.current?.state.phase).toBe('processing'))

    await act(async () => {
      await result.current?.cancelExport()
    })

    expect(apiFetchMock).toHaveBeenCalledWith('/api/novel-promotion/project-1/editor/render?taskId=task-render-1', { method: 'DELETE' })
    expect(result.current?.state.phase).toBe('cancelled')
  })

  it('surfaces 409 concurrent render conflict', async () => {
    apiFetchMock.mockResolvedValue(okJson({ message: 'Editor render task already in progress' }, 409))
    const { result } = renderEditorExportHook()

    await act(async () => {
      await result.current?.startExport(settings)
    })

    expect(result.current?.state.phase).toBe('failed')
    expect(result.current?.state.isConcurrencyConflict).toBe(true)
    expect(result.current?.state.error).toBe('An export is already in progress.')
  })

  it('adopts active taskId from 409 conflict and resumes polling/cancel ability', async () => {
    apiFetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        return okJson({ message: 'Editor render task already in progress', taskId: 'task-active-1' }, 409)
      }
      if (url.includes('taskId=task-active-1')) {
        return okJson({
          data: {
            task: { id: 'task-active-1', status: 'processing', progress: 35 },
            editorProject: { renderStatus: 'PROCESSING', renderTaskId: 'task-active-1', renderSettings: settings },
          },
        })
      }
      return okJson({})
    })
    const { result } = renderEditorExportHook()

    await act(async () => {
      await result.current?.startExport(settings)
    })

    expect(result.current?.state.taskId).toBe('task-active-1')
    await waitForExpectation(() => {
      expect(result.current?.state.phase).toBe('processing')
      expect(result.current?.state.progress).toBe(35)
    })
    expect(result.current?.isRunning).toBe(true)
  })

  it('restores initial PROCESSING render task and polls it', async () => {
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url.includes('taskId=task-existing-1')) {
        return okJson({
          data: {
            task: { id: 'task-existing-1', status: 'processing', progress: 64 },
            editorProject: { renderStatus: 'PROCESSING', renderTaskId: 'task-existing-1', renderSettings: settings },
          },
        })
      }
      return okJson({})
    })
    const { result } = renderEditorExportHook({
      initialRenderState: {
        renderStatus: 'PROCESSING',
        renderTaskId: 'task-existing-1',
        renderSettings: settings,
      },
    })

    await waitForExpectation(() => {
      expect(result.current?.state.phase).toBe('processing')
      expect(result.current?.state.taskId).toBe('task-existing-1')
      expect(result.current?.state.progress).toBe(64)
    })
  })
})
