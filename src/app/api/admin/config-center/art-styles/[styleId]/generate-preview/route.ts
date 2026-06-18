import { NextRequest, NextResponse } from 'next/server'

import { requireAdminAuth } from '@/lib/admin/auth'
import { apiHandler } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * 为画风生成预览图的管理员 API
 * 使用 picsum.photos 生成随机预览图作为占位实现
 * TODO: 未来替换为实际的 AI 图片生成服务（如 Stable Diffusion API 等）
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

  // 解析可选的模型参数
  const body = await request.json() as { model?: string }
  const model = body.model || 'default'

  // TODO: 此处为占位实现，使用 picsum.photos 生成随机图片
  // 未来可以替换为调用实际的 AI 图片生成服务
  // 参考用户侧实现：src/app/api/art-styles/generate-preview/route.ts
  const previewImageUrl = `https://picsum.photos/seed/${styleId}-${Date.now()}/400/400`

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
