import OpenAI from 'openai'
import type { StarRouterLlmMessage } from './types'

export interface StarRouterLlmCompletionParams {
  modelId: string
  messages: StarRouterLlmMessage[]
  apiKey: string
  baseUrl?: string
  temperature?: number
  stream?: boolean
}

// ponytail: LLM calls forward modelId verbatim to the OpenAI-compatible endpoint.
// User-configured custom models are validated at selection time (resolveModelSelection),
// so we don't enforce a hardcoded model catalog here — doing so blocks custom additions.
export async function completeStarRouterLlm(
  _params: StarRouterLlmCompletionParams,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const baseURL = typeof _params.baseUrl === 'string' && _params.baseUrl.trim()
    ? _params.baseUrl.trim()
    : 'https://starrouter.io/v1'
  const client = new OpenAI({
    apiKey: _params.apiKey,
    baseURL,
    timeout: 30_000,
  })
  const completion = await client.chat.completions.create({
    model: _params.modelId,
    messages: _params.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    temperature: _params.temperature ?? 0.7,
    stream: _params.stream ?? false,
  })
  return completion as OpenAI.Chat.Completions.ChatCompletion
}

export async function streamStarRouterLlm(
  _params: StarRouterLlmCompletionParams,
): Promise<AsyncIterable<unknown>> {
  const baseURL = typeof _params.baseUrl === 'string' && _params.baseUrl.trim()
    ? _params.baseUrl.trim()
    : 'https://starrouter.io/v1'
  const client = new OpenAI({
    apiKey: _params.apiKey,
    baseURL,
    timeout: 30_000,
  })
  const stream = await client.chat.completions.create({
    model: _params.modelId,
    messages: _params.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    temperature: _params.temperature ?? 0.7,
    stream: true,
  })
  return stream as AsyncIterable<unknown>
}
