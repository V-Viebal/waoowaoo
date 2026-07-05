import { beforeEach, describe, expect, it, vi } from 'vitest'

const createChatCompletionMock = vi.hoisted(() =>
  vi.fn(async () => ({
    id: 'chatcmpl_bailian',
    object: 'chat.completion',
    created: 1,
    model: 'qwen3.5-plus',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'ok' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
    },
  })),
)

const openAiCtorMock = vi.hoisted(() =>
  vi.fn(() => ({
    chat: {
      completions: {
        create: createChatCompletionMock,
      },
    },
  })),
)

vi.mock('openai', () => ({
  default: openAiCtorMock,
}))

import { completeBailianLlm } from '@/lib/providers/bailian/llm'

describe('bailian llm provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls dashscope openai-compatible endpoint for registered qwen model', async () => {
    const completion = await completeBailianLlm({
      modelId: 'qwen3.5-plus',
      messages: [{ role: 'user', content: 'hello' }],
      apiKey: 'bl-key',
      temperature: 0.2,
    })

    expect(openAiCtorMock).toHaveBeenCalledWith({
      apiKey: 'bl-key',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      timeout: 30_000,
    })
    expect(createChatCompletionMock).toHaveBeenCalledWith({
      model: 'qwen3.5-plus',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.2,
    })
    expect(completion.choices[0]?.message?.content).toBe('ok')
  })

  it('forwards custom model ids verbatim (validation happens at selection time, not at call time)', async () => {
    createChatCompletionMock.mockResolvedValueOnce({
      id: 'chatcmpl_custom',
      object: 'chat.completion',
      created: 1,
      model: 'custom-qwen',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
    const completion = await completeBailianLlm({
      modelId: 'custom-qwen',
      messages: [{ role: 'user', content: 'hello' }],
      apiKey: 'bl-key',
    })
    expect(createChatCompletionMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'custom-qwen' }))
    expect(completion.choices[0]?.message?.content).toBe('ok')
  })
})
