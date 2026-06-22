import { describe, expect, it, vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'

vi.mock('@/lib/redis', () => ({ queueRedis: {} }))
vi.mock('bullmq', () => ({
  Queue: class {
    constructor(_name: string) {}
    async add() { return { id: 'job-1' } }
    async getJob() { return null }
  },
}))

import { getQueueTypeByTaskType } from '@/lib/task/queues'

describe('task queue routing', () => {
  it('routes editor voice optimize to the voice queue so it can reuse TTS generation', () => {
    expect(getQueueTypeByTaskType(TASK_TYPE.EDITOR_AI_VOICE_OPTIMIZE)).toBe('voice')
  })
})
