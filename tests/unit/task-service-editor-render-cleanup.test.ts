import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  task: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  novelPromotionEditorProject: {
    updateMany: vi.fn(),
  },
}))

const billingMock = vi.hoisted(() => ({
  rollbackTaskBilling: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/billing', () => ({ rollbackTaskBilling: billingMock.rollbackTaskBilling }))
vi.mock('@/lib/prisma-retry', () => ({ withPrismaRetry: vi.fn(async (operation: () => Promise<unknown>) => operation()) }))
vi.mock('@/i18n/routing', () => ({ locales: ['zh', 'en'] }))

import { sweepStaleTasks } from '@/lib/task/service'

describe('task service editor render cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.findMany.mockResolvedValue([])
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.novelPromotionEditorProject.updateMany.mockResolvedValue({ count: 1 })
    billingMock.rollbackTaskBilling.mockResolvedValue({ success: true })
  })

  it('watchdog failure cleanup clears DONE editor render output by renderTaskId', async () => {
    prismaMock.task.findMany.mockResolvedValueOnce([
      {
        id: 'task-render-crashed-after-done',
        userId: 'user-1',
        projectId: 'project-1',
        episodeId: 'episode-1',
        type: TASK_TYPE.EDITOR_RENDER,
        targetType: 'NovelPromotionEditorProject',
        targetId: 'editor-project-1',
        billingInfo: null,
      },
    ])

    const result = await sweepStaleTasks({ processingThresholdMs: 1, limit: 10 })

    expect(result).toHaveLength(1)
    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'task-render-crashed-after-done', status: TASK_STATUS.PROCESSING },
      data: expect.objectContaining({
        status: TASK_STATUS.FAILED,
        errorCode: 'WATCHDOG_TIMEOUT',
      }),
    }))
    expect(prismaMock.novelPromotionEditorProject.updateMany).toHaveBeenCalledWith({
      where: {
        renderTaskId: 'task-render-crashed-after-done',
      },
      data: {
        renderStatus: 'FAILED',
        renderOutputMediaObjectId: null,
      },
    })
  })
})
