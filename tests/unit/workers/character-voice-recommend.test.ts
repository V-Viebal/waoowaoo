import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: { findUnique: vi.fn() },
  novelPromotionCharacter: { findFirst: vi.fn() },
}))

const aiRuntimeMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(async () => ({
    text: '男、青年、低音调',
    reasoning: '',
  })),
}))

const promptMock = vi.hoisted(() => ({
  buildPromptAsync: vi.fn(async () => 'character-voice-recommend-prompt'),
}))

const modelMock = vi.hoisted(() => ({
  resolveAnalysisModel: vi.fn(async () => 'ark::analysis-model'),
}))

const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

const streamMock = vi.hoisted(() => ({
  flush: vi.fn(async () => undefined),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/ai-runtime', () => aiRuntimeMock)
vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks: unknown, fn: () => Promise<unknown>) => await fn()),
}))
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: {
    NP_CHARACTER_VOICE_RECOMMEND: 'np_character_voice_recommend',
    NP_CHARACTER_VOICE_RECOMMEND_COSY: 'np_character_voice_recommend_cosy',
  },
  buildPromptAsync: promptMock.buildPromptAsync,
}))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))
vi.mock('@/lib/workers/handlers/resolve-analysis-model', () => modelMock)
vi.mock('@/lib/workers/handlers/llm-stream', () => ({
  createWorkerLLMStreamContext: vi.fn(() => ({ streamRunId: 'run-1', nextSeqByStepLane: {} })),
  createWorkerLLMStreamCallbacks: vi.fn(() => ({
    onStage: vi.fn(),
    onChunk: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    flush: streamMock.flush,
  })),
}))

import { handleCharacterVoiceRecommendTask } from '@/lib/workers/handlers/character-voice-recommend'

const profileData = {
  role_level: 'A',
  archetype: '冷静谋士',
  personality_tags: ['冷静', '克制'],
  era_period: '现代',
  social_class: '中产',
  occupation: '律师',
  costume_tier: 3,
  suggested_colors: ['黑色'],
  visual_keywords: ['西装'],
  gender: '女',
  age_range: '中年',
}

function buildJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-character-voice-recommend-1',
      type: TASK_TYPE.CHARACTER_VOICE_RECOMMEND,
      locale: 'zh',
      projectId: 'project-1',
      targetType: 'NovelPromotionCharacter',
      targetId: 'char-1',
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker character-voice-recommend behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'np-project-1',
      analysisModel: 'ark::project-analysis',
    })
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValue({
      id: 'char-1',
      name: '林晚',
      profileData: JSON.stringify(profileData),
    })
    aiRuntimeMock.executeAiTextStep.mockResolvedValue({
      text: '男、青年、低音调',
      reasoning: '',
    })
    modelMock.resolveAnalysisModel.mockResolvedValue('ark::analysis-model')
  })

  it('missing characterId -> explicit error', async () => {
    await expect(handleCharacterVoiceRecommendTask(buildJob({ engine: 'omnivoice' }))).rejects.toThrow('characterId is required')
    expect(prismaMock.novelPromotionProject.findUnique).not.toHaveBeenCalled()
  })

  it('character from another project -> CHARACTER_NOT_FOUND', async () => {
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValue(null)

    await expect(handleCharacterVoiceRecommendTask(buildJob({ characterId: 'char-other', engine: 'omnivoice' }))).rejects.toThrow('CHARACTER_NOT_FOUND')

    expect(prismaMock.novelPromotionCharacter.findFirst).toHaveBeenCalledWith({
      where: { id: 'char-other', novelPromotionProjectId: 'np-project-1' },
      select: { id: true, name: true, profileData: true },
    })
  })

  it('valid omnivoice LLM output -> returns llm instruct', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValue({
      text: '男、青年、低音调',
      reasoning: '',
    })

    const result = await handleCharacterVoiceRecommendTask(buildJob({ characterId: 'char-1', engine: 'omnivoice' }))

    expect(result).toEqual({
      success: true,
      instruct: '男、青年、低音调',
      source: 'llm',
    })
    expect(aiRuntimeMock.executeAiTextStep).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      model: 'ark::analysis-model',
      projectId: 'project-1',
      action: 'character_voice_recommend',
    }))
    expect(streamMock.flush).toHaveBeenCalled()
  })

  it('invalid omnivoice LLM output -> falls back to profileData instruct', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValue({
      text: 'deep cinematic villain voice',
      reasoning: '',
    })

    const result = await handleCharacterVoiceRecommendTask(buildJob({ characterId: 'char-1', engine: 'omnivoice' }))

    expect(result).toEqual({
      success: true,
      instruct: '女、中年',
      source: 'fallback',
    })
  })

  it('cosyvoice engine default -> returns cleaned LLM natural-language prompt', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValue({
      text: '中年女性,声音低沉冷静,语速平稳,带有律师的威严感',
      reasoning: '',
    })

    const result = await handleCharacterVoiceRecommendTask(buildJob({ characterId: 'char-1' }))

    expect(result.success).toBe(true)
    expect(result.source).toBe('llm')
    expect(result.instruct).toContain('中年女性')
  })

  it('cosyvoice engine with garbage LLM output -> falls back to profile-based description', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValue({
      text: '...',
      reasoning: '',
    })

    const result = await handleCharacterVoiceRecommendTask(buildJob({ characterId: 'char-1' }))

    expect(result).toEqual({
      success: true,
      instruct: expect.stringContaining('女性'),
      source: 'fallback',
    })
  })
})
