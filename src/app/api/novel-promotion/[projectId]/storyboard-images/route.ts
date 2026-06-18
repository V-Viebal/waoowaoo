import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { resolveModelSelection } from '@/lib/api-config'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { getProjectModelConfig, resolveProjectModelCapabilityGenerationOptions } from '@/lib/config-service'
import { prisma } from '@/lib/prisma'
import {
  STORYBOARD_IMAGE_MODES,
  StoryboardGridCapacityError,
  StoryboardGridEmptyError,
  StoryboardPanelImageMissingError,
  parseStoryboardGridPreset,
} from '@/lib/storyboard-images/grid'
import {
  StoryboardImageNotFoundError,
  createCompositedStoryboardImage,
} from '@/lib/storyboard-images/service'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { withTaskUiPayload } from '@/lib/task/ui-payload'

async function findStoryboardAccessState(storyboardId: string) {
  return await prisma.novelPromotionStoryboard.findUnique({
    where: { id: storyboardId },
    select: {
      id: true,
      storyboardImageUrl: true,
      episode: {
        select: {
          novelPromotionProject: {
            select: {
              projectId: true,
            },
          },
        },
      },
    },
  })
}

async function submitAiStoryboardImageTask(input: {
  request: NextRequest
  body: Record<string, unknown>
  projectId: string
  storyboardId: string
  userId: string
  gridPreset: ReturnType<typeof parseStoryboardGridPreset>
}) {
  const storyboard = await findStoryboardAccessState(input.storyboardId)
  if (!storyboard || storyboard.episode.novelPromotionProject.projectId !== input.projectId) {
    throw new ApiError('NOT_FOUND')
  }

  const projectModelConfig = await getProjectModelConfig(input.projectId, input.userId)
  if (!projectModelConfig.storyboardModel) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'STORYBOARD_MODEL_NOT_CONFIGURED',
    })
  }
  try {
    await resolveModelSelection(input.userId, projectModelConfig.storyboardModel, 'image')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Storyboard image model is invalid'
    throw new ApiError('INVALID_PARAMS', {
      code: 'STORYBOARD_MODEL_INVALID',
      message,
    })
  }

  const capabilityOptions = await resolveProjectModelCapabilityGenerationOptions({
    projectId: input.projectId,
    userId: input.userId,
    modelType: 'image',
    modelKey: projectModelConfig.storyboardModel,
  })
  const billingPayload = {
    ...input.body,
    storyboardId: input.storyboardId,
    mode: STORYBOARD_IMAGE_MODES.AI_STORYBOARD,
    gridPreset: input.gridPreset,
    imageModel: projectModelConfig.storyboardModel,
    ...(Object.keys(capabilityOptions).length > 0 ? { generationOptions: capabilityOptions } : {}),
  }
  const locale = resolveRequiredTaskLocale(input.request, input.body)
  const hasOutputAtStart = typeof storyboard.storyboardImageUrl === 'string' && storyboard.storyboardImageUrl.trim().length > 0

  return await submitTask({
    userId: input.userId,
    locale,
    requestId: getRequestId(input.request),
    projectId: input.projectId,
    type: TASK_TYPE.STORYBOARD_IMAGE,
    targetType: 'NovelPromotionStoryboard',
    targetId: input.storyboardId,
    payload: withTaskUiPayload(billingPayload, {
      intent: hasOutputAtStart ? 'regenerate' : 'generate',
      hasOutputAtStart,
    }),
    dedupeKey: `storyboard_image:${input.storyboardId}:${input.gridPreset}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.STORYBOARD_IMAGE, billingPayload),
  })
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({}))
  const storyboardId = typeof body?.storyboardId === 'string' ? body.storyboardId.trim() : ''
  const mode = typeof body?.mode === 'string' ? body.mode : STORYBOARD_IMAGE_MODES.AI_STORYBOARD
  const gridPreset = parseStoryboardGridPreset(body?.gridPreset)

  if (!storyboardId) {
    throw new ApiError('INVALID_PARAMS')
  }

  if (
    mode !== STORYBOARD_IMAGE_MODES.AI_STORYBOARD
    && mode !== STORYBOARD_IMAGE_MODES.COMPOSITED_STORYBOARD
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'STORYBOARD_IMAGE_MODE_UNSUPPORTED',
      message: 'Unsupported storyboard image mode.',
    })
  }

  if (mode === STORYBOARD_IMAGE_MODES.AI_STORYBOARD) {
    const result = await submitAiStoryboardImageTask({
      request,
      body,
      projectId,
      storyboardId,
      userId: authResult.session.user.id,
      gridPreset,
    })
    return NextResponse.json(result)
  }

  try {
    const storyboardImage = await createCompositedStoryboardImage({
      projectId,
      storyboardId,
      userId: authResult.session.user.id,
      gridPreset,
    })
    return NextResponse.json({ storyboardImage })
  } catch (error) {
    if (error instanceof StoryboardImageNotFoundError) {
      throw new ApiError('NOT_FOUND')
    }
    if (error instanceof StoryboardGridCapacityError) {
      throw new ApiError('INVALID_PARAMS', {
        code: error.code,
        preset: error.preset,
        panelCount: error.panelCount,
        capacity: error.capacity,
      })
    }
    if (error instanceof StoryboardGridEmptyError) {
      throw new ApiError('INVALID_PARAMS', { code: error.code })
    }
    if (error instanceof StoryboardPanelImageMissingError) {
      throw new ApiError('INVALID_PARAMS', {
        code: error.code,
        missingPanelNumbers: error.missingPanelNumbers,
      })
    }
    throw error
  }
})
