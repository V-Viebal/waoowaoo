import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS, TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'
import { BILLING_ITEM } from '@/lib/billing/items'
import { buildDefaultTaskBillingInfo } from '@/lib/billing/task-policy'
import { buildMockRequest } from '../../helpers/request'

type RouteContext = { params: Promise<{ projectId: string }> }

const authState = vi.hoisted(() => ({ userId: 'user-1' as string | null }))
const submitTaskMock = vi.hoisted(() => vi.fn())
const cancelTaskMock = vi.hoisted(() => vi.fn())
const getTaskByIdMock = vi.hoisted(() => vi.fn())
const removeTaskJobMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  project: { findFirst: vi.fn() },
  task: { findFirst: vi.fn() },
  novelPromotionEditorProject: {
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return {
    ...actual,
    getAuthSession: vi.fn(async () => authState.userId
      ? { user: { id: authState.userId, name: 'Test User', email: null } }
      : null),
  }
})
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/task/service', () => ({
  cancelTask: cancelTaskMock,
  getTaskById: getTaskByIdMock,
}))
vi.mock('@/lib/task/queues', () => ({ removeTaskJob: removeTaskJobMock }))
vi.mock('@/lib/task/resolve-locale', () => ({ resolveRequiredTaskLocale: vi.fn(() => 'zh') }))

function buildContext(projectId = 'project-1'): RouteContext {
  return { params: Promise.resolve({ projectId }) }
}

function buildProjectData() {
  return {
    version: 1,
    metadata: { custom: { width: 1080, height: 1920, fps: 24, duration: 75 } },
    tracks: [
      { id: 'track-video', type: 'video', elements: [{ id: 'video-1', type: 'video', s: 0, e: 90, props: { src: 'mediaobj://video-1' } }] },
    ],
  }
}

function buildPostRequest(body: Record<string, unknown> = {}) {
  return buildMockRequest({
    path: '/api/novel-promotion/project-1/editor/render',
    method: 'POST',
    body: {
      episodeId: 'episode-1',
      editorProjectId: 'editor-project-1',
      settings: { width: 720, height: 1280, fps: 30, format: 'mp4' },
      ...body,
    },
    headers: { 'x-request-id': 'req-render-1' },
  })
}

