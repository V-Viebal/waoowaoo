'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { AppIcon } from '@/components/ui/icons'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import VoiceDesignGeneratorSection from './VoiceDesignGeneratorSection'
import {
  COSYVOICE_LANGUAGE_HINTS,
  COSYVOICE_TARGET_MODELS,
  DEFAULT_VOICE_SCHEME_COUNT,
  generateVoiceDesignOptions,
  resolveDesignApiTarget,
  type CloneEngine,
  type CosyVoiceLanguageHint,
  type CosyVoiceTargetModel,
  type GeneratedVoice,
  type VoiceDesignEngine,
  type VoiceDesignMutationPayload,
  type VoiceDesignMutationResult,
  type VoiceDesignProvider,
} from './voice-design-shared'

export type { VoiceDesignMutationPayload, VoiceDesignMutationResult } from './voice-design-shared'

type CloneResult = {
  voiceId: string
  audioBase64?: string
}

interface VoiceDesignDialogBaseProps {
  isOpen: boolean
  speaker: string
  hasExistingVoice?: boolean
  onClose: () => void
  onSave: (voiceId: string, audioBase64: string | undefined, provider: VoiceDesignProvider) => void | Promise<void>
  onDesignVoice: (payload: VoiceDesignMutationPayload) => Promise<VoiceDesignMutationResult>
  /** AI 推荐声音描述。engine 标识当前使用的引擎,返回 instruct 写入 voicePrompt。 */
  onRecommendInstruct?: (engine: VoiceDesignEngine) => Promise<{ instruct: string }>
  /**
   * Clone flow(s).
   * - omnivoice: legacy — file upload straight to the backend (already handled by parent)
   * - cosyvoice: parent receives { file, prefix, targetModel, languageHint, maxPromptAudioLength, enablePreprocess }
   *   and is responsible for upload-temp → /voice-design flavour:cosyvoice-clone → persisting the voiceId.
   *   The dialog just collects inputs and reports the resulting voiceId back.
   */
  cloneEngines?: CloneEngine[]
  onOmniClone?: (file: File) => Promise<void>
  onCosyClone?: (params: {
    file: File
    prefix: string
    targetModel: CosyVoiceTargetModel
    languageHint: CosyVoiceLanguageHint
    maxPromptAudioLength: number
    enablePreprocess: boolean
  }) => Promise<CloneResult>
}

const DEFAULT_COSY_TARGET: CosyVoiceTargetModel = 'cosyvoice-v3.5-plus'
const DEFAULT_COSY_LANG: CosyVoiceLanguageHint = 'zh'
const DEFAULT_COSY_PREFIX = 'clone'
const DEFAULT_MAX_PROMPT_LEN = 10

function randomPrefix(): string {
  // ponytail: 4 位随机字母数字,避免多人同 prefix 冲突。
  return Math.random().toString(36).slice(2, 6)
}

