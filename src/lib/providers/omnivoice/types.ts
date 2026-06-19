import type { BlobLike } from '@omnivoice/sdk'

export interface OmnivoiceTTSParams {
  text: string
  profileId: string
  language?: string
}

export interface OmnivoiceTTSResult {
  success: boolean
  audioData?: Buffer
  audioDuration?: number
  requestId?: string
  error?: string
  errorCode?: string
}

export interface OmnivoiceCloneParams {
  name: string
  refAudio: BlobLike
  refAudioFilename: string
  refText?: string
  language?: string
  userId: string
}

export interface OmnivoiceCloneResult {
  success: boolean
  profileId?: string
  error?: string
  errorCode?: string
}

export interface OmnivoiceDesignParams {
  voicePrompt: string
  previewText: string
  preferredName?: string
  language?: 'zh' | 'en'
  userId: string
}

export interface OmnivoiceDesignResult {
  success: boolean
  profileId?: string
  audioBase64?: string
  sampleRate?: number
  responseFormat?: string
  requestId?: string
  error?: string
  errorCode?: string
}
