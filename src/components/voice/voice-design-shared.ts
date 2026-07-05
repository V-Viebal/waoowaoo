export const DEFAULT_VOICE_SCHEME_COUNT = 3
export const MIN_VOICE_SCHEME_COUNT = 1
export const MAX_VOICE_SCHEME_COUNT = 10

export const COSYVOICE_TARGET_MODELS = [
  'cosyvoice-v3.5-plus',
  'cosyvoice-v3.5-flash',
  'cosyvoice-v3-plus',
  'cosyvoice-v3-flash',
  'cosyvoice-v2',
] as const
export type CosyVoiceTargetModel = (typeof COSYVOICE_TARGET_MODELS)[number]

export const COSYVOICE_LANGUAGE_HINTS = ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'ru', 'pt', 'th', 'id', 'vi'] as const
export type CosyVoiceLanguageHint = (typeof COSYVOICE_LANGUAGE_HINTS)[number]

export type VoiceDesignProvider = 'bailian' | 'omnivoice'
/** User-facing engine: only OmniVoice and CosyVoice. Qwen is legacy hidden from UI. */
export type VoiceDesignEngine = 'omnivoice' | 'cosyvoice'
export type BailianDesignFlavor = 'qwen' | 'cosyvoice-design' | 'cosyvoice-clone'
export type CloneEngine = 'omnivoice' | 'cosyvoice'

/** Map the user-facing design engine to (provider, flavor) for the API payload. */
export function resolveDesignApiTarget(engine: VoiceDesignEngine): { provider: VoiceDesignProvider; flavor?: BailianDesignFlavor } {
  if (engine === 'omnivoice') return { provider: 'omnivoice' }
  return { provider: 'bailian', flavor: 'cosyvoice-design' }
}

export interface CosyVoiceDesignExtras {
  prefix?: string
  targetModel?: CosyVoiceTargetModel
  languageHints?: [CosyVoiceLanguageHint]
}

export interface CosyVoiceCloneExtras {
  prefix?: string
  targetModel?: CosyVoiceTargetModel
  languageHints?: [CosyVoiceLanguageHint]
  audioStorageKey: string
  maxPromptAudioLength?: number
  enablePreprocess?: boolean
}

export type VoiceDesignMutationPayload = {
  voicePrompt: string
  previewText: string
  preferredName: string
  language: 'zh'
  provider?: VoiceDesignProvider
  flavor?: BailianDesignFlavor
} & Partial<CosyVoiceDesignExtras>

export type VoiceDesignMutationResult = {
  voiceId?: string
  // CosyVoice clone does not return a preview audio — audioBase64 may be absent.
  audioBase64?: string
  targetModel?: string
  flavor?: string
  detail?: string
}

export type GeneratedVoice = {
  voiceId: string
  audioBase64: string
  audioUrl: string
  hasPreview: boolean
}

export function normalizeVoiceSchemeCount(input: string | number | undefined): number {
  const rawValue = typeof input === 'number' ? input : Number.parseInt(input ?? '', 10)
  if (!Number.isFinite(rawValue)) return DEFAULT_VOICE_SCHEME_COUNT
  return Math.min(MAX_VOICE_SCHEME_COUNT, Math.max(MIN_VOICE_SCHEME_COUNT, rawValue))
}

export function createVoiceDesignPreferredName(index: number, now: () => number = Date.now): string {
  return `voice_${now().toString(36)}_${index + 1}`.slice(0, 16)
}

interface GenerateVoiceDesignOptionsParams {
  count: string | number | undefined
  voicePrompt: string
  previewText: string
  defaultPreviewText: string
  language?: 'zh'
  provider?: VoiceDesignProvider
  flavor?: BailianDesignFlavor
  cosyvoiceExtras?: CosyVoiceDesignExtras
  onDesignVoice: (payload: VoiceDesignMutationPayload) => Promise<VoiceDesignMutationResult>
  createPreferredName?: (index: number) => string
}

export async function generateVoiceDesignOptions({
  count,
  voicePrompt,
  previewText,
  defaultPreviewText,
  language = 'zh',
  provider,
  flavor,
  cosyvoiceExtras,
  onDesignVoice,
  createPreferredName = (index) => createVoiceDesignPreferredName(index),
}: GenerateVoiceDesignOptionsParams): Promise<GeneratedVoice[]> {
  const trimmedPrompt = voicePrompt.trim()
  if (!trimmedPrompt) throw new Error('VOICE_PROMPT_REQUIRED')

  const resolvedPreviewText = previewText.trim() || defaultPreviewText
  const resolvedCount = normalizeVoiceSchemeCount(count)
  const voices: GeneratedVoice[] = []

  for (let index = 0; index < resolvedCount; index += 1) {
    const payload: VoiceDesignMutationPayload = {
      voicePrompt: trimmedPrompt,
      previewText: resolvedPreviewText,
      preferredName: createPreferredName(index),
      language,
    }
    if (provider !== undefined) payload.provider = provider
    if (flavor !== undefined) payload.flavor = flavor
    if (flavor === 'cosyvoice-design' && cosyvoiceExtras) {
      Object.assign(payload, cosyvoiceExtras)
    }
    const result = await onDesignVoice(payload)

    if (typeof result.voiceId !== 'string' || result.voiceId.length === 0) {
      throw new Error('VOICE_DESIGN_INVALID_RESPONSE: missing voiceId')
    }

    // CosyVoice 在部分情况下返回 voiceId 但无 preview_audio——仍视为成功,
    // 只是 UI 上不能试听,hasPreview=false。
    const hasPreview = !!result.audioBase64
    voices.push({
      voiceId: result.voiceId,
      audioBase64: result.audioBase64 || '',
      audioUrl: hasPreview ? `data:audio/wav;base64,${result.audioBase64}` : '',
      hasPreview,
    })
  }

  if (voices.length === 0) throw new Error('VOICE_DESIGN_EMPTY_RESULT')

  return voices
}
