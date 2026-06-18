import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { chatCompletion } from '@/lib/llm/chat-completion'
import { getCompletionParts } from '@/lib/llm/completion-parts'

/**
 * 生成画风提示词的 API
 * 根据画风名称和描述，生成对应的 AI 绘画提示词
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json() as { name?: string; description?: string; model?: string }
  const { name, description, model } = body

  if (!name?.trim()) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MISSING_NAME',
      message: '画风名称不能为空',
    })
  }

  if (!model?.trim()) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MISSING_MODEL',
      message: '请选择生成模型',
    })
  }

  const systemPrompt = `你是一个专业的 AI 绘画提示词专家。请根据用户提供的画风名称和描述，生成详细的、高质量的 AI 绘画提示词。

要求：
1. 生成的提示词应该是英文的，因为大多数图像模型对英文提示理解更好
2. 提示词应该包含：风格关键词、视觉元素、色彩风格、构图特点、光影效果等
3. 同时生成一段中文描述，解释这个画风的特点和适用场景
4. 返回 JSON 格式，包含 prompt 和 description 两个字段

示例返回：
{
  "prompt": "cyberpunk cityscape, neon lights, rainy night, futuristic architecture, holographic advertisements, high contrast, vibrant colors, cinematic lighting, 8k resolution, photorealistic",
  "description": "赛博朋克风格，以霓虹灯光、雨夜和未来建筑为特点，适合创作科幻主题作品"
}`

  const userMessage = `请为以下画风生成提示词：
画风名称：${name.trim()}
${description?.trim() ? `画风描述：${description.trim()}` : ''}`

  try {
    const completion = await chatCompletion(
      session.user.id,
      model.trim(),
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        temperature: 0.7,
        reasoning: false,
        action: 'art_style_prompt_generation',
      },
    )

    const parts = getCompletionParts(completion)
    let result: { prompt: string; description: string }

    try {
      // 尝试从响应中解析 JSON
      const text = parts.text.trim()
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0])
      } else {
        // 如果没有 JSON 格式，直接使用文本作为 prompt
        result = {
          prompt: text,
          description: description || '',
        }
      }
    } catch {
      // 解析失败时使用原始文本
      result = {
        prompt: parts.text.trim(),
        description: description || '',
      }
    }

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成失败'
    throw new ApiError('INTERNAL_ERROR', {
      code: 'GENERATION_FAILED',
      message: `提示词生成失败: ${message}`,
    })
  }
})
