import { NextRequest, NextResponse } from 'next/server'
import type { ProjectJSON } from '@twick/timeline'
import { prisma } from '@/lib/prisma'
import { getAuthSession, isErrorResponse, notFound, unauthorized } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  buildSmartTransitionInputFromProject,
  recommendSmartTransitions,
} from '@/lib/novel-promotion/editor/smart-transition'

type RouteContext = { params: Promise<{ projectId: string }> }

type TransitionRequestBody = Record<string, unknown> & {
  episodeId?: unknown
  editorProjectId?: unknown
  fromElementId?: unknown
  toElementId?: unknown
}

async function requireOwnedProject(projectId: string) {
  const session = await getAuthSession()
  if (!session?.user?.id) {
    return unauthorized()
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId: session.user.id,
    },
    select: {
      id: true,
      userId: true,
      name: true,
    },
  })

  if (!project) {
    return notFound('Project')
  }

  return { session, project }
}

function readRequiredString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const authResult = await requireOwnedProject(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json() as TransitionRequestBody
  const episodeId = readRequiredString(body.episodeId)
  const editorProjectId = readRequiredString(body.editorProjectId)
  const fromElementId = readRequiredString(body.fromElementId)
  const toElementId = readRequiredString(body.toElementId)

  if (!episodeId || !editorProjectId || !fromElementId || !toElementId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const editorProject = await prisma.novelPromotionEditorProject.findFirst({
    where: {
      id: editorProjectId,
      episodeId,
      episode: {
        novelPromotionProject: {
          projectId,
        },
      },
    },
    select: {
      id: true,
      episodeId: true,
      projectData: true,
    },
  })

  if (!editorProject) {
    throw new ApiError('NOT_FOUND')
  }

  try {
    const transitionInput = buildSmartTransitionInputFromProject({
      projectData: editorProject.projectData as unknown as ProjectJSON,
      fromElementId,
      toElementId,
    })
    const recommendations = recommendSmartTransitions(transitionInput)

    return NextResponse.json({
      data: {
        from: transitionInput.from,
        to: transitionInput.to,
        recommendations,
        free: true,
        billing: null,
      },
    })
  } catch (error) {
    if (error instanceof Error) {
      throw new ApiError('INVALID_PARAMS', { message: error.message })
    }
    throw error
  }
})
