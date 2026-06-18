import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { generateImage } from '@/lib/generator-api'
import { generateUniqueKey, uploadObject, getSignedUrl } from '@/lib/storage'

/**
 * 生成画风预览图的 API
 * 根据画风提示词生成预览图片
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json() as {
    prompt?: string
    model?: string
    styleName?: string
  }
  const { prompt, model, styleName } = body

  if (!prompt?.trim()) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MISSING_PROMPT',
      message: '提示词不能为空',
    })
  }

  if (!model?.trim()) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MISSING_MODEL',
      message: '请选择图片生成模型',
    })
  }

  try {
    // 生成图片
    const result = await generateImage(
      session.user.id,
      model.trim(),
      prompt.trim(),
      {
        outputFormat: 'png',
      },
    )

    if (!result.success) {
      throw new Error(result.error || '图片生成失败')
    }

    let previewImageUrl: string | null = null

    // 优先使用返回的 URL
    if (result.imageUrl) {
      previewImageUrl = result.imageUrl
    } else if (result.imageUrls && result.imageUrls.length > 0) {
      previewImageUrl = result.imageUrls[0]
    } else if (result.imageBase64) {
      // 如果返回 base64，上传到存储
      const base64Data = result.imageBase64.replace(/^data:image\/\w+;base64,/, '')
      const buffer = Buffer.from(base64Data, 'base64')
      const key = generateUniqueKey(`art-style-preview-${styleName?.trim() || 'preview'}`, 'png')
      await uploadObject(buffer, key, 3, 'image/png')
      previewImageUrl = getSignedUrl(key)
    }

    if (!previewImageUrl) {
      throw new Error('未能获取图片 URL')
    }

    return NextResponse.json({
      success: true,
      previewImageUrl,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成失败'
    throw new ApiError('INTERNAL_ERROR', {
      code: 'GENERATION_FAILED',
      message: `预览图生成失败: ${message}`,
    })
  }
})
