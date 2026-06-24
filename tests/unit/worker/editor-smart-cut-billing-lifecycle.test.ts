import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { BILLING_ITEM } from '@/lib/billing/items'
import { TASK_TYPE, type TaskBillingInfo, type TaskJobData } from '@/lib/task/types'

const taskServiceMock = vi.hoisted(() => ({
  rollbackTaskBillingForTask: vi.fn(async () => ({ attempted: false, rolledBack: false, billingInfo: null })),
  touchTaskHeartbeat: vi.fn(async () => undefined),
  tryMarkTaskCompleted: vi.fn(async () => true),
  tryMarkTaskFailed: vi.fn(async () => true),
  tryMarkTaskProcessing: vi.fn(async () => true),
  tryUpdateTaskProgress: vi.fn(async () => true),
  updateTaskBillingInfo: vi.fn(async () => undefined),
}))

const billingMock = vi.hoisted(() => ({
  settleTaskBilling: vi.fn(async (_task: unknown, options?: { result?: Record<string, unknown> }) => ({
    billable: true,
    status: 'settled',
    chargedCost: 0.05,
    actualQuantity: options?.result?.actualQuantity,
  })),
  rollbackTaskBilling: vi.fn(async (task: { billingInfo: TaskBillingInfo | null }) => ({
    ...(task.billingInfo || {}),
    status: 'rolled_back',
  })),
}))

const publisherMock = vi.hoisted(() => ({
  publishTaskEvent: vi.fn(async () => undefined),
  publishTaskStreamEvent: vi.fn(async () => undefined),
}))

