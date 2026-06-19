import type { Job } from 'bullmq'
import {
  createVoiceDesign,
  validatePreviewText,
  validateVoicePrompt,
  type VoiceDesignInput,
} from '@/lib/providers/bailian/voice-design'
import { createOmnivoiceVoiceDesign, OMNIVOICE_TTS_MODEL_ID } from '@/lib/providers/omnivoice'
import { getProviderConfig } from '@/lib/api-config'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`)
  }
  return value.trim()
}

function readLanguage(value: unknown): 'zh' | 'en' {
  return value === 'en' ? 'en' : 'zh'
}

function readProvider(value: unknown): 'bailian' | 'omnivoice' {
  return value === 'omnivoice' ? 'omnivoice' : 'bailian'
}

export async function handleVoiceDesignTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const provider = readProvider(payload.provider)
  const voicePrompt = readRequiredString(payload.voicePrompt, 'voicePrompt')
  const previewText = readRequiredString(payload.previewText, 'previewText')
  const preferredName = typeof payload.preferredName === 'string' && payload.preferredName.trim()
    ? payload.preferredName.trim()
    : 'custom_voice'
  const language = readLanguage(payload.language)

  const promptValidation = validateVoicePrompt(voicePrompt)
  if (!promptValidation.valid) {
    throw new Error(promptValidation.error || 'invalid voicePrompt')
  }
  const textValidation = validatePreviewText(previewText)
  if (!textValidation.valid) {
    throw new Error(textValidation.error || 'invalid previewText')
  }

  await reportTaskProgress(job, 25, {
    stage: 'voice_design_submit',
    stageLabel: '提交声音设计任务',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'voice_design_submit')

  const taskType = job.data.type === TASK_TYPE.ASSET_HUB_VOICE_DESIGN
    ? TASK_TYPE.ASSET_HUB_VOICE_DESIGN
    : TASK_TYPE.VOICE_DESIGN

  if (provider === 'omnivoice') {
    const designed = await createOmnivoiceVoiceDesign({
      voicePrompt,
      previewText,
      preferredName,
      language,
      userId: job.data.userId,
    })
    if (!designed.success) {
      throw new Error(designed.error || '声音设计失败')
    }
    await reportTaskProgress(job, 96, {
      stage: 'voice_design_done',
      stageLabel: '声音设计完成',
      displayMode: 'detail',
    })
    return {
      success: true,
      voiceId: designed.profileId,
      targetModel: OMNIVOICE_TTS_MODEL_ID,
      voiceType: 'omnivoice-design',
      audioBase64: designed.audioBase64,
      sampleRate: designed.sampleRate,
      responseFormat: designed.responseFormat,
      requestId: designed.requestId,
      taskType,
    }
  }

  const { apiKey } = await getProviderConfig(job.data.userId, 'bailian')
  const input: VoiceDesignInput = { voicePrompt, previewText, preferredName, language }
  const designed = await createVoiceDesign(input, apiKey)
  if (!designed.success) {
    throw new Error(designed.error || '声音设计失败')
  }

  await reportTaskProgress(job, 96, {
    stage: 'voice_design_done',
    stageLabel: '声音设计完成',
    displayMode: 'detail',
  })

  return {
    success: true,
    voiceId: designed.voiceId,
    targetModel: designed.targetModel,
    voiceType: 'qwen-designed',
    audioBase64: designed.audioBase64,
    sampleRate: designed.sampleRate,
    responseFormat: designed.responseFormat,
    usageCount: designed.usageCount,
    requestId: designed.requestId,
    taskType,
  }
}
