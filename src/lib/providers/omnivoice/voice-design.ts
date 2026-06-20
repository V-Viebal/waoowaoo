import { getOmnivoiceClient } from './client'
import { mapOmnivoiceError } from './error-mapping'
import { buildOmnivoiceProfileName } from './voice-clone'
import { validateOmnivoiceInstruct, translateInstructToEnglish } from './instruct-vocabulary'
import { logInfo as _ulogInfo } from '@/lib/logging/core'
import type { OmnivoiceDesignParams, OmnivoiceDesignResult } from './types'

const DEFAULT_VD_STATES = { Style: 'Auto' as const }
const DEFAULT_NUM_STEP = 24

export async function createOmnivoiceVoiceDesign(
  params: OmnivoiceDesignParams,
): Promise<OmnivoiceDesignResult> {
  const voicePrompt = params.voicePrompt?.trim() ?? ''
  const previewText = params.previewText?.trim() ?? ''
  const userId = params.userId?.trim() ?? ''
  if (!voicePrompt) {
    return { success: false, error: '声音描述必填', errorCode: 'OMNIVOICE_VOICE_PROMPT_REQUIRED' }
  }
  if (!previewText) {
    return { success: false, error: '预览文本必填', errorCode: 'OMNIVOICE_PREVIEW_TEXT_REQUIRED' }
  }
  if (!userId) {
    return { success: false, error: '用户ID必填', errorCode: 'OMNIVOICE_USER_ID_REQUIRED' }
  }

  // OmniVoice 后端的 instruct 字段是受控词表,自由文本会被拒。提交前
  // 在客户端先校验一遍,把人话(「青年男主音」)挡在外面,正确的中文/英文
  // 标签则规范化(去重 + 正确分隔符)再交给 SDK。
  const instructValidation = validateOmnivoiceInstruct(voicePrompt)
  if (!instructValidation.ok) {
    return { success: false, error: instructValidation.message, errorCode: instructValidation.errorCode }
  }

  // 把中文 instruct 翻译成英文再送后端。
  // 原因:OmniVoice 后端对中文 instruct 的校验不稳定,偶发退化为英文
  // 词表校验并报 "Valid English items" 错误。统一走英文路径保证稳定。
  // TTS 语言(profile.language / generateSpeech.language)保持用户期望的
  // 语言(通常是 'zh'),不受 instruct 语言影响。
  const { translated: backendInstruct, skipped } = translateInstructToEnglish(instructValidation)
  if (skipped.length > 0) {
    _ulogInfo(
      `[OmniVoice] instruct 翻译:跳过 ${skipped.length} 个无英文对应项的 token: ${skipped.join('、')}`,
    )
  }

  const preferredName = (params.preferredName ?? 'custom_voice').trim() || 'custom_voice'
  // language 是 TTS/输出语言,不是 instruct 的语言
  const ttsLanguage = (params.language ?? 'zh') as string
  // 随机 seed 保证每次生成的声线都有差异(默认 seed=42 会导致相同 instruct 产生完全相同的声音)
  const seed = Math.floor(Math.random() * 1_000_000)

  const ov = getOmnivoiceClient()
  try {
    const profile = await ov.design.createProfile({
      kind: 'design',
      name: buildOmnivoiceProfileName(userId, preferredName),
      vdStates: DEFAULT_VD_STATES,
      instruct: backendInstruct,
      language: ttsLanguage,
      seed,
    })

    const speech = await ov.design.generateSpeech({
      text: previewText,
      profileId: profile.id,
      language: ttsLanguage,
      numStep: DEFAULT_NUM_STEP,
    })

    return {
      success: true,
      profileId: profile.id,
      audioBase64: Buffer.from(speech.audio).toString('base64'),
      sampleRate: 24000,
      responseFormat: 'wav',
      requestId: speech.audioId,
    }
  } catch (err) {
    return { success: false, ...mapOmnivoiceError(err) }
  }
}