describe('editor render route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.userId = 'user-1'
    prismaMock.project.findFirst.mockResolvedValue({ id: 'project-1', userId: 'user-1', name: 'Project' })
    prismaMock.novelPromotionEditorProject.findFirst.mockResolvedValue({
      id: 'editor-project-1',
      episodeId: 'episode-1',
      projectData: buildProjectData(),
      renderStatus: 'IDLE',
      renderTaskId: null,
      renderOutputMediaObjectId: null,
      renderSettings: null,
    })
    prismaMock.task.findFirst.mockResolvedValue(null)
    prismaMock.novelPromotionEditorProject.update.mockResolvedValue({})
    prismaMock.novelPromotionEditorProject.updateMany.mockResolvedValue({ count: 1 })
    submitTaskMock.mockResolvedValue({ success: true, async: true, taskId: 'task-render-1', status: TASK_STATUS.QUEUED, deduped: false })
    getTaskByIdMock.mockResolvedValue({
      id: 'task-render-1',
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.EDITOR_RENDER,
      targetType: 'NovelPromotionEditorProject',
      targetId: 'editor-project-1',
      status: TASK_STATUS.QUEUED,
      progress: 0,
      payload: {},
      errorCode: null,
      errorMessage: null,
    })
    cancelTaskMock.mockResolvedValue({
      cancelled: true,
      task: {
        id: 'task-render-1',
        userId: 'user-1',
        projectId: 'project-1',
        episodeId: 'episode-1',
        type: TASK_TYPE.EDITOR_RENDER,
        targetType: 'NovelPromotionEditorProject',
        targetId: 'editor-project-1',
        status: TASK_STATUS.CANCELED,
        errorCode: 'TASK_CANCELLED',
        errorMessage: 'Task cancelled by user',
      },
    })
    removeTaskJobMock.mockResolvedValue(true)
  })

  it('returns 401 when unauthenticated', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/editor/render/route')
    authState.userId = null

    const res = await POST(buildPostRequest(), buildContext())

    expect(res.status).toBe(401)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('returns 404 for another user project', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/editor/render/route')
    prismaMock.project.findFirst.mockResolvedValueOnce(null)

    const res = await POST(buildPostRequest(), buildContext())

    expect(res.status).toBe(404)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('submits editor_render with per-minute editor_export billing payload', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/editor/render/route')

    const res = await POST(buildPostRequest(), buildContext())

    expect(res.status).toBe(200)
    const json = await res.json() as { data: { taskId: string; durationMinutes: number } }
    expect(json.data.taskId).toBe('task-render-1')
    expect(json.data.durationMinutes).toBeCloseTo(1.5, 8)
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.EDITOR_RENDER,
      targetType: 'NovelPromotionEditorProject',
      targetId: 'editor-project-1',
      payload: expect.objectContaining({
        editorProjectId: 'editor-project-1',
        durationSeconds: 90,
        durationMinutes: 1.5,
        quantity: 1.5,
        route: 'editor-render',
      }),
    }))
    const submitArg = submitTaskMock.mock.calls[0][0]
    const billingInfo = buildDefaultTaskBillingInfo(TASK_TYPE.EDITOR_RENDER, submitArg.payload) as Extract<TaskBillingInfo, { billable: true }>
    expect(billingInfo).toEqual(expect.objectContaining({
      apiType: 'editor',
      model: BILLING_ITEM.EDITOR_EXPORT,
      action: BILLING_ITEM.EDITOR_EXPORT,
      unit: 'minute',
      quantity: 1.5,
      maxFrozenCost: 0.015,
    }))
    expect(prismaMock.novelPromotionEditorProject.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'editor-project-1',
        episodeId: 'episode-1',
        renderStatus: { in: ['IDLE', 'FAILED', 'DONE'] },
      },
      data: expect.objectContaining({
        renderStatus: 'PROCESSING',
        renderTaskId: null,
      }),
    })
    expect(prismaMock.novelPromotionEditorProject.update).toHaveBeenCalledWith({
      where: { id: 'editor-project-1' },
      data: expect.objectContaining({
        renderStatus: 'PROCESSING',
        renderTaskId: 'task-render-1',
      }),
    })
  })

  it('binds renderTaskId even when submitTask returns a deduped task', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/editor/render/route')
    submitTaskMock.mockResolvedValueOnce({
      success: true,
      async: true,
      taskId: 'task-render-deduped',
      status: TASK_STATUS.QUEUED,
      deduped: true,
    })

    const res = await POST(buildPostRequest({ requestId: 'request-deduped' }), buildContext())

    expect(res.status).toBe(200)
    const json = await res.json() as { data: { taskId: string; deduped: boolean } }
    expect(json.data.taskId).toBe('task-render-deduped')
    expect(json.data.deduped).toBe(true)
    expect(prismaMock.novelPromotionEditorProject.update).toHaveBeenCalledWith({
      where: { id: 'editor-project-1' },
      data: expect.objectContaining({
        renderStatus: 'PROCESSING',
        renderTaskId: 'task-render-deduped',
      }),
    })
  })

  it('rejects concurrent active render tasks for the same editor project when the atomic render lock is held', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/editor/render/route')
    prismaMock.novelPromotionEditorProject.updateMany.mockResolvedValueOnce({ count: 0 })
    prismaMock.task.findFirst.mockResolvedValueOnce({ id: 'task-active', status: TASK_STATUS.PROCESSING })

    const res = await POST(buildPostRequest(), buildContext())

    expect(res.status).toBe(409)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('allows only one of two concurrent POST requests to create a render task', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/editor/render/route')
    prismaMock.novelPromotionEditorProject.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
    prismaMock.task.findFirst.mockResolvedValueOnce({ id: 'task-render-1', status: TASK_STATUS.QUEUED })

    const [first, second] = await Promise.all([
      POST(buildPostRequest({ requestId: 'request-a' }), buildContext()),
      POST(buildPostRequest({ requestId: 'request-b' }), buildContext()),
    ])

    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([200, 409])
    expect(submitTaskMock).toHaveBeenCalledTimes(1)
  })

  it('returns task status for an owned render task', async () => {
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/editor/render/route')

    const res = await GET(buildMockRequest({
      path: '/api/novel-promotion/project-1/editor/render',
      method: 'GET',
      query: { taskId: 'task-render-1' },
    }), buildContext())

    expect(res.status).toBe(200)
    const json = await res.json() as { data: { task: { id: string }; editorProject: { id: string } } }
    expect(json.data.task.id).toBe('task-render-1')
    expect(json.data.editorProject.id).toBe('editor-project-1')
  })

  it('uses the 0.01 minute minimum for very short render billing', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/editor/render/route')
    prismaMock.novelPromotionEditorProject.findFirst.mockResolvedValueOnce({
      id: 'editor-project-1',
      episodeId: 'episode-1',
      projectData: {
        version: 1,
        metadata: { custom: { width: 1080, height: 1920, fps: 24, duration: 0.2 } },
        tracks: [
          { id: 'track-video', type: 'video', elements: [{ id: 'video-1', type: 'video', s: 0, e: 0.3, props: { src: 'mediaobj://video-1' } }] },
        ],
      },
      renderStatus: 'IDLE',
      renderTaskId: null,
      renderOutputMediaObjectId: null,
      renderSettings: null,
    })

    const res = await POST(buildPostRequest(), buildContext())

    expect(res.status).toBe(200)
    const submitArg = submitTaskMock.mock.calls[0][0]
    expect(submitArg.payload.durationSeconds).toBe(0.3)
    expect(submitArg.payload.durationMinutes).toBe(0.01)
    const billingInfo = buildDefaultTaskBillingInfo(TASK_TYPE.EDITOR_RENDER, submitArg.payload) as Extract<TaskBillingInfo, { billable: true }>
    expect(billingInfo.quantity).toBe(0.01)
    expect(billingInfo.maxFrozenCost).toBe(0.0001)
  })

  it('cancels processing render task and moves render status to FAILED for retry', async () => {
    const { DELETE } = await import('@/app/api/novel-promotion/[projectId]/editor/render/route')
    getTaskByIdMock.mockResolvedValueOnce({
      id: 'task-render-1',
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.EDITOR_RENDER,
      targetType: 'NovelPromotionEditorProject',
      targetId: 'editor-project-1',
      status: TASK_STATUS.PROCESSING,
      progress: 50,
      payload: {},
      errorCode: null,
      errorMessage: null,
    })

    const res = await DELETE(buildMockRequest({
      path: '/api/novel-promotion/project-1/editor/render',
      method: 'DELETE',
      query: { taskId: 'task-render-1' },
    }), buildContext())

    expect(res.status).toBe(200)
    expect(prismaMock.novelPromotionEditorProject.updateMany).toHaveBeenCalledWith({
      where: { id: 'editor-project-1', renderTaskId: 'task-render-1' },
      data: { renderStatus: 'FAILED', renderTaskId: 'task-render-1' },
    })
  })

  it('cancels queued render task, removes BullMQ job, and resets render status', async () => {
    const { DELETE } = await import('@/app/api/novel-promotion/[projectId]/editor/render/route')

    const res = await DELETE(buildMockRequest({
      path: '/api/novel-promotion/project-1/editor/render',
      method: 'DELETE',
      query: { taskId: 'task-render-1' },
    }), buildContext())

    expect(res.status).toBe(200)
    expect(cancelTaskMock).toHaveBeenCalledWith('task-render-1')
    expect(removeTaskJobMock).toHaveBeenCalledWith('task-render-1')
    expect(prismaMock.novelPromotionEditorProject.updateMany).toHaveBeenCalledWith({
      where: { id: 'editor-project-1', renderTaskId: 'task-render-1' },
      data: { renderStatus: 'IDLE', renderTaskId: null },
    })
  })
})
