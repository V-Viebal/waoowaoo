import type OpenAI from 'openai'
import type { SiliconFlowLlmMessage } from './types'

export interface SiliconFlowLlmCompletionParams {
  modelId: string
  messages: SiliconFlowLlmMessage[]
  apiKey: string
  baseUrl?: string
  temperature?: number
}

// ponytail: siliconflow LLM is not yet implemented; kept for interface parity.
// Model catalog intentionally not enforced at this layer — see bailian/starrouter llm.ts.
export async function completeSiliconFlowLlm(
  _params: SiliconFlowLlmCompletionParams,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  throw new Error('OFFICIAL_PROVIDER_NOT_IMPLEMENTED: siliconflow llm')
}
