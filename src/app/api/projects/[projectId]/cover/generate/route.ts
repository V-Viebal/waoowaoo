import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'

const VALID_RATIOS = new Set(['1:1', '16:9', '9:16'])

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/**
 * POST /api/projects/[projectId]/cover/generate
 * 提交生成项目封面图任务
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const rawBody = await request.json().catch(() => ({} as Record<string, unknown>))
  const body = toObject(rawBody)

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { novelPromotionData: true },
  })
  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  const description = (project.description || '').trim()
  let hasContent = description.length > 0
  if (!hasContent) {
    const characterCount = await prisma.novelPromotionCharacter.count({
      where: { novelPromotionProject: { projectId } },
    })
    if (characterCount > 0) {
      hasContent = true
    }
  }
  if (!hasContent) {
    const episodeCount = await prisma.novelPromotionEpisode.count({
      where: { novelPromotionProject: { projectId } },
    })
    if (episodeCount > 0) {
      hasContent = true
    }
  }

  if (!hasContent) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'NO_CONTENT_FOR_COVER',
      message: 'Project has no description, characters, or episodes',
    })
  }

  const npData = project.novelPromotionData

  const bodyRatio = typeof body.ratio === 'string' ? body.ratio : ''
  const savedRatio = typeof npData?.coverImageRatio === 'string' ? npData.coverImageRatio : ''
  const ratio = VALID_RATIOS.has(bodyRatio)
    ? bodyRatio
    : VALID_RATIOS.has(savedRatio)
      ? savedRatio
      : '1:1'

  const imageModel =
    npData?.imageModel ||
    npData?.storyboardModel ||
    npData?.characterModel ||
    npData?.locationModel ||
    null

  if (!imageModel) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'IMAGE_MODEL_NOT_CONFIGURED',
      message: 'No image model is configured for this project',
    })
  }

  const payload: Record<string, unknown> = {
    imageModel,
    ratio,
    resolution: npData?.imageResolution || undefined,
  }

  const locale = resolveRequiredTaskLocale(request, body)

  const result = await submitTask({
    userId: session.user.id,
    locale,
    projectId,
    type: TASK_TYPE.IMAGE_PROJECT_COVER,
    targetType: 'project',
    targetId: projectId,
    payload,
    dedupeKey: `${TASK_TYPE.IMAGE_PROJECT_COVER}:${projectId}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_PROJECT_COVER, payload),
  })

  return NextResponse.json({ taskId: result.taskId })
})
