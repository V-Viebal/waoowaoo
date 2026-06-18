import { Worker, type Job } from 'bullmq'
import { queueRedis } from '@/lib/redis'
import { QUEUE_NAME } from '@/lib/task/queues'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { getUserWorkflowConcurrencyConfig } from '@/lib/config-service'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import { withUserConcurrencyGate } from './user-concurrency-gate'
import {
  handleAssetHubImageTask,
  handleAssetHubModifyTask,
  handleCharacterImageTask,
  handleLocationImageTask,
  handleModifyAssetImageTask,
  handlePanelImageTask,
  handlePanelVariantTask,
  handleStoryboardImageTask,
} from './handlers/image-task-handlers'

type AnyObj = Record<string, unknown>

async function processImageTask(job: Job<TaskJobData>) {
  await reportTaskProgress(job, 5, { stage: 'received' })

  switch (job.data.type) {
    case TASK_TYPE.STORYBOARD_IMAGE:
      return await handleStoryboardImageTask(job)
    case TASK_TYPE.IMAGE_CHARACTER:
      return await handleCharacterImageTask(job)
    case TASK_TYPE.IMAGE_LOCATION:
      return await handleLocationImageTask(job)
    case TASK_TYPE.REGENERATE_GROUP: {
      const payload = (job.data.payload || {}) as AnyObj
      if (payload.type === 'character') {
        return await handleCharacterImageTask(job)
      }
      return await handleLocationImageTask(job)
    }
    case TASK_TYPE.MODIFY_ASSET_IMAGE:
      return await handleModifyAssetImageTask(job)
    case TASK_TYPE.ASSET_HUB_IMAGE:
      return await handleAssetHubImageTask(job)
    case TASK_TYPE.ASSET_HUB_MODIFY:
      return await handleAssetHubModifyTask(job)
    case TASK_TYPE.IMAGE_PANEL:
      return await handlePanelImageTask(job)
    case TASK_TYPE.PANEL_VARIANT:
      return await handlePanelVariantTask(job)
    default:
      throw new Error(`Unsupported image task type: ${job.data.type}`)
  }
}

export function createImageWorker() {
  return new Worker<TaskJobData>(
    QUEUE_NAME.IMAGE,
    async (job) => await withTaskLifecycle(job, async (taskJob) => {
      const workflowConcurrency = await getUserWorkflowConcurrencyConfig(taskJob.data.userId)
      return await withUserConcurrencyGate({
        scope: 'image',
        userId: taskJob.data.userId,
        limit: workflowConcurrency.image,
        run: async () => await processImageTask(taskJob),
      })
    }),
    {
      connection: queueRedis,
      concurrency: Number.parseInt(process.env.QUEUE_CONCURRENCY_IMAGE || '20', 10) || 20,
      // BullMQ 默认 lockDuration=30s/stalledInterval=30s/maxStalledCount=1，对同步出图（starrouter）
      // 太紧——单次出图常 30s+，主线程偶有 GC/JSON.parse 抖动就会漏锁续期，被判 stalled。
      // 这里显式拉长锁与 stalled 窗口，并允许多一次 stalled 重试。
      lockDuration: Number.parseInt(process.env.QUEUE_LOCK_DURATION_IMAGE || '120000', 10) || 120_000,
      stalledInterval: Number.parseInt(process.env.QUEUE_STALLED_INTERVAL_IMAGE || '60000', 10) || 60_000,
      maxStalledCount: Number.parseInt(process.env.QUEUE_MAX_STALLED_IMAGE || '2', 10) || 2,
    },
  )
}
