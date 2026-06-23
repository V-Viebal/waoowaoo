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
  novelPromotionPanel: {
    count: vi.fn(),
  },
  novelPromotionVoiceLine: {
    findMany: vi.fn(),
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
    body: defaultBody({ durationMinutes: 0.01 }),
    expectedBilling: {
      item: BILLING_ITEM.EDITOR_CAPTION_GENERATE,
      quantity: 0.07,
      unit: 'minute',
      maxFrozenCost: 0.0014,
    },
  },
  {
    name: 'enhance smart crop',
    path: '/api/novel-promotion/project-1/editor/ai/enhance',
    load: () => import('@/app/api/novel-promotion/[projectId]/editor/ai/enhance/route'),
    taskType: TASK_TYPE.EDITOR_AI_ENHANCE,
    action: 'enhance',
    body: defaultBody({ enhanceType: 'smart_crop', selectedElementId: 'video-1', durationSeconds: 6 }),
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
    body: defaultBody({ voiceLineId: 'voice-1', durationSeconds: 9 }),
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
    body: defaultBody({ voiceLineId: 'voice-1', maxSeconds: 4 }),
    expectedBilling: {
      quantity: 5,
      unit: 'second',
      apiType: 'voice',
    },
  },
]

describe('editor AI route skeletons', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.userId = 'user-1'
    prismaMock.project.findFirst.mockResolvedValue({ id: 'project-1', userId: 'user-1', name: 'Project' })
    prismaMock.novelPromotionEditorProject.findFirst.mockResolvedValue({
      id: 'editor-project-1',
      episodeId: 'episode-1',
      projectData: {
        version: 1,
        metadata: { custom: { width: 720, height: 1280, duration: 6 } },
        tracks: [
          { id: 'track-video-main', type: 'video', elements: [
            { id: 'video-1', type: 'video', s: 0, e: 6, props: { src: 'mediaobj://video-1' }, metadata: { panelId: 'panel-1', storyboardId: 'storyboard-1' } },
            { id: 'video-2', type: 'video', s: 6, e: 10, props: { src: 'mediaobj://video-2' }, metadata: { panelId: 'panel-2', storyboardId: 'storyboard-2' } },
          ] }
        ],
      },
    })
    prismaMock.novelPromotionPanel.count.mockResolvedValue(1)
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValue([{
      id: 'voice-1',
      content: 'hello',
      audioDuration: 4200,
      audioMedia: { durationMs: 4200 },
    }])
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValue({
      id: 'voice-1',
      content: 'hello',
      audioDuration: 4200,
      audioMedia: { durationMs: 4200 },
    })
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
    const expectedPayload = routeCase.name === 'caption'
      ? { ...body, durationMinutes: routeCase.expectedBilling?.quantity }
      : routeCase.name.startsWith('voice-optimize')
        ? { ...body, voiceLineId: 'voice-1', content: 'hello', durationSeconds: routeCase.expectedBilling?.quantity, maxSeconds: routeCase.expectedBilling?.quantity }
        : routeCase.name.startsWith('enhance')
          ? { ...body, durationSeconds: routeCase.expectedBilling?.quantity, sourcePanelId: 'panel-1', originalSrc: 'mediaobj://video-1' }
          : body

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
      dedupeKey: routeCase.name.startsWith('voice-optimize')
        ? expect.stringMatching(/^editor-ai:voice-optimize:editor-project-1:no-element:[a-f0-9]{16}:[a-f0-9]{12}:1$/)
        : `editor-ai:${routeCase.action}:editor-project-1:req-${routeCase.name}`,
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
        ...expectedPayload,
        episodeId: 'episode-1',
        editorProjectId: 'editor-project-1',
        action: routeCase.action,
      }),
    }))

    if (routeCase.expectedBilling) {
      expectDefaultBillingForPayload(routeCase.taskType, expectedPayload, routeCase.expectedBilling)
    } else {
      expect(buildDefaultTaskBillingInfo(routeCase.taskType, body)).toBeNull()
    }
  })

  it('smart-cut returns 400 and does not enqueue when the episode has no video panels', async () => {
    const routeCase = routeCases[0]
    const { POST } = await routeCase.load()
    prismaMock.novelPromotionPanel.count.mockResolvedValueOnce(0)

    const res = await POST(
      buildEditorAiRequest(routeCase.path),
      buildContext(),
    )

    expect(res.status).toBe(400)
    const json = await res.json() as Record<string, unknown>
    expect(json.code).toBe('INVALID_PARAMS')
    expect(json.message).toBe('SMART_CUT_NO_VIDEO_PANELS')
    expect(prismaMock.novelPromotionPanel.count).toHaveBeenCalledWith({
      where: {
        videoMediaId: { not: null },
        storyboard: { episodeId: 'episode-1' },
        id: { in: ['panel-1'] },
      },
    })
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('caption returns 400 and does not enqueue when the episode has no voice-line text', async () => {
    const routeCase = routeCases[1]
    const { POST } = await routeCase.load()
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValueOnce([{ id: 'voice-1', content: '   ', audioDuration: 2000, audioMedia: null }])

    const res = await POST(
      buildEditorAiRequest(routeCase.path, routeCase.body),
      buildContext(),
    )

    expect(res.status).toBe(400)
    const json = await res.json() as Record<string, unknown>
    expect(json.code).toBe('INVALID_PARAMS')
    expect(json.message).toBe('CAPTION_NO_VOICE_LINES')
    expect(prismaMock.novelPromotionVoiceLine.findMany).toHaveBeenCalledWith({
      where: { episodeId: 'episode-1' },
      select: {
        id: true,
        content: true,
        audioDuration: true,
        audioMedia: {
          select: {
            durationMs: true,
          },
        },
      },
      orderBy: { lineIndex: 'asc' },
    })
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('caption returns 400 instead of 500 when all voice-line content is nullable or blank', async () => {
    const routeCase = routeCases[1]
    const { POST } = await routeCase.load()
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValueOnce([
      { id: 'voice-1', content: null, audioDuration: 4200, audioMedia: { durationMs: 4200 } },
      { id: 'voice-2', content: '   ', audioDuration: 2800, audioMedia: { durationMs: 2800 } },
    ])

    const res = await POST(
      buildEditorAiRequest(routeCase.path, routeCase.body),
      buildContext(),
    )

    expect(res.status).toBe(400)
    const json = await res.json() as Record<string, unknown>
    expect(json.code).toBe('INVALID_PARAMS')
    expect(json.message).toBe('CAPTION_NO_VOICE_LINES')
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('enhance returns 400 and does not enqueue when selected video is missing or invalid', async () => {
    const routeCase = routeCases.find((item) => item.name === 'enhance smart crop')!
    const { POST } = await routeCase.load()

    const res = await POST(
      buildEditorAiRequest(routeCase.path, defaultBody({ enhanceType: 'smart_crop', selectedElementId: 'audio-1', durationSeconds: 6 })),
      buildContext(),
    )

    expect(res.status).toBe(400)
    const json = await res.json() as Record<string, unknown>
    expect(json.code).toBe('INVALID_PARAMS')
    expect(json.message).toBe('ENHANCE_VIDEO_ELEMENT_NOT_FOUND')
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('enhance restore returns 400 at route layer and does not enqueue or freeze billing', async () => {
    const routeCase = routeCases.find((item) => item.name === 'enhance smart crop')!
    const { POST } = await routeCase.load()

    const res = await POST(
      buildEditorAiRequest(routeCase.path, defaultBody({ enhanceType: 'restore', selectedElementId: 'video-1', durationSeconds: 7 })),
      buildContext(),
    )

    expect(res.status).toBe(400)
    const json = await res.json() as Record<string, unknown>
    expect(json.code).toBe('INVALID_PARAMS')
    expect(json.message).toBe('ENHANCE_RESTORE_UNAVAILABLE')
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('voice-optimize returns 400 and does not enqueue when voiceLineId is missing', async () => {
    const routeCase = routeCases.find((item) => item.name === 'voice-optimize durationSeconds')!
    const { POST } = await routeCase.load()

    const res = await POST(
      buildEditorAiRequest(routeCase.path, defaultBody({ durationSeconds: 9 })),
      buildContext(),
    )

    expect(res.status).toBe(400)
    const json = await res.json() as Record<string, unknown>
    expect(json.code).toBe('INVALID_PARAMS')
    expect(json.message).toBe('voiceLineId is required')
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('voice-optimize returns 400 and does not enqueue for an invalid voiceLineId', async () => {
    const routeCase = routeCases.find((item) => item.name === 'voice-optimize durationSeconds')!
    const { POST } = await routeCase.load()
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(null)

    const res = await POST(
      buildEditorAiRequest(routeCase.path, defaultBody({ voiceLineId: 'missing-voice', durationSeconds: 9 })),
      buildContext(),
    )

    expect(res.status).toBe(400)
    const json = await res.json() as Record<string, unknown>
    expect(json.code).toBe('INVALID_PARAMS')
    expect(json.message).toBe('VOICE_OPTIMIZE_NO_VOICE_LINE')
    expect(prismaMock.novelPromotionVoiceLine.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'missing-voice',
        episodeId: 'episode-1',
      },
      select: {
        id: true,
        content: true,
        audioDuration: true,
        audioMedia: { select: { durationMs: true } },
      },
    })
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('voice-optimize returns 400 when content is explicitly blank and does not fall back to the original voice line', async () => {
    const routeCase = routeCases.find((item) => item.name === 'voice-optimize durationSeconds')!
    const { POST } = await routeCase.load()

    const res = await POST(
      buildEditorAiRequest(routeCase.path, defaultBody({ voiceLineId: 'voice-1', content: '   ', durationSeconds: 9 })),
      buildContext(),
    )

    expect(res.status).toBe(400)
    const json = await res.json() as Record<string, unknown>
    expect(json.code).toBe('INVALID_PARAMS')
    expect(json.message).toBe('VOICE_OPTIMIZE_EMPTY_TEXT')
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('voice-optimize returns 400 when speaker is explicitly blank and does not fall back to the original voice line', async () => {
    const routeCase = routeCases.find((item) => item.name === 'voice-optimize durationSeconds')!
    const { POST } = await routeCase.load()

    const res = await POST(
      buildEditorAiRequest(routeCase.path, defaultBody({ voiceLineId: 'voice-1', speaker: '   ', durationSeconds: 9 })),
      buildContext(),
    )

    expect(res.status).toBe(400)
    const json = await res.json() as Record<string, unknown>
    expect(json.code).toBe('INVALID_PARAMS')
    expect(json.message).toBe('VOICE_OPTIMIZE_EMPTY_SPEAKER')
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('voice-optimize billing uses max(client, db, estimated text) and ceil so pre-freeze is not underestimated', async () => {
    const routeCase = routeCases.find((item) => item.name === 'voice-optimize durationSeconds')!
    const { POST } = await routeCase.load()
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce({
      id: 'voice-1',
      content: 'old',
      audioDuration: 2600,
      audioMedia: { durationMs: 2600 },
    })
    const longContent = '这是一段被用户改长的文案'.repeat(4)

    const res = await POST(
      buildEditorAiRequest(routeCase.path, defaultBody({ voiceLineId: 'voice-1', content: longContent, durationSeconds: 2.6, maxSeconds: 2 })),
      buildContext(),
    )

    expect(res.status).toBe(200)
    const submit = submitTaskMock.mock.calls[0]?.[0]
    const expectedMaxSeconds = Math.ceil(Math.max(2.6, 2, 2.6, Math.max(5, Math.ceil(longContent.length / 2))))
    expect(submit.billingInfo).toBeNull()
    expectDefaultBillingForPayload(routeCase.taskType, submit.payload, {
      apiType: 'voice',
      quantity: expectedMaxSeconds,
      unit: 'second',
    })
    expect(submit.payload).toEqual(expect.objectContaining({
      content: longContent,
      durationSeconds: expectedMaxSeconds,
      maxSeconds: expectedMaxSeconds,
    }))
  })

  it('voice-optimize duplicate submissions ignore requestId in dedupeKey and keep the same content/speaker/speed fingerprint', async () => {
    const routeCase = routeCases.find((item) => item.name === 'voice-optimize durationSeconds')!
    const { POST } = await routeCase.load()
    const body = defaultBody({
      voiceLineId: 'voice-1',
      selectedElementId: 'audio-1',
      content: 'same content',
      speaker: 'A',
      speed: 1.25,
      durationSeconds: 3,
    })

    const first = await POST(buildEditorAiRequest(routeCase.path, { ...body, requestId: 'trace-1' }), buildContext())
    const second = await POST(buildEditorAiRequest(routeCase.path, { ...body, requestId: 'trace-2' }), buildContext())

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(submitTaskMock).toHaveBeenCalledTimes(2)
    const firstSubmit = submitTaskMock.mock.calls[0]?.[0]
    const secondSubmit = submitTaskMock.mock.calls[1]?.[0]
    expect(firstSubmit.requestId).not.toBe(secondSubmit.requestId)
    expect(firstSubmit.dedupeKey).toBe(secondSubmit.dedupeKey)
    expect(firstSubmit.dedupeKey).toEqual(expect.stringMatching(/^editor-ai:voice-optimize:editor-project-1:audio-1:[a-f0-9]{16}:[a-f0-9]{12}:1.25$/))
  })

  it('caption billing uses server voice-line durations so pre-freeze is not underestimated by client payload', async () => {
    const routeCase = routeCases[1]
    const { POST } = await routeCase.load()
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValueOnce([
      { id: 'voice-1', content: 'A', audioDuration: 120000, audioMedia: { durationMs: 120000 } },
      { id: 'voice-2', content: 'B', audioDuration: null, audioMedia: { durationMs: 60000 } },
      { id: 'voice-3', content: 'C', audioDuration: null, audioMedia: null },
    ])

    const res = await POST(
      buildEditorAiRequest(routeCase.path, defaultBody({ durationMinutes: 0.01 })),
      buildContext(),
    )

    expect(res.status).toBe(200)
    const submit = submitTaskMock.mock.calls[0]?.[0]
    expect(submit.billingInfo).toEqual(expect.objectContaining({
      quantity: 182 / 60,
      unit: 'minute',
    }))
    expect(submit.billingInfo.quantity).toBeGreaterThan(0.01)
    expect(submit.payload).toEqual(expect.objectContaining({
      durationMinutes: 182 / 60,
    }))
  })

  it('caption billing uses editor audio timeline when it is longer than DB audio duration', async () => {
    const routeCase = routeCases[1]
    const { POST } = await routeCase.load()
    prismaMock.novelPromotionEditorProject.findFirst.mockResolvedValueOnce({
      id: 'editor-project-1',
      episodeId: 'episode-1',
      projectData: {
        version: 1,
        tracks: [
          {
            id: 'track-audio-main',
            name: '语音',
            type: 'audio',
            elements: [
              { id: 'audio-voice-1', type: 'audio', s: 5, e: 20, props: {}, metadata: { voiceLineId: 'voice-1' } },
            ],
          },
        ],
      },
    })
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValueOnce([
      { id: 'voice-1', content: 'A', audioDuration: 3000, audioMedia: { durationMs: 3000 } },
    ])

    const res = await POST(
      buildEditorAiRequest(routeCase.path, defaultBody({ durationMinutes: 0.01 })),
      buildContext(),
    )

    expect(res.status).toBe(200)
    const submit = submitTaskMock.mock.calls[0]?.[0]
    expect(submit.billingInfo).toEqual(expect.objectContaining({
      quantity: 15 / 60,
      unit: 'minute',
    }))
    expect(submit.payload).toEqual(expect.objectContaining({
      durationMinutes: 15 / 60,
    }))
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

  it('uses a stable body hash dedupeKey when no body or header idempotency key is provided', async () => {
    const routeCase = routeCases[0]
    const { POST } = await routeCase.load()
    const body = defaultBody({ trim: { from: 0, to: 24 } })

    const first = await POST(buildEditorAiRequest(routeCase.path, body), buildContext())
    const second = await POST(buildEditorAiRequest(routeCase.path, body), buildContext())

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(submitTaskMock).toHaveBeenCalledTimes(2)
    const firstSubmit = submitTaskMock.mock.calls[0]?.[0]
    const secondSubmit = submitTaskMock.mock.calls[1]?.[0]
    expect(firstSubmit?.requestId).toEqual(expect.any(String))
    expect(secondSubmit?.requestId).toEqual(expect.any(String))
    expect(firstSubmit?.requestId).not.toBe(secondSubmit?.requestId)
    expect(firstSubmit?.dedupeKey).toEqual(expect.stringMatching(/^editor-ai:smart-cut:editor-project-1:[a-f0-9]{16}$/))
    expect(secondSubmit?.dedupeKey).toBe(firstSubmit?.dedupeKey)
  })

  describe('transition synchronous route', () => {
    const path = '/api/novel-promotion/project-1/editor/ai/transition'
    const body = defaultBody({ fromElementId: 'video-1', toElementId: 'video-2' })

    it('returns 401 when unauthenticated', async () => {
      const { POST } = await import('@/app/api/novel-promotion/[projectId]/editor/ai/transition/route')
      authState.userId = null

      const res = await POST(buildEditorAiRequest(path, body), buildContext())

      expect(res.status).toBe(401)
      expect(submitTaskMock).not.toHaveBeenCalled()
    })

    it('returns 404 for another user project', async () => {
      const { POST } = await import('@/app/api/novel-promotion/[projectId]/editor/ai/transition/route')
      prismaMock.project.findFirst.mockResolvedValueOnce(null)

      const res = await POST(buildEditorAiRequest(path, body), buildContext())

      expect(res.status).toBe(404)
      expect(submitTaskMock).not.toHaveBeenCalled()
    })

    it('returns 404 for another project editorProject', async () => {
      const { POST } = await import('@/app/api/novel-promotion/[projectId]/editor/ai/transition/route')
      prismaMock.novelPromotionEditorProject.findFirst.mockResolvedValueOnce(null)

      const res = await POST(buildEditorAiRequest(path, body), buildContext())

      expect(res.status).toBe(404)
      expect(submitTaskMock).not.toHaveBeenCalled()
    })

    it('returns free recommendations synchronously without enqueueing or billing', async () => {
      const { POST } = await import('@/app/api/novel-promotion/[projectId]/editor/ai/transition/route')

      const res = await POST(buildEditorAiRequest(path, body), buildContext())

      expect(res.status).toBe(200)
      const json = await res.json() as {
        data: {
          free: boolean
          billing: null
          recommendations: Array<{ kind: string; duration: number; confidence: number; reason: string }>
        }
      }
      expect(json.data.free).toBe(true)
      expect(json.data.billing).toBeNull()
      expect(json.data.recommendations).toHaveLength(4)
      expect(json.data.recommendations[0].kind).toBe('fade')
      expect(submitTaskMock).not.toHaveBeenCalled()
    })

    it('returns 400 when transition clips are not adjacent on the same track', async () => {
      const { POST } = await import('@/app/api/novel-promotion/[projectId]/editor/ai/transition/route')
      prismaMock.novelPromotionEditorProject.findFirst.mockResolvedValueOnce({
        id: 'editor-project-1',
        episodeId: 'episode-1',
        projectData: {
          version: 1,
          tracks: [{ id: 'track-video-main', type: 'video', elements: [
            { id: 'video-1', type: 'video', s: 0, e: 6, props: { src: 'mediaobj://video-1' }, metadata: { panelId: 'panel-1', storyboardId: 'storyboard-1' } },
            { id: 'video-middle', type: 'video', s: 6, e: 8, props: { src: 'mediaobj://video-middle' }, metadata: { panelId: 'panel-middle', storyboardId: 'storyboard-middle' } },
            { id: 'video-2', type: 'video', s: 8, e: 10, props: { src: 'mediaobj://video-2' }, metadata: { panelId: 'panel-2', storyboardId: 'storyboard-2' } },
          ] }],
        },
      })

      const res = await POST(buildEditorAiRequest(path, body), buildContext())

      expect(res.status).toBe(400)
      const json = await res.json() as Record<string, unknown>
      expect(json.code).toBe('INVALID_PARAMS')
      expect(json.message).toBe('TRANSITION_ELEMENTS_NOT_ADJACENT')
      expect(submitTaskMock).not.toHaveBeenCalled()
    })

    it('returns 400 when transition target type is not video or image', async () => {
      const { POST } = await import('@/app/api/novel-promotion/[projectId]/editor/ai/transition/route')
      prismaMock.novelPromotionEditorProject.findFirst.mockResolvedValueOnce({
        id: 'editor-project-1',
        episodeId: 'episode-1',
        projectData: {
          version: 1,
          tracks: [{ id: 'track-video-main', type: 'video', elements: [
            { id: 'video-1', type: 'video', s: 0, e: 6, props: { src: 'mediaobj://video-1' }, metadata: { panelId: 'panel-1', storyboardId: 'storyboard-1' } },
            { id: 'video-2', type: 'audio', s: 6, e: 10, props: { src: 'mediaobj://audio-1' }, metadata: { panelId: 'panel-2', storyboardId: 'storyboard-2' } },
          ] }],
        },
      })

      const res = await POST(buildEditorAiRequest(path, body), buildContext())

      expect(res.status).toBe(400)
      const json = await res.json() as Record<string, unknown>
      expect(json.code).toBe('INVALID_PARAMS')
      expect(json.message).toBe('TRANSITION_UNSUPPORTED_ELEMENT_TYPE')
      expect(submitTaskMock).not.toHaveBeenCalled()
    })
  })
})
