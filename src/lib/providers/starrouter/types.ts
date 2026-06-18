export type StarRouterProviderKey = 'starrouter'

export interface StarRouterLlmMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface StarRouterLlmCompletionParams {
  modelId: string
  messages: StarRouterLlmMessage[]
  apiKey: string
  baseUrl?: string
  temperature?: number
}

export interface StarRouterGenerateRequestOptions {
  provider: string
  modelId: string
  modelKey: string
  duration?: number
  aspectRatio?: string
  size?: string
  n?: number
  temperature?: number
  max_tokens?: number
  stream?: boolean
  [key: string]: unknown
}

export interface StarRouterProbeStep {
  name: 'models' | 'credits'
  status: 'pass' | 'fail' | 'skip'
  message: string
  detail?: string
}

export interface StarRouterProbeResult {
  success: boolean
  steps: StarRouterProbeStep[]
}
