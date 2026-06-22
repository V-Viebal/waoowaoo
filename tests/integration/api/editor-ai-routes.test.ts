import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskBillingInfo, type TaskType } from '@/lib/task/types'
import { BILLING_ITEM, type BillingItemKey } from '@/lib/billing/items'
import { buildDefaultTaskBillingInfo } from '@/lib/billing/task-policy'
import { ApiError } from '@/lib/api-errors'
import { buildMockRequest } from '../../helpers/request'

type AuthState = {
  userId: string | null
}

type RouteContext = {
  params: Promise<{ projectId: string }>
}

type RouteModule = {
  POST: (request: ReturnType<typeof buildMockRequest>, context: RouteContext) => Promise<Response>
}

type RouteCase = {
  name: string
  path: string
  load: () => Promise<RouteModule>
  taskType: TaskType
  action: string
  body?: Record<string, unknown>
  expectedBilling?: {
    item?: BillingItemKey
    quantity: number
    unit: Extract<TaskBillingInfo, { billable: true }>['unit']
    maxFrozenCost?: number
    apiType?: Extract<TaskBillingInfo, { billable: true }>['apiType']
  } | null
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

function defaultBody(overrides: Record<string, unknown> = {}) {
  return {
    episodeId: 'episode-1',
    editorProjectId: 'editor-project-1',
    panelIds: ['panel-1'],
    ...overrides,
  }
}

function buildEditorAiRequest(path: string, body?: Record<string, unknown>, headers?: Record<string, string>) {
  return buildMockRequest({
    path,
    method: 'POST',
    body: body ?? defaultBody(),
    headers,
  })
}

function expectDefaultBillingForPayload(taskType: TaskType, payload: Record<string, unknown>, expected: NonNullable<RouteCase['expectedBilling']>) {
  const billingInfo = buildDefaultTaskBillingInfo(taskType, payload) as Extract<TaskBillingInfo, { billable: true }> | null
  expect(billingInfo).toBeTruthy()
  expect(billingInfo).toEqual(expect.objectContaining({
    billable: true,
    apiType: expected.apiType || 'editor',
    quantity: expected.quantity,
    unit: expected.unit,
    ...(expected.item ? { action: expected.item, model: expected.item } : {}),
  }))
  if (typeof expected.maxFrozenCost === 'number') {
    expect(billingInfo?.maxFrozenCost).toBeCloseTo(expected.maxFrozenCost, 8)
  }
}

const routeCases: RouteCase[] = [
  {
    name: 'smart-cut',
    path: '/api/novel-promotion/project-1/editor/ai/smart-cut',
    load: () => import('@/app/api/novel-promotion/[projectId]/editor/ai/smart-cut/route'),
    taskType: TASK_TYPE.EDITOR_AI_SMART_CUT,
    action: 'smart-cut',
    expectedBilling: {
      item: BILLING_ITEM.EDITOR_SMART_CUT,
      quantity: 1,
      unit: 'call',
      maxFrozenCost: 0.05,
    },
  },
  {
    name: 'caption',
    path: '/api/novel-promotion/project-1/editor/ai/caption',
    load: () => import('@/app/api/novel-promotion/[projectId]/editor/ai/caption/route'),
    taskType: TASK_TYPE.EDITOR_AI_CAPTION,
    action: 'caption',
    body: defaultBody({ durationMinutes: 2.5 }),
    expectedBilling: {
      item: BILLING_ITEM.EDITOR_CAPTION_GENERATE,
      quantity: 2.5,
      unit: 'minute',
      maxFrozenCost: 0.05,
    },
  },
  {
    name: 'enhance restore',
    path: '/api/novel-promotion/project-1/editor/ai/enhance',
    load: () => import('@/app/api/novel-promotion/[projectId]/editor/ai/enhance/route'),
    taskType: TASK_TYPE.EDITOR_AI_ENHANCE,
    action: 'enhance',
    body: defaultBody({ enhanceType: 'restore', durationSeconds: 7 }),
    expectedBilling: {
      item: BILLING_ITEM.EDITOR_AI_ENHANCE_RESTORE,
      quantity: 7,
      unit: 'second',
      maxFrozenCost: 0.105,
    },
  },
  {
    name: 'enhance smart crop',
    path: '/api/novel-promotion/project-1/editor/ai/enhance',
    load: () => import('@/app/api/novel-promotion/[projectId]/editor/ai/enhance/route'),
    taskType: TASK_TYPE.EDITOR_AI_ENHANCE,
    action: 'enhance',
    body: defaultBody({ enhanceType: 'smart_crop', durationSeconds: 6 }),
    expectedBilling: {
      item: BILLING_ITEM.EDITOR_AI_ENHANCE_SMART_CROP,
      quantity: 6,
      unit: 'second',
      maxFrozenCost: 0.06,
    },
  },
  {
    name: 'voice-optimize durationSeconds',
    path: '/api/novel-promotion/project-1/editor/ai/voice-optimize',
    load: () => import('@/app/api/novel-promotion/[projectId]/editor/ai/voice-optimize/route'),
    taskType: TASK_TYPE.EDITOR_AI_VOICE_OPTIMIZE,
    action: 'voice-optimize',
    body: defaultBody({ durationSeconds: 9 }),
    expectedBilling: {
      quantity: 9,
      unit: 'second',
      apiType: 'voice',
    },
  },
  {
    name: 'voice-optimize maxSeconds fallback',
    path: '/api/novel-promotion/project-1/editor/ai/voice-optimize',
    load: () => import('@/app/api/novel-promotion/[projectId]/editor/ai/voice-optimize/route'),
    taskType: TASK_TYPE.EDITOR_AI_VOICE_OPTIMIZE,
    action: 'voice-optimize',
    body: defaultBody({ maxSeconds: 4 }),
    expectedBilling: {
      quantity: 4,
      unit: 'second',
      apiType: 'voice',
    },
  },
  {
    name: 'transition',
    path: '/api/novel-promotion/project-1/editor/ai/transition',
    load: () => import('@/app/api/novel-promotion/[projectId]/editor/ai/transition/route'),
    taskType: TASK_TYPE.EDITOR_AI_TRANSITION,
    action: 'transition',
    expectedBilling: null,
  },
]

describe('editor AI route skeletons', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.userId = 'user-1'
    prismaMock.project.findFirst.mockResolvedValue({ id: 'project-1', userId: 'user-1', name: 'Project' })
    prismaMock.novelPromotionEditorProject.findFirst.mockResolvedValue({ id: 'editor-project-1', episodeId: 'episode-1' })
    submitTaskMock.mockResolvedValue({ taskId: 'task-1', async: true, success: true })
  })

  it.each(routeCases)('$name returns 401 when unauthenticated', async (routeCase) => {
    const { POST } = await routeCase.load()
    authState.userId = null

    const res = await POST(
      buildEditorAiRequest(routeCase.path, routeCase.body),
      buildContext(),
    )

    expect(res.status).toBe(401)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it.each(routeCases)('$name returns 404 for another user project', async (routeCase) => {
    const { POST } = await routeCase.load()
    prismaMock.project.findFirst.mockResolvedValueOnce(null)

    const res = await POST(
      buildEditorAiRequest(routeCase.path, routeCase.body),
      buildContext(),
    )

    expect(res.status).toBe(404)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it.each(routeCases)('$name returns 404 for another project editorProject', async (routeCase) => {
    const { POST } = await routeCase.load()
    prismaMock.novelPromotionEditorProject.findFirst.mockResolvedValueOnce(null)

    const res = await POST(
      buildEditorAiRequest(routeCase.path, routeCase.body),
      buildContext(),
    )

    expect(res.status).toBe(404)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it.each(routeCases)('$name submits the expected task and billing payload', async (routeCase) => {
    const { POST } = await routeCase.load()
    const body = routeCase.body || defaultBody()

    const res = await POST(
      buildEditorAiRequest(routeCase.path, body, { 'x-request-id': `req-${routeCase.name}` }),
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
      requestId: `req-${routeCase.name}`,
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: routeCase.taskType,
      targetType: 'NovelPromotionEditorProject',
      targetId: 'editor-project-1',
      dedupeKey: `editor-ai:${routeCase.action}:editor-project-1:req-${routeCase.name}`,
      billingInfo: routeCase.expectedBilling?.item
        ? expect.objectContaining({
          billable: true,
          action: routeCase.expectedBilling.item,
          model: routeCase.expectedBilling.item,
          quantity: routeCase.expectedBilling.quantity,
          unit: routeCase.expectedBilling.unit,
          maxFrozenCost: routeCase.expectedBilling.maxFrozenCost,
        })
        : null,
      payload: expect.objectContaining({
        ...body,
        episodeId: 'episode-1',
        editorProjectId: 'editor-project-1',
        action: routeCase.action,
      }),
    }))

    if (routeCase.expectedBilling) {
      expectDefaultBillingForPayload(routeCase.taskType, body, routeCase.expectedBilling)
    } else {
      expect(buildDefaultTaskBillingInfo(routeCase.taskType, body)).toBeNull()
    }
  })

  it('smart-cut propagates insufficient balance from task submission as 402', async () => {
    const routeCase = routeCases[0]
    const { POST } = await routeCase.load()
    submitTaskMock.mockRejectedValueOnce(new ApiError('INSUFFICIENT_BALANCE', {
      message: 'Insufficient balance',
      required: 0.05,
      available: 0,
    }))

    const res = await POST(
      buildEditorAiRequest(routeCase.path),
      buildContext(),
    )

    expect(res.status).toBe(402)
    const json = await res.json() as Record<string, unknown>
    expect(json.code).toBe('INSUFFICIENT_BALANCE')
  })

  it('uses the same dedupeKey for duplicate requestId submissions so submitTask can return the existing task without another freeze/create', async () => {
    const routeCase = routeCases[0]
    const { POST } = await routeCase.load()
    submitTaskMock
      .mockResolvedValueOnce({ taskId: 'task-1', async: true, success: true, deduped: false })
      .mockResolvedValueOnce({ taskId: 'task-1', async: true, success: true, deduped: true })
    const body = defaultBody({ requestId: 'client-request-1' })

    const first = await POST(buildEditorAiRequest(routeCase.path, body), buildContext())
    const second = await POST(buildEditorAiRequest(routeCase.path, body), buildContext())

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await first.json()).toEqual({ data: { taskId: 'task-1' } })
    expect(await second.json()).toEqual({ data: { taskId: 'task-1' } })
    expect(submitTaskMock).toHaveBeenCalledTimes(2)
    expect(submitTaskMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      dedupeKey: 'editor-ai:smart-cut:editor-project-1:client-request-1',
    }))
    expect(submitTaskMock.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      dedupeKey: 'editor-ai:smart-cut:editor-project-1:client-request-1',
    }))
  })
})
