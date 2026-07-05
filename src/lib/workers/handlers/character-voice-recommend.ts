import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { buildPromptAsync, PROMPT_IDS } from '@/lib/prompt-i18n'
import { parseProfileData } from '@/types/character-profile'
import { parseAndValidateRecommendation } from '@/lib/providers/omnivoice'
import { OMNIVOICE_ZH_CHIP_GROUPS } from '@/lib/providers/omnivoice/instruct-vocabulary'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'
import { resolveAnalysisModel } from './resolve-analysis-model'
import type { TaskJobData } from '@/lib/task/types'
import type { VoiceDesignEngine } from '@/components/voice/voice-design-shared'

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readEngine(value: unknown): VoiceDesignEngine {
  return value === 'omnivoice' ? 'omnivoice' : 'cosyvoice'
}

/** 把分组词表渲染成 prompt 注入用的可读文本。 */
function renderVocabulary(): string {
  const labelByKey: Record<string, string> = {
    gender: '性别',
    age: '年龄',
    pitch: '音调',
    accent: '口音/方言',
  }
  return OMNIVOICE_ZH_CHIP_GROUPS.map(
    (group) => `${labelByKey[group.key] ?? group.key}: ${group.tokens.join('、')}`,
  ).join('\n')
}

/** Cosy 自然语言 prompt 的兜底(基于 profile 拼接),保证 LLM 失败时仍返回可用描述。 */
function cosyFallbackPrompt(profile: ReturnType<typeof parseProfileData>, name: string): string {
  const gender = profile?.gender?.includes('女') ? '女性' : '男性'
  const age = profile?.age_range || '青年'
  return `${age}${gender},声音自然清晰,语速适中,适合${name}的角色配音`
}

/** 清洗 Cosy LLM 输出:去掉 markdown、引号、前缀,截断到 100 字。 */
function cleanCosyPrompt(raw: string): string {
  return raw
    .replace(/^[\s\S]*?(?=[一-龥A-Za-z])/, '') // 去掉前置空白/标点
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^["「『“”』」]\s*|\s*["」』”“「『]$/g, '')
    .replace(/^(声音描述[:：]?|voice[:：]?|description[:：]?)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

export async function handleCharacterVoiceRecommendTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const characterId = readString(payload.characterId)
  if (!characterId) {
    throw new Error('characterId is required')
  }
  const engine = readEngine(payload.engine)

  const projectId = job.data.projectId
  const novelPromotionData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true, analysisModel: true },
  })
  if (!novelPromotionData) {
    throw new Error('Novel promotion data not found')
  }

  const character = await prisma.novelPromotionCharacter.findFirst({
    where: { id: characterId, novelPromotionProjectId: novelPromotionData.id },
    select: { id: true, name: true, profileData: true },
  })
  if (!character) {
    throw new Error('CHARACTER_NOT_FOUND')
  }

  await reportTaskProgress(job, 20, {
    stage: 'voice_recommend_prepare',
    stageLabel: '准备角色档案',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'voice_recommend_prepare')

  const profile = parseProfileData(character.profileData)

  const baseVariables = {
    name: character.name,
    gender: profile?.gender ?? '',
    age_range: profile?.age_range ?? '',
    archetype: profile?.archetype ?? '',
    personality_tags: (profile?.personality_tags ?? []).join('、'),
    occupation: profile?.occupation ?? '',
    social_class: profile?.social_class ?? '',
    era_period: profile?.era_period ?? '',
  }

  const promptTemplate = engine === 'omnivoice'
    ? await buildPromptAsync({
        promptId: PROMPT_IDS.NP_CHARACTER_VOICE_RECOMMEND,
        locale: job.data.locale,
        projectId,
        variables: { ...baseVariables, vocabulary: renderVocabulary() },
      })
    : await buildPromptAsync({
        promptId: PROMPT_IDS.NP_CHARACTER_VOICE_RECOMMEND_COSY,
        locale: job.data.locale,
        projectId,
        variables: baseVariables,
      })

  const analysisModel = await resolveAnalysisModel({
    userId: job.data.userId,
    projectAnalysisModel: novelPromotionData.analysisModel,
  })

  await reportTaskProgress(job, 50, {
    stage: 'voice_recommend_llm',
    stageLabel: 'AI 推荐声音特征',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'voice_recommend_llm')

  const streamContext = createWorkerLLMStreamContext(job, 'character_voice_recommend')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)

  let completion: Awaited<ReturnType<typeof executeAiTextStep>>
  try {
    completion = await withInternalLLMStreamCallbacks(
      streamCallbacks,
      async () =>
        await executeAiTextStep({
          userId: job.data.userId,
          model: analysisModel,
          messages: [{ role: 'user', content: promptTemplate }],
          projectId,
          action: 'character_voice_recommend',
          meta: {
            stepId: 'character_voice_recommend',
            stepAttempt: 1,
            stepTitle: 'AI 推荐声音',
            stepIndex: 1,
            stepTotal: 1,
          },
        }),
    )
  } finally {
    await streamCallbacks.flush()
  }

  let instruct: string
  let source: 'llm' | 'fallback'
  if (engine === 'omnivoice') {
    const recommendation = parseAndValidateRecommendation(completion.text ?? '', profile)
    instruct = recommendation.instruct
    source = recommendation.source
  } else {
    const cleaned = cleanCosyPrompt(completion.text ?? '')
    if (cleaned.length >= 6) {
      instruct = cleaned
      source = 'llm'
    } else {
      instruct = cosyFallbackPrompt(profile, character.name)
      source = 'fallback'
    }
  }

  await reportTaskProgress(job, 96, {
    stage: 'voice_recommend_done',
    stageLabel: '推荐完成',
    displayMode: 'detail',
  })

  return {
    success: true,
    instruct,
    source,
  }
}
