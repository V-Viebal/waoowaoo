import { NextRequest, NextResponse } from 'next/server'

import { requireAdminAuth } from '@/lib/admin/auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { generateImage } from '@/lib/generator-api'
import { generateUniqueKey, uploadObject, getSignedUrl } from '@/lib/storage'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * 为画风生成预览图的管理员 API
 * 根据画风提示词生成真实的 AI 预览图片
 */
export const POST = apiHandler(async (request: NextRequest, { params }: { params: Promise<{ styleId: string }> }) => {
  const authResult = await requireAdminAuth()
  if (authResult instanceof Response) return authResult

  const { styleId } = await params

  // 验证画风是否存在
  const artStyle = await prisma.artStyle.findUnique({
    where: { id: styleId, scope: 'system' },
  })

  if (!artStyle) {
    return new Response(JSON.stringify({ error: '画风不存在' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 解析模型参数
  const body = await request.json() as { model?: string }
  const model = body.model?.trim()

  if (!model) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MISSING_MODEL',
      message: '请选择图片生成模型',
    })
  }

  // 使用画风的提示词生成图片
  const result = await generateImage(
    authResult.user.id,
    model,
    artStyle.prompt,
    {
      outputFormat: 'png',
    },
  )

  if (!result.success) {
    throw new ApiError('INTERNAL_ERROR', {
      code: 'GENERATION_FAILED',
      message: result.error || '图片生成失败',
    })
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
    const key = generateUniqueKey(`art-style-preview-${artStyle.name}`, 'png')
    await uploadObject(buffer, key, 3, 'image/png')
    previewImageUrl = getSignedUrl(key)
  }

  if (!previewImageUrl) {
    throw new ApiError('INTERNAL_ERROR', {
      code: 'GENERATION_FAILED',
      message: '未能获取图片 URL',
    })
  }

  // 更新画风的预览图 URL
  const updatedStyle = await prisma.artStyle.update({
    where: { id: styleId },
    data: {
      previewImageUrl,
      updatedByUserId: authResult.user.id,
    },
  })

  return NextResponse.json({
    previewImageUrl: updatedStyle.previewImageUrl,
    model,
  })
})
