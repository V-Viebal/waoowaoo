import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'
import { BILLING_ITEM } from '@/lib/billing/items'
import { ApiError } from '@/lib/api-errors'
import { buildMockRequest } from '../../helpers/request'

type AuthState = {
  userId: string | null
}

type RouteContext = {
  params: Promise<{ projectId: string }>
}

const authState = vi.hoisted<AuthState>(() => ({
  userId: 'user-1',
}))

const submitTaskMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  project: {
    findFirst: vi.fn(),
  },
  novelPromotionEditorProject: {
    findFirst: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return {
    ...actual,
    getAuthSession: vi.fn(async () => (
      authState.userId
        ? { user: { id: authState.userId, name: 'Test User', email: null } }
        : null
    )),
  }
})

vi.mock('@/lib/task/submitter', () => ({
  submitTask: submitTaskMock,
}))

vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
}))

function buildContext(projectId = 'project-1'): RouteContext {
  return { params: Promise.resolve({ projectId }) }
}

function buildEditorAiRequest(path: string, body?: Record<string, unknown>) {
  return buildMockRequest({
    path,
    method: 'POST',
    body: body ?? {
      episodeId: 'episode-1',
      editorProjectId: 'editor-project-1',
      panelIds: ['panel-1'],
    },
  })
}

describe('editor AI route skeletons', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.userId = 'user-1'
    prismaMock.project.findFirst.mockResolvedValue({ id: 'project-1', userId: 'user-1', name: 'Project' })
    prismaMock.novelPromotionEditorProject.findFirst.mockResolvedValue({ id: 'editor-project-1', episodeId: 'episode-1' })
    submitTaskMock.mockResolvedValue({ taskId: 'task-1', async: true, success: true })
  })

  it('smart-cut returns 401 when unauthenticated', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/editor/ai/smart-cut/route')
    authState.userId = null

    const res = await POST(
      buildEditorAiRequest('/api/novel-promotion/project-1/editor/ai/smart-cut'),
      buildContext(),
    )

    expect(res.status).toBe(401)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('smart-cut returns 404 for another user project', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/editor/ai/smart-cut/route')
    prismaMock.project.findFirst.mockResolvedValueOnce(null)

    const res = await POST(
      buildEditorAiRequest('/api/novel-promotion/project-1/editor/ai/smart-cut'),
      buildContext(),
    )

    expect(res.status).toBe(404)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('smart-cut submits a billable editor task and returns data.taskId', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/editor/ai/smart-cut/route')

    const res = await POST(
      buildEditorAiRequest('/api/novel-promotion/project-1/editor/ai/smart-cut'),
      buildContext(),
    )

    expect(res.status).toBe(200)
    const json = await res.json() as { data: { taskId: string } }
    expect(json).toEqual({ data: { taskId: 'task-1' } })
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'project-1', userId: 'user-1' },
    }))
    expect(prismaMock.novelPromotionEditorProject.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'editor-project-1',
        episodeId: 'episode-1',
        episode: { novelPromotionProject: { projectId: 'project-1' } },
      }),
    }))
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.EDITOR_AI_SMART_CUT,
      targetType: 'NovelPromotionEditorProject',
      targetId: 'editor-project-1',
      billingInfo: expect.objectContaining({
        billable: true,
        action: BILLING_ITEM.EDITOR_SMART_CUT,
        model: BILLING_ITEM.EDITOR_SMART_CUT,
        maxFrozenCost: 0.05,
      }),
    }))
  })

  it('smart-cut propagates insufficient balance from task submission as 402', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/editor/ai/smart-cut/route')
    submitTaskMock.mockRejectedValueOnce(new ApiError('INSUFFICIENT_BALANCE', {
      message: 'Insufficient balance',
      required: 0.05,
      available: 0,
    }))

    const res = await POST(
      buildEditorAiRequest('/api/novel-promotion/project-1/editor/ai/smart-cut'),
      buildContext(),
    )

    expect(res.status).toBe(402)
    const json = await res.json() as Record<string, unknown>
    expect(json.code).toBe('INSUFFICIENT_BALANCE')
  })

  it('transition returns 401 when unauthenticated', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/editor/ai/transition/route')
    authState.userId = null

    const res = await POST(
      buildEditorAiRequest('/api/novel-promotion/project-1/editor/ai/transition'),
      buildContext(),
    )

    expect(res.status).toBe(401)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('transition returns 404 for another user project', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/editor/ai/transition/route')
    prismaMock.project.findFirst.mockResolvedValueOnce(null)

    const res = await POST(
      buildEditorAiRequest('/api/novel-promotion/project-1/editor/ai/transition'),
      buildContext(),
    )

    expect(res.status).toBe(404)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('transition submits a free editor task and returns data.taskId', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/editor/ai/transition/route')

    const res = await POST(
      buildEditorAiRequest('/api/novel-promotion/project-1/editor/ai/transition'),
      buildContext(),
    )

    expect(res.status).toBe(200)
    const json = await res.json() as { data: { taskId: string } }
    expect(json).toEqual({ data: { taskId: 'task-1' } })
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_TYPE.EDITOR_AI_TRANSITION,
      targetType: 'NovelPromotionEditorProject',
      targetId: 'editor-project-1',
      billingInfo: null,
    }))
  })
})
