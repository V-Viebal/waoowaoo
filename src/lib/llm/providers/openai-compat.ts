import OpenAI from 'openai'

export function buildOpenAIChatCompletion(
    modelId: string,
    content: unknown,
    usage?: { promptTokens?: number; completionTokens?: number },
    reasoning?: string
): OpenAI.Chat.Completions.ChatCompletion {
    let messageContent: OpenAI.Chat.Completions.ChatCompletionMessage['content']
    if (Array.isArray(content)) {
        // Already structured content format (from buildReasoningAwareContent)
        messageContent = content as unknown as OpenAI.Chat.Completions.ChatCompletionMessage['content']
    } else if (reasoning && reasoning.trim()) {
        // When reasoning is provided, use structured content format
        // This matches the format extractCompletionPartsFromContent expects
        messageContent = [
            { type: 'reasoning', text: reasoning.trim() },
            { type: 'text', text: String(content ?? '') },
        ] as unknown as OpenAI.Chat.Completions.ChatCompletionMessage['content']
    } else {
        messageContent = typeof content === 'string' ? content : String(content ?? '')
    }
    const promptTokens = usage?.promptTokens ?? 0
    const completionTokens = usage?.completionTokens ?? 0
    return {
        id: `chatcmpl_${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [
            {
                index: 0,
                message: { role: 'assistant', content: messageContent },
                finish_reason: 'stop'
            }
        ],
        usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens
        }
    } as OpenAI.Chat.Completions.ChatCompletion
}
