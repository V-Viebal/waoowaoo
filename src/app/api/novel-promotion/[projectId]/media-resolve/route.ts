import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getMediaObjectById } from '@/lib/media/service'
import { toFetchableUrl } from '@/lib/storage'
import { isMediaObjRef, extractMediaObjectId } from '@/lib/twick/media-ref'

/**
 * POST /api/novel-promotion/[projectId]/media-resolve
 * 批量解析 mediaobj:// 引用为可访问的 HTTP URL
 */
export const POST = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params

    // 🔐 统一权限验证
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const body = await request.json()
    const { refs } = body as { refs?: string[] }

    if (!Array.isArray(refs) || refs.length === 0) {
        return NextResponse.json({ urls: {} })
    }

    // 过滤出有效的 mediaobj 引用
    const mediaObjRefs = refs.filter(ref => isMediaObjRef(ref))
    const resolvedUrls: Record<string, string> = {}

    await Promise.all(mediaObjRefs.map(async (ref) => {
        const mediaObjectId = extractMediaObjectId(ref)
        if (!mediaObjectId) return

        const mediaObject = await getMediaObjectById(mediaObjectId)
        if (!mediaObject || !mediaObject.url) return

        // 转换为可直接访问的 URL
        resolvedUrls[ref] = toFetchableUrl(mediaObject.url)
    }))

    return NextResponse.json({ urls: resolvedUrls })
})