export default function VoiceDesignDialogBase({
  isOpen,
  speaker,
  hasExistingVoice = false,
  onClose,
  onSave,
  onDesignVoice,
  onRecommendInstruct,
  cloneEngines,
  onOmniClone,
  onCosyClone,
}: VoiceDesignDialogBaseProps) {
  const t = useTranslations('common')
  const tv = useTranslations('voice.voiceDesign')
  const tvCreate = useTranslations('voice.voiceCreate')

  const [tab, setTab] = useState<'design' | 'clone'>('design')
  const [voicePrompt, setVoicePrompt] = useState('')
  const [previewText, setPreviewText] = useState(tv('defaultPreviewText'))
  const [schemeCount, setSchemeCount] = useState(String(DEFAULT_VOICE_SCHEME_COUNT))
  // ponytail: 设计引擎只保留 OmniVoice / CosyVoice,QwenTTS 隐藏(legacy 仍可后端调用)。
  const [engine, setEngine] = useState<VoiceDesignEngine>('cosyvoice')
  // CosyVoice design extras
  const [cosyPrefix, setCosyPrefix] = useState(randomPrefix())
  const [cosyTargetModel, setCosyTargetModel] = useState<CosyVoiceTargetModel>(DEFAULT_COSY_TARGET)
  const [cosyLang, setCosyLang] = useState<CosyVoiceLanguageHint>(DEFAULT_COSY_LANG)
  // Clone state
  const availableCloneEngines: CloneEngine[] = cloneEngines ?? [
    ...(onOmniClone ? ['omnivoice' as const] : []),
    ...(onCosyClone ? ['cosyvoice' as const] : []),
  ]
  const [cloneEngine, setCloneEngine] = useState<CloneEngine>(availableCloneEngines[0] ?? 'omnivoice')
  const [cloneFile, setCloneFile] = useState<File | null>(null)
  const [clonePrefix, setClonePrefix] = useState(DEFAULT_COSY_PREFIX)
  const [cloneTargetModel, setCloneTargetModel] = useState<CosyVoiceTargetModel>(DEFAULT_COSY_TARGET)
  const [cloneLang, setCloneLang] = useState<CosyVoiceLanguageHint>(DEFAULT_COSY_LANG)
  const [cloneMaxLen, setCloneMaxLen] = useState<number>(DEFAULT_MAX_PROMPT_LEN)
  const [clonePreprocess, setClonePreprocess] = useState<boolean>(true)

  const [isDesignSubmitting, setIsDesignSubmitting] = useState(false)
  const [isRecommending, setIsRecommending] = useState(false)
  const [isCloning, setIsCloning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatedVoices, setGeneratedVoices] = useState<GeneratedVoice[]>([])
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [playingIndex, setPlayingIndex] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const cloneInputRef = useRef<HTMLInputElement | null>(null)

  const designSubmittingState = isDesignSubmitting
    ? resolveTaskPresentationState({
        phase: 'processing',
        intent: 'generate',
        resource: 'audio',
        hasOutput: false,
      })
    : null

  const showCloneTab = availableCloneEngines.length > 0

  const isCosyDesign = engine === 'cosyvoice'
  const resolvedApiTarget = resolveDesignApiTarget(engine)

  const handleGenerate = async () => {
    if (!voicePrompt.trim()) {
      setError(tv('pleaseSelectStyle'))
      return
    }
    // CosyVoice design prefix validation
    if (isCosyDesign) {
      if (!/^[A-Za-z0-9]{1,10}$/.test(cosyPrefix)) {
        setError(tvCreate('prefixInvalid'))
        return
      }
    }

    setIsDesignSubmitting(true)
    setError(null)
    setGeneratedVoices([])
    setSelectedIndex(null)

    try {
      const voices = await generateVoiceDesignOptions({
        count: schemeCount,
        voicePrompt,
        previewText,
        defaultPreviewText: tv('defaultPreviewText'),
        provider: resolvedApiTarget.provider,
        flavor: resolvedApiTarget.flavor,
        cosyvoiceExtras: isCosyDesign
          ? {
              prefix: cosyPrefix,
              targetModel: cosyTargetModel,
              languageHints: [cosyLang],
            }
          : undefined,
        onDesignVoice,
      })
      setGeneratedVoices(voices)
    } catch (err: unknown) {
      const status = err instanceof Error ? (err as Error & { status?: number }).status : undefined
      if (status === 402) {
        const detail = err instanceof Error ? (err as Error & { detail?: string }).detail : undefined
        alert(t('insufficientBalance') + '\n\n' + (detail || t('insufficientBalanceDetail')))
        setError('INSUFFICIENT_BALANCE')
        return
      }

      const message = err instanceof Error ? err.message : tv('generationError')
      setError(message === 'VOICE_DESIGN_EMPTY_RESULT' ? tv('noVoiceGenerated') : (message || tv('generationError')))
    } finally {
      setIsDesignSubmitting(false)
    }
  }

  const handleRecommend = onRecommendInstruct
    ? async () => {
        setIsRecommending(true)
        setError(null)
        try {
          const { instruct } = await onRecommendInstruct(engine)
          if (instruct) {
            setVoicePrompt(instruct)
            setGeneratedVoices([])
            setSelectedIndex(null)
            setError(null)
          }
        } catch (err: unknown) {
          const status = err instanceof Error ? (err as Error & { status?: number }).status : undefined
          if (status === 402) {
            const detail = err instanceof Error ? (err as Error & { detail?: string }).detail : undefined
            alert(t('insufficientBalance') + '\n\n' + (detail || t('insufficientBalanceDetail')))
            setError(tv('aiRecommendError'))
            return
          }

          setError(tv('aiRecommendError'))
        } finally {
          setIsRecommending(false)
        }
      }
    : undefined

  const handlePlayVoice = (index: number) => {
    if (playingIndex === index && audioRef.current) {
      audioRef.current.pause()
      setPlayingIndex(null)
      return
    }

    if (audioRef.current) {
      audioRef.current.pause()
    }

    setPlayingIndex(index)
    const audio = new Audio(generatedVoices[index].audioUrl)
    audioRef.current = audio
    audio.onended = () => setPlayingIndex(null)
    audio.onerror = () => setPlayingIndex(null)
    void audio.play()
  }

  const [isSaving, setIsSaving] = useState(false)

  const handleConfirmSelection = () => {
    if (selectedIndex !== null && generatedVoices[selectedIndex]) {
      if (hasExistingVoice) {
        setShowConfirmDialog(true)
      } else {
        void doSave()
      }
    }
  }

  const doSave = async () => {
    if (selectedIndex === null || !generatedVoices[selectedIndex] || isSaving) return
    const voice = generatedVoices[selectedIndex]
    setIsSaving(true)
    setError(null)
    try {
      await onSave(voice.voiceId, voice.audioBase64 || undefined, resolvedApiTarget.provider)
      handleClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'save failed')
    } finally {
      setIsSaving(false)
    }
  }

  const handleClose = () => {
    setTab('design')
    setVoicePrompt('')
    setPreviewText(tv('defaultPreviewText'))
    setSchemeCount(String(DEFAULT_VOICE_SCHEME_COUNT))
    setEngine('cosyvoice')
    setCosyPrefix(randomPrefix())
    setCosyTargetModel(DEFAULT_COSY_TARGET)
    setCosyLang(DEFAULT_COSY_LANG)
    setError(null)
    setGeneratedVoices([])
    setSelectedIndex(null)
    setShowConfirmDialog(false)
    setPlayingIndex(null)
    setCloneFile(null)
    setCloneEngine(availableCloneEngines[0] ?? 'omnivoice')
    setClonePrefix(DEFAULT_COSY_PREFIX)
    setCloneTargetModel(DEFAULT_COSY_TARGET)
    setCloneLang(DEFAULT_COSY_LANG)
    setCloneMaxLen(DEFAULT_MAX_PROMPT_LEN)
    setClonePreprocess(true)
    setIsCloning(false)
    if (audioRef.current) {
      audioRef.current.pause()
    }
    onClose()
  }

  const handleCloneSubmit = async () => {
    if (!cloneFile) return
    setIsCloning(true)
    setError(null)
    try {
      if (cloneEngine === 'omnivoice') {
        if (!onOmniClone) throw new Error(tvCreate('cloneNotAvailable'))
        await onOmniClone(cloneFile)
        handleClose()
        return
      }
      // cosyvoice clone
      if (!onCosyClone) throw new Error(tvCreate('cloneNotAvailable'))
      if (!/^[A-Za-z0-9]{1,10}$/.test(clonePrefix)) {
        setError(tvCreate('prefixInvalid'))
        setIsCloning(false)
        return
      }
      const result = await onCosyClone({
        file: cloneFile,
        prefix: clonePrefix,
        targetModel: cloneTargetModel,
        languageHint: cloneLang,
        maxPromptAudioLength: cloneMaxLen,
        enablePreprocess: clonePreprocess,
      })
      // CosyVoice clone has no preview — save immediately with empty audioBase64.
      await onSave(result.voiceId, result.audioBase64, 'bailian')
      handleClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tvCreate('cloneFailed'))
    } finally {
      setIsCloning(false)
    }
  }

  if (!isOpen) return null
  if (typeof document === 'undefined') return null

  const dialogContent = (
    <>
      <div className="fixed inset-0 z-[9999] glass-overlay" onClick={handleClose} />
      <div
        className="fixed z-[10000] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 glass-surface-modal w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] shrink-0">
          <div className="flex items-center gap-2">
            <AppIcon name="mic" className="w-5 h-5 text-[var(--glass-tone-info-fg)]" />
            <h2 className="font-semibold text-[var(--glass-text-primary)]">{tv('designVoiceFor', { speaker })}</h2>
            {hasExistingVoice && (
              <span className="glass-chip glass-chip-warning text-xs px-1.5 py-0.5">{tv('hasExistingVoice')}</span>
            )}
          </div>
          <button onClick={handleClose} className="glass-btn-base glass-btn-soft p-1 text-[var(--glass-text-tertiary)]">
            <AppIcon name="close" className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {showCloneTab && (
            <SegmentedControl
              options={[
                { value: 'design' as const, label: tvCreate('aiDesignMode') },
                { value: 'clone' as const, label: tvCreate('cloneMode') },
              ]}
              value={tab}
              onChange={(val) => {
                setTab(val as 'design' | 'clone')
                setError(null)
              }}
            />
          )}

          {tab === 'design' && (
            <>
              <SegmentedControl
                options={[
                  { value: 'cosyvoice' as const, label: tvCreate('engineCosy') },
                  { value: 'omnivoice' as const, label: tvCreate('engineOmni') },
                ]}
                value={engine}
                onChange={(val) => {
                  setEngine(val as VoiceDesignEngine)
                  setVoicePrompt('')
                  setError(null)
                }}
              />

              {isCosyDesign && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-[var(--glass-text-tertiary)] block mb-1">{tvCreate('prefixLabel')}</label>
                    <input
                      type="text"
                      value={cosyPrefix}
                      maxLength={10}
                      onChange={(e) => setCosyPrefix(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 10))}
                      className="glass-input-base w-full px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--glass-text-tertiary)] block mb-1">{tvCreate('targetModelLabel')}</label>
                    <select
                      value={cosyTargetModel}
                      onChange={(e) => setCosyTargetModel(e.target.value as CosyVoiceTargetModel)}
                      className="glass-input-base w-full px-2 py-1.5 text-sm"
                    >
                      {COSYVOICE_TARGET_MODELS.map((m) => (
                        <option key={m} value={m} className="text-black">{m}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-[var(--glass-text-tertiary)] block mb-1">{tvCreate('languageLabel')}</label>
                    <select
                      value={cosyLang}
                      onChange={(e) => setCosyLang(e.target.value as CosyVoiceLanguageHint)}
                      className="glass-input-base w-full px-2 py-1.5 text-sm"
                    >
                      {COSYVOICE_LANGUAGE_HINTS.map((l) => (
                        <option key={l} value={l} className="text-black">{l}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <VoiceDesignGeneratorSection
                voicePrompt={voicePrompt}
                onVoicePromptChange={setVoicePrompt}
                previewText={previewText}
                onPreviewTextChange={setPreviewText}
                schemeCount={schemeCount}
                onSchemeCountChange={setSchemeCount}
                engine={engine}
                isSubmitting={isDesignSubmitting}
                submittingState={designSubmittingState}
                error={error}
                generatedVoices={generatedVoices}
                selectedIndex={selectedIndex}
                onSelectIndex={setSelectedIndex}
                playingIndex={playingIndex}
                onPlayVoice={handlePlayVoice}
                onGenerate={() => {
                  void handleGenerate()
                }}
                onRecommendInstruct={handleRecommend}
                isRecommending={isRecommending}
                footer={(
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => {
                        void handleGenerate()
                      }}
                      disabled={isDesignSubmitting}
                      className="glass-btn-base glass-btn-secondary flex-1 py-2 rounded-lg text-sm"
                    >
                      {tv('regenerate')}
                    </button>
                    <button
                      onClick={handleConfirmSelection}
                      disabled={selectedIndex === null}
                      className="glass-btn-base glass-btn-tone-success flex-1 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                    >
                      {tv('confirmUse')}
                    </button>
                  </div>
                )}
              />
            </>
          )}

          {tab === 'clone' && showCloneTab && (
            <div className="space-y-3">
              {availableCloneEngines.length > 1 && (
                <SegmentedControl
                  options={[
                    ...(onOmniClone ? [{ value: 'omnivoice' as const, label: tvCreate('cloneEngineOmni') }] : []),
                    ...(onCosyClone ? [{ value: 'cosyvoice' as const, label: tvCreate('cloneEngineCosy') }] : []),
                  ]}
                  value={cloneEngine}
                  onChange={(val) => {
                    setCloneEngine(val as CloneEngine)
                    setError(null)
                  }}
                />
              )}

              <div className="text-xs text-[var(--glass-text-tertiary)] bg-[var(--glass-tone-info-bg)] px-3 py-2 rounded-lg">
                {cloneEngine === 'cosyvoice' ? tvCreate('cosyCloneHint') : tvCreate('cloneHint')}
              </div>

              {cloneEngine === 'cosyvoice' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-[var(--glass-text-tertiary)] block mb-1">{tvCreate('prefixLabel')}</label>
                    <input
                      type="text"
                      value={clonePrefix}
                      maxLength={10}
                      onChange={(e) => setClonePrefix(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 10))}
                      className="glass-input-base w-full px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--glass-text-tertiary)] block mb-1">{tvCreate('targetModelLabel')}</label>
                    <select
                      value={cloneTargetModel}
                      onChange={(e) => setCloneTargetModel(e.target.value as CosyVoiceTargetModel)}
                      className="glass-input-base w-full px-2 py-1.5 text-sm"
                    >
                      {COSYVOICE_TARGET_MODELS.map((m) => (
                        <option key={m} value={m} className="text-black">{m}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-[var(--glass-text-tertiary)] block mb-1">{tvCreate('languageLabel')}</label>
                    <select
                      value={cloneLang}
                      onChange={(e) => setCloneLang(e.target.value as CosyVoiceLanguageHint)}
                      className="glass-input-base w-full px-2 py-1.5 text-sm"
                    >
                      {COSYVOICE_LANGUAGE_HINTS.map((l) => (
                        <option key={l} value={l} className="text-black">{l}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-[var(--glass-text-tertiary)] block mb-1">{tvCreate('maxPromptLenLabel')}</label>
                    <input
                      type="number"
                      min={3}
                      max={30}
                      value={cloneMaxLen}
                      onChange={(e) => setCloneMaxLen(Math.min(30, Math.max(3, Number(e.target.value) || DEFAULT_MAX_PROMPT_LEN)))}
                      className="glass-input-base w-full px-2 py-1.5 text-sm"
                    />
                  </div>
                  <label className="col-span-2 flex items-center gap-2 text-xs text-[var(--glass-text-secondary)]">
                    <input
                      type="checkbox"
                      checked={clonePreprocess}
                      onChange={(e) => setClonePreprocess(e.target.checked)}
                    />
                    {tvCreate('enablePreprocess')}
                  </label>
                </div>
              )}

              {!cloneFile ? (
                <div
                  onClick={() => cloneInputRef.current?.click()}
                  className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all border-[var(--glass-stroke-base)] hover:border-[var(--glass-stroke-focus)] hover:bg-[var(--glass-bg-muted)]"
                >
                  <div className="text-sm text-[var(--glass-text-secondary)] mb-2">{tvCreate('dropOrClick')}</div>
                  <div className="text-xs text-[var(--glass-text-tertiary)]">{tvCreate('supportedFormats')}</div>
                  <input
                    ref={cloneInputRef}
                    type="file"
                    accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        setCloneFile(file)
                        setError(null)
                      }
                    }}
                    className="hidden"
                  />
                </div>
              ) : (
                <div className="glass-surface-soft border border-[var(--glass-stroke-base)] rounded-xl p-4 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-[var(--glass-text-primary)] truncate">{cloneFile.name}</span>
                  <button onClick={() => setCloneFile(null)} className="glass-btn-base glass-btn-soft p-1 shrink-0">×</button>
                </div>
              )}

              {error && (
                <div className="text-sm text-[var(--glass-tone-danger-fg)] bg-[var(--glass-tone-danger-bg)] px-3 py-2 rounded-lg">
                  {error}
                </div>
              )}

              <button
                onClick={() => { void handleCloneSubmit() }}
                disabled={!cloneFile || isCloning}
                className="glass-btn-base glass-btn-tone-success w-full py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                {isCloning ? tvCreate('cloning') : tvCreate('cloneAndSave')}
              </button>
            </div>
          )}
        </div>
      </div>

      {showConfirmDialog && (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4 glass-overlay">
          <div className="glass-surface-modal w-full max-w-sm p-5 text-center">
            <div className="w-12 h-12 mx-auto glass-chip glass-chip-warning rounded-full flex items-center justify-center mb-3 p-0">
              <AppIcon name="alert" className="w-6 h-6 text-[var(--glass-tone-warning-fg)]" />
            </div>
            <h3 className="font-semibold text-[var(--glass-text-primary)] mb-1">{tv('confirmReplace')}</h3>
            <p className="text-sm text-[var(--glass-text-secondary)] mb-4">
              {tv('replaceWarning')}
              <span className="font-medium text-[var(--glass-text-primary)]">「{speaker}」</span>
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowConfirmDialog(false)}
                className="glass-btn-base glass-btn-secondary flex-1 py-2 rounded-lg text-sm"
              >
                {t('cancel')}
              </button>
              <button
                onClick={() => { void doSave() }}
                disabled={isSaving}
                className="glass-btn-base glass-btn-danger flex-1 py-2 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? '…' : tv('confirmReplaceBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  return createPortal(dialogContent, document.body)
}