const prismaMock = vi.hoisted(() => ({
  project: { findUnique: vi.fn(async () => null) },
  novelPromotionEditorProject: {
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  logError: vi.fn(),
}))
vi.mock('@/lib/task/service', () => taskServiceMock)
vi.mock('@/lib/task/publisher', () => publisherMock)
vi.mock('@/lib/task/progress-message', () => ({
  buildTaskProgressMessage: vi.fn(() => 'progress-message'),
  getTaskStageLabel: vi.fn((stage: string) => `label:${stage}`),
}))
vi.mock('@/lib/errors/normalize', () => ({
  normalizeAnyError: vi.fn((error: Error) => ({
    code: 'ERROR',
    message: error.message,
    retryable: false,
    provider: null,
  })),
}))
vi.mock('@/lib/billing', () => billingMock)
vi.mock('@/lib/billing/runtime-usage', () => ({
  withTextUsageCollection: vi.fn(async (fn: () => Promise<unknown>) => ({
    result: await fn(),
    textUsage: [],
  })),
}))
vi.mock('@/lib/logging/file-writer', () => ({ onProjectNameAvailable: vi.fn() }))
vi.mock('@/lib/run-runtime/task-bridge', () => ({ mapTaskSSEEventToRunEvents: vi.fn(() => []) }))
vi.mock('@/lib/run-runtime/publisher', () => ({ publishRunEvent: vi.fn(async () => undefined) }))

import { withTaskLifecycle } from '@/lib/workers/shared'

const smartCutBillingInfo: TaskBillingInfo = {
  billable: true,
  source: 'task',
  taskType: TASK_TYPE.EDITOR_AI_SMART_CUT,
  apiType: 'editor',
  model: BILLING_ITEM.EDITOR_SMART_CUT,
  quantity: 1,
  unit: 'call',
  maxFrozenCost: 0.05,
  action: BILLING_ITEM.EDITOR_SMART_CUT,
  metadata: {
    billingItem: BILLING_ITEM.EDITOR_SMART_CUT,
    editorProjectId: 'editor-project-1',
  },
  status: 'frozen',
  freezeId: 'freeze-smart-cut-1',
  modeSnapshot: 'ENFORCE',
}

function buildJob(): Job<TaskJobData> {
  return {
    queueName: 'text',
    attemptsMade: 0,
    opts: { attempts: 1 },
    data: {
      taskId: 'task-smart-cut-1',
      type: TASK_TYPE.EDITOR_AI_SMART_CUT,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionEditorProject',
      targetId: 'editor-project-1',
      payload: {
        episodeId: 'episode-1',
        editorProjectId: 'editor-project-1',
      },
      billingInfo: smartCutBillingInfo,
      userId: 'user-1',
      trace: null,
    },
  } as unknown as Job<TaskJobData>
}

const renderBillingInfo: TaskBillingInfo = {
  billable: true,
  source: 'task',
  taskType: TASK_TYPE.EDITOR_RENDER,
  apiType: 'editor',
  model: BILLING_ITEM.EDITOR_EXPORT,
  quantity: 1,
  unit: 'minute',
  maxFrozenCost: 0.01,
  action: BILLING_ITEM.EDITOR_EXPORT,
  metadata: {
    billingItem: BILLING_ITEM.EDITOR_EXPORT,
    editorProjectId: 'editor-project-1',
  },
  status: 'frozen',
  freezeId: 'freeze-render-1',
  modeSnapshot: 'ENFORCE',
}

function buildRenderJob(): Job<TaskJobData> {
  return {
    queueName: 'video',
    attemptsMade: 0,
    opts: { attempts: 1 },
    data: {
      taskId: 'task-render-1',
      type: TASK_TYPE.EDITOR_RENDER,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionEditorProject',
      targetId: 'editor-project-1',
      payload: {
        episodeId: 'episode-1',
        editorProjectId: 'editor-project-1',
      },
      billingInfo: renderBillingInfo,
      userId: 'user-1',
      trace: null,
    },
  } as unknown as Job<TaskJobData>
}

describe('editor smart cut worker billing lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    taskServiceMock.tryMarkTaskProcessing.mockResolvedValue(true)
    taskServiceMock.tryMarkTaskCompleted.mockResolvedValue(true)
    taskServiceMock.tryMarkTaskFailed.mockResolvedValue(true)
  })

  it('settles fixed per-use billing with actualQuantity=1 on success', async () => {
    await withTaskLifecycle(buildJob(), async () => ({
      success: true,
      actualQuantity: 1,
    }))

    expect(billingMock.settleTaskBilling).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-smart-cut-1',
        projectId: 'project-1',
        userId: 'user-1',
        billingInfo: smartCutBillingInfo,
      }),
      expect.objectContaining({
        result: expect.objectContaining({ actualQuantity: 1 }),
      }),
    )
    expect(taskServiceMock.updateTaskBillingInfo).toHaveBeenCalledWith(
      'task-smart-cut-1',
      expect.objectContaining({ status: 'settled', chargedCost: 0.05 }),
    )
    expect(taskServiceMock.tryMarkTaskCompleted).toHaveBeenCalledWith(
      'task-smart-cut-1',
      expect.objectContaining({ success: true, actualQuantity: 1 }),
    )
  })

  it('rolls back frozen billing when the handler fails terminally', async () => {
    await expect(withTaskLifecycle(buildJob(), async () => {
      throw new Error('smart cut boom')
    })).rejects.toThrow('smart cut boom')

    expect(billingMock.rollbackTaskBilling).toHaveBeenCalledWith({
      id: 'task-smart-cut-1',
      billingInfo: smartCutBillingInfo,
    })
    expect(taskServiceMock.updateTaskBillingInfo).toHaveBeenCalledWith(
      'task-smart-cut-1',
      expect.objectContaining({ status: 'rolled_back' }),
    )
    expect(taskServiceMock.tryMarkTaskFailed).toHaveBeenCalledWith(
      'task-smart-cut-1',
      'ERROR',
      'smart cut boom',
    )
  })

  it('rolls back DONE editor render output when billing settlement fails', async () => {
    billingMock.settleTaskBilling.mockRejectedValueOnce(new Error('settle failed'))

    await expect(withTaskLifecycle(buildRenderJob(), async () => ({
      success: true,
      mediaObjectId: 'media-render-1',
      actualQuantity: 1,
    }))).rejects.toThrow('settle failed')

    expect(prismaMock.novelPromotionEditorProject.updateMany).toHaveBeenCalledWith({
      where: {
        renderTaskId: 'task-render-1',
        renderStatus: 'DONE',
      },
      data: {
        renderStatus: 'FAILED',
        renderOutputMediaObjectId: null,
      },
    })
    expect(taskServiceMock.tryMarkTaskCompleted).not.toHaveBeenCalled()
    expect(taskServiceMock.tryMarkTaskFailed).toHaveBeenCalledWith('task-render-1', 'ERROR', 'settle failed')
  })
})
