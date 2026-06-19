import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    project: { id: 'project-1', userId: 'user-1' },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const submitTaskMock = vi.hoisted(() => vi.fn(async (_args: Record<string, unknown>) => ({
  success: true,
  async: true,
  taskId: 'task-1',
  runId: null,
  status: 'queued',
  deduped: false,
})))

const configServiceMock = vi.hoisted(() => ({
  getProjectModelConfig: vi.fn(async () => ({
    storyboardModel: 'img::storyboard',
  })),
  resolveProjectModelCapabilityGenerationOptions: vi.fn(async () => ({})),
}))

const apiConfigMock = vi.hoisted(() => ({
  resolveModelSelection: vi.fn(async () => undefined),
}))

const hasOutputMock = vi.hoisted(() => ({
  hasPanelImageOutput: vi.fn(async () => false),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/billing', () => ({
  buildDefaultTaskBillingInfo: vi.fn(() => ({ mode: 'default' })),
}))
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
}))
vi.mock('@/lib/task/has-output', () => hasOutputMock)
vi.mock('@/lib/task/ui-payload', () => ({
  withTaskUiPayload: vi.fn((payload, ui) => ({ ...payload, _ui: ui })),
}))

async function invokeRoute(body: Record<string, unknown>): Promise<Response> {
  const mod = await import('@/app/api/novel-promotion/[projectId]/regenerate-panel-image/route')
  const req = buildMockRequest({
    path: '/api/novel-promotion/project-1/regenerate-panel-image',
    method: 'POST',
    body,
  })
  return await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
}

describe('regenerate-panel-image route dedupeKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes panelGridSize in dedupeKey so different sizes do not collide', async () => {
    await invokeRoute({ panelId: 'panel-1', count: 1, panelGridSize: 1 })
    await invokeRoute({ panelId: 'panel-1', count: 1, panelGridSize: 6 })

    expect(submitTaskMock).toHaveBeenCalledTimes(2)

    const firstCall = submitTaskMock.mock.calls[0]?.[0] as unknown as { dedupeKey: string }
    const secondCall = submitTaskMock.mock.calls[1]?.[0] as unknown as { dedupeKey: string }

    expect(firstCall.dedupeKey).toBe('image_panel:panel-1:1:1')
    expect(secondCall.dedupeKey).toBe('image_panel:panel-1:1:6')
    expect(firstCall.dedupeKey).not.toBe(secondCall.dedupeKey)
  })

  it('forwards panelGridSize within billing payload', async () => {
    await invokeRoute({ panelId: 'panel-2', count: 2, panelGridSize: 4 })

    expect(submitTaskMock).toHaveBeenCalledTimes(1)
    const call = submitTaskMock.mock.calls[0]?.[0] as unknown as {
      dedupeKey: string
      payload: { panelGridSize: number; candidateCount: number }
    }
    expect(call.dedupeKey).toBe('image_panel:panel-2:2:4')
    expect(call.payload.panelGridSize).toBe(4)
    expect(call.payload.candidateCount).toBe(2)
  })

  it('clamps panelGridSize into 1..16 range', async () => {
    await invokeRoute({ panelId: 'panel-3', count: 1, panelGridSize: 99 })
    await invokeRoute({ panelId: 'panel-3', count: 1, panelGridSize: -5 })

    const firstCall = submitTaskMock.mock.calls[0]?.[0] as unknown as { dedupeKey: string }
    const secondCall = submitTaskMock.mock.calls[1]?.[0] as unknown as { dedupeKey: string }
    expect(firstCall.dedupeKey).toBe('image_panel:panel-3:1:16')
    expect(secondCall.dedupeKey).toBe('image_panel:panel-3:1:1')
  })
})
