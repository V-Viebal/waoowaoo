import type { Job } from 'bullmq'
import {
  createVoiceDesign,
  validatePreviewText,
  validateVoicePrompt,
  validateVoicePrefix,
  type CosyVoiceCloneInput,
  type CosyVoiceDesignInput,
  type QwenVoiceDesignInput,
} from '@/lib/providers/bailian/voice-design'
import { createOmnivoiceVoiceDesign, OMNIVOICE_TTS_MODEL_ID } from '@/lib/providers/omnivoice'
import { getProviderConfig } from '@/lib/api-config'
import { getSignedObjectUrl } from '@/lib/storage'
import { getPublicBaseUrl } from '@/lib/env'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`)
  }
  return value.trim()
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readLanguage(value: unknown): 'zh' | 'en' {
  return value === 'en' ? 'en' : 'zh'
}

function readProvider(value: unknown): 'bailian' | 'omnivoice' {
  return value === 'omnivoice' ? 'omnivoice' : 'bailian'
}

function readFlavor(value: unknown): 'qwen' | 'cosyvoice-design' | 'cosyvoice-clone' {
  if (value === 'cosyvoice-design' || value === 'cosyvoice-clone') return value
  return 'qwen'
}

type LanguageHint = 'zh' | 'en' | 'fr' | 'de' | 'ja' | 'ko' | 'ru' | 'pt' | 'th' | 'id' | 'vi'
const VALID_LANGUAGE_HINTS: Set<string> = new Set<LanguageHint>(['zh', 'en', 'fr', 'de', 'ja', 'ko', 'ru', 'pt', 'th', 'id', 'vi'])

function parseLanguageHints(raw: unknown): LanguageHint[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: LanguageHint[] = []
  for (const v of raw) {
    if (typeof v === 'string' && VALID_LANGUAGE_HINTS.has(v)) {
      out.push(v as LanguageHint)
      if (out.length >= 1) break
    }
  }
  return out.length ? out : undefined
}
const VALID_COSYVOICE_TARGETS = new Set([
  'cosyvoice-v3.5-plus',
  'cosyvoice-v3.5-flash',
  'cosyvoice-v3-plus',
  'cosyvoice-v3-flash',
  'cosyvoice-v2',
])

export async function handleVoiceDesignTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const provider = readProvider(payload.provider)

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
    const voicePrompt = readRequiredString(payload.voicePrompt, 'voicePrompt')
    const previewText = readRequiredString(payload.previewText, 'previewText')
    const preferredName = readOptionalString(payload.preferredName) || 'custom_voice'
    const language = readLanguage(payload.language)

    const pv = validateVoicePrompt(voicePrompt); if (!pv.valid) throw new Error(pv.error || 'invalid voicePrompt')
    const tv = validatePreviewText(previewText); if (!tv.valid) throw new Error(tv.error || 'invalid previewText')

    const designed = await createOmnivoiceVoiceDesign({
      voicePrompt, previewText, preferredName, language, userId: job.data.userId,
    })
    if (!designed.success) throw new Error(designed.error || '声音设计失败')

    await reportTaskProgress(job, 96, { stage: 'voice_design_done', stageLabel: '声音设计完成', displayMode: 'detail' })
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

  const flavor = readFlavor(payload.flavor)
  const { apiKey } = await getProviderConfig(job.data.userId, 'bailian')

  let voiceType: string

  if (flavor === 'cosyvoice-clone') {
    let audioUrl = readOptionalString(payload.audioUrl)
    const audioStorageKey = readOptionalString(payload.audioStorageKey)
    if (!audioUrl && audioStorageKey) {
      // ponytail: Dashscope 需要公网可访问的绝对 URL,用 getSignedObjectUrl (S3/MinIO/COS 预签名绝对地址)。
      // 本地存储 provider 返回相对路径 `/api/files/...`,拼上 NEXTAUTH_URL。
      const signed = await getSignedObjectUrl(audioStorageKey, 3600)
      audioUrl = signed.startsWith('http') ? signed : `${getPublicBaseUrl().replace(/\/$/, '')}${signed}`
    }
    if (!audioUrl) throw new Error('audioUrl is required for clone')

    // Cloud TTS provider must be able to fetch this URL — reject obviously-private hosts early
    // so the user sees a clear error instead of Bailian's opaque "InvalidParameter".
    let audioUrlParsed: URL
    try {
      audioUrlParsed = new URL(audioUrl)
    } catch {
      throw new Error('参考音频 URL 格式不合法')
    }
    const host = audioUrlParsed.hostname
    const isPubliclyReachable =
      audioUrlParsed.protocol === 'https:'
      && !['localhost', '127.0.0.1', '0.0.0.0', '::1', 'minio'].includes(host)
      && !host.endsWith('.local')
      && !host.endsWith('.internal')
    if (!isPubliclyReachable) {
      throw new Error(
        'CosyVoice 克隆需要公网可访问的音频 URL（当前为 '
        + `${audioUrlParsed.protocol}//${host}，Dashscope 无法拉取）。`
        + '请配置 STORAGE_TYPE=s3 且 MINIO_ENDPOINT 为公网域名，或直接在生产环境测试。',
      )
    }
    const prefix = readOptionalString(payload.prefix) || 'clone'
    const prefixCheck = validateVoicePrefix(prefix)
    if (!prefixCheck.valid) throw new Error(prefixCheck.error || 'invalid prefix')
    const rawTarget = readOptionalString(payload.targetModel) || 'cosyvoice-v3.5-plus'
    const targetModel = VALID_COSYVOICE_TARGETS.has(rawTarget) ? rawTarget : 'cosyvoice-v3.5-plus'
    const languageHints = parseLanguageHints(payload.languageHints)
    const maxPromptAudioLength = typeof payload.maxPromptAudioLength === 'number' && Number.isFinite(payload.maxPromptAudioLength)
      ? Math.min(30, Math.max(3, payload.maxPromptAudioLength))
      : 10
    const input: CosyVoiceCloneInput = {
      flavor: 'cosyvoice-clone',
      audioUrl,
      prefix,
      targetModel,
      languageHints,
      maxPromptAudioLength,
      enablePreprocess: payload.enablePreprocess === true,
    }
    // ponytail: voiceType 字段只用于 UI 标签和清理判断,统一保留 'qwen-designed'
    // 字面量,后续真正的路由按 modelId + voiceId 前缀走,不扩散类型。
    voiceType = 'qwen-designed'

    const designed = await createVoiceDesign(input, apiKey)
    if (!designed.success) throw new Error(designed.error || '声音克隆失败')
    await reportTaskProgress(job, 96, { stage: 'voice_design_done', stageLabel: '声音克隆完成', displayMode: 'detail' })
    return {
      success: true,
      voiceId: designed.voiceId,
      targetModel: designed.targetModel,
      voiceType,
      audioBase64: designed.audioBase64,
      sampleRate: designed.sampleRate,
      responseFormat: designed.responseFormat,
      usageCount: designed.usageCount,
      requestId: designed.requestId,
      flavor: designed.flavor,
      status: designed.status,
      taskType,
    }
  }

  if (flavor === 'cosyvoice-design') {
    const voicePrompt = readRequiredString(payload.voicePrompt, 'voicePrompt')
    let previewText = readRequiredString(payload.previewText, 'previewText')
    const pv = validateVoicePrompt(voicePrompt); if (!pv.valid) throw new Error(pv.error || 'invalid voicePrompt')
    const tv = validatePreviewText(previewText); if (!tv.valid) throw new Error(tv.error || 'invalid previewText')
    // ponytail: CosyVoice API 要求 preview_text ≥15 字符;用户默认文本「你好,很高兴认识你。」仅 9 字会失败。
    // 在 worker 侧统一补齐,避免 UI 端校验扩散。按语言追加通用语气垫字,不影响试听效果。
    const COSY_PREVIEW_MIN = 15
    if (Array.from(previewText).length < COSY_PREVIEW_MIN) {
      const pad = /[A-Za-z]/.test(previewText)
        ? ', this is a voice preview sample for testing the timbre.'
        : ',这是一段用于试听音色效果的示例文本。'
      previewText = (previewText + pad).slice(0, 200)
    }
    const prefix = readOptionalString(payload.prefix) || 'cv'
    const prefixCheck = validateVoicePrefix(prefix)
    if (!prefixCheck.valid) throw new Error(prefixCheck.error || 'invalid prefix')
    const rawTarget = readOptionalString(payload.targetModel) || 'cosyvoice-v3.5-plus'
    const targetModel = VALID_COSYVOICE_TARGETS.has(rawTarget) ? rawTarget : 'cosyvoice-v3.5-plus'
    const languageHints = parseLanguageHints(payload.languageHints)
    const input: CosyVoiceDesignInput = {
      flavor: 'cosyvoice-design',
      voicePrompt,
      previewText,
      prefix,
      targetModel,
      languageHints,
    }
    voiceType = 'qwen-designed'

    const designed = await createVoiceDesign(input, apiKey)
    if (!designed.success) throw new Error(designed.error || '声音设计失败')
    await reportTaskProgress(job, 96, { stage: 'voice_design_done', stageLabel: '声音设计完成', displayMode: 'detail' })
    return {
      success: true,
      voiceId: designed.voiceId,
      targetModel: designed.targetModel,
      voiceType,
      audioBase64: designed.audioBase64,
      sampleRate: designed.sampleRate,
      responseFormat: designed.responseFormat,
      usageCount: designed.usageCount,
      requestId: designed.requestId,
      flavor: designed.flavor,
      status: designed.status,
      taskType,
    }
  }

  // qwen (legacy)
  const voicePrompt = readRequiredString(payload.voicePrompt, 'voicePrompt')
  const previewText = readRequiredString(payload.previewText, 'previewText')
  const preferredName = readOptionalString(payload.preferredName) || 'custom_voice'
  const language = readLanguage(payload.language)
  const pv = validateVoicePrompt(voicePrompt); if (!pv.valid) throw new Error(pv.error || 'invalid voicePrompt')
  const tv = validatePreviewText(previewText); if (!tv.valid) throw new Error(tv.error || 'invalid previewText')
  const input: QwenVoiceDesignInput = { flavor: 'qwen', voicePrompt, previewText, preferredName, language }
  voiceType = 'qwen-designed'

  const designed = await createVoiceDesign(input, apiKey)
  if (!designed.success) throw new Error(designed.error || '声音设计失败')

  await reportTaskProgress(job, 96, { stage: 'voice_design_done', stageLabel: '声音设计完成', displayMode: 'detail' })

  return {
    success: true,
    voiceId: designed.voiceId,
    targetModel: designed.targetModel,
    voiceType,
    audioBase64: designed.audioBase64,
    sampleRate: designed.sampleRate,
    responseFormat: designed.responseFormat,
    usageCount: designed.usageCount,
    requestId: designed.requestId,
    flavor: designed.flavor,
    status: designed.status,
    taskType,
  }
}
