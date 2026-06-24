import { JobsOptions, Queue } from 'bullmq'
import { queueRedis } from '@/lib/redis'
import { QueueType, TaskType, TASK_TYPE, type TaskJobData } from './types'

export const QUEUE_NAME = {
  // 队列名承载 BullMQ 历史任务数据，品牌更名不直接迁移默认队列；如需新队列可通过环境变量覆盖。
  IMAGE: process.env.QUEUE_IMAGE_NAME || 'vvicat-image',
  VIDEO: process.env.QUEUE_VIDEO_NAME || 'vvicat-video',
  VOICE: process.env.QUEUE_VOICE_NAME || 'vvicat-voice',
  TEXT: process.env.QUEUE_TEXT_NAME || 'vvicat-text',
} as const

const defaultJobOptions: JobsOptions = {
  removeOnComplete: 500,
  removeOnFail: 500,
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 2_000,
  },
}

export const imageQueue = new Queue<TaskJobData>(QUEUE_NAME.IMAGE, {
  connection: queueRedis,
  defaultJobOptions,
})

export const videoQueue = new Queue<TaskJobData>(QUEUE_NAME.VIDEO, {
  connection: queueRedis,
  defaultJobOptions,
})

export const voiceQueue = new Queue<TaskJobData>(QUEUE_NAME.VOICE, {
  connection: queueRedis,
  defaultJobOptions,
})

export const textQueue = new Queue<TaskJobData>(QUEUE_NAME.TEXT, {
  connection: queueRedis,
  defaultJobOptions,
})

const ALL_QUEUES = [imageQueue, videoQueue, voiceQueue, textQueue]

const IMAGE_TYPES = new Set<TaskType>([
  TASK_TYPE.IMAGE_PANEL,
  TASK_TYPE.IMAGE_CHARACTER,
  TASK_TYPE.IMAGE_LOCATION,
  TASK_TYPE.PANEL_VARIANT,
  TASK_TYPE.MODIFY_ASSET_IMAGE,
  TASK_TYPE.REGENERATE_GROUP,
  TASK_TYPE.ASSET_HUB_IMAGE,
  TASK_TYPE.ASSET_HUB_MODIFY,
])

const VIDEO_TYPES = new Set<TaskType>([
  TASK_TYPE.VIDEO_PANEL,
  TASK_TYPE.LIP_SYNC,
  TASK_TYPE.EDITOR_RENDER,
])
const VOICE_TYPES = new Set<TaskType>([
  TASK_TYPE.VOICE_LINE,
  TASK_TYPE.VOICE_DESIGN,
  TASK_TYPE.ASSET_HUB_VOICE_DESIGN,
  TASK_TYPE.EDITOR_AI_VOICE_OPTIMIZE,
])

const SINGLE_ATTEMPT_TASK_TYPES = new Set<TaskType>([
  TASK_TYPE.STORY_TO_SCRIPT_RUN,
  TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN,
  // 视频任务轮询周期长、外部已扣费，超时后重试会重复提交/重复扣费，故不重试
  TASK_TYPE.VIDEO_PANEL,
  TASK_TYPE.LIP_SYNC,
])

export function getQueueTypeByTaskType(type: TaskType): QueueType {
  if (IMAGE_TYPES.has(type)) return 'image'
  if (VIDEO_TYPES.has(type)) return 'video'
  if (VOICE_TYPES.has(type)) return 'voice'
  return 'text'
}

export function getQueueByType(type: QueueType) {
  switch (type) {
    case 'image':
      return imageQueue
    case 'video':
      return videoQueue
    case 'voice':
      return voiceQueue
    case 'text':
    default:
      return textQueue
  }
}

export async function addTaskJob(data: TaskJobData, opts?: JobsOptions) {
  const queueType = getQueueTypeByTaskType(data.type)
  const queue = getQueueByType(queueType)
  const priority = typeof opts?.priority === 'number' ? opts.priority : 0
  const attempts = SINGLE_ATTEMPT_TASK_TYPES.has(data.type)
    ? 1
    : (typeof opts?.attempts === 'number' ? opts.attempts : undefined)
  return await queue.add(data.type, data, {
    jobId: data.taskId,
    priority,
    ...(opts || {}),
    ...(attempts !== undefined ? { attempts } : {}),
  })
}

export async function removeTaskJob(taskId: string) {
  for (const queue of ALL_QUEUES) {
    const job = await queue.getJob(taskId)
    if (!job) continue
    await job.remove()
    return true
  }
  return false
}
