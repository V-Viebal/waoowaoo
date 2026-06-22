import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, isErrorResponse, notFound, unauthorized } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

const MAX_PROJECT_DATA_JSON_CHARS = 5 * 1024 * 1024

const editorProjectSelect = {
  id: true,
  episodeId: true,
  projectData: true,
  version: true,
  renderStatus: true,
  renderOutputMediaObjectId: true,
  renderSettings: true,
  renderTaskId: true,
  createdAt: true,
  updatedAt: true,
} as const

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

async function requireEpisode(projectId: string, episodeId: string) {
  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProject: { projectId },
    },
    select: { id: true },
  })

  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  return episode
}

function assertValidProjectData(projectData: unknown) {
  if (
    projectData === undefined
    || projectData === null
    || typeof projectData !== 'object'
    || Array.isArray(projectData)
  ) {
    throw new ApiError('INVALID_PARAMS')
  }

  let serialized: string
  try {
    serialized = JSON.stringify(projectData)
  } catch {
    throw new ApiError('INVALID_PARAMS')
  }

  if (serialized === undefined || serialized.length > MAX_PROJECT_DATA_JSON_CHARS) {
    throw new ApiError('INVALID_PARAMS')
  }
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

async function getCurrentVersion(episodeId: string) {
  const current = await prisma.novelPromotionEditorProject.findUnique({
    where: { episodeId },
    select: { version: true },
  })

  return current?.version
}

async function throwConflict(episodeId: string): Promise<never> {
  throw new ApiError('CONFLICT', {
    currentVersion: await getCurrentVersion(episodeId),
    message: 'Editor project has been modified elsewhere',
  })
}

/**
 * GET /api/novel-promotion/[projectId]/editor
 * 获取剧集的 Twick 编辑器项目数据
 */
export const GET = apiHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await params

  const authResult = await requireOwnedProject(projectId)
  if (isErrorResponse(authResult)) return authResult

  const episodeId = request.nextUrl.searchParams.get('episodeId')
  if (!episodeId) {
    throw new ApiError('INVALID_PARAMS')
  }

  await requireEpisode(projectId, episodeId)

  const editorProject = await prisma.novelPromotionEditorProject.findUnique({
    where: { episodeId },
    select: editorProjectSelect,
  })

  return NextResponse.json({ data: editorProject })
})

/**
 * PUT /api/novel-promotion/[projectId]/editor
 * 保存 Twick 编辑器项目数据（带乐观锁）
 */
export const PUT = apiHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await params

  const authResult = await requireOwnedProject(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { episodeId, projectData, version } = body as {
    episodeId?: unknown
    projectData?: unknown
    version?: unknown
  }

  if (typeof episodeId !== 'string' || !episodeId) {
    throw new ApiError('INVALID_PARAMS')
  }

  assertValidProjectData(projectData)

  if (version !== undefined && (!Number.isInteger(version) || version < 0)) {
    throw new ApiError('INVALID_PARAMS')
  }
  const submittedVersion = version as number | undefined

  await requireEpisode(projectId, episodeId)

  const existing = await prisma.novelPromotionEditorProject.findUnique({
    where: { episodeId },
    select: { id: true, version: true },
  })

  if (!existing) {
    try {
      const editorProject = await prisma.novelPromotionEditorProject.create({
        data: {
          episodeId,
          projectData,
          version: 1,
        },
        select: editorProjectSelect,
      })

      return NextResponse.json({ data: editorProject })
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        await throwConflict(episodeId)
      }
      throw error
    }
  }

  if (submittedVersion === undefined) {
    await throwConflict(episodeId)
  }

  const updateResult = await prisma.novelPromotionEditorProject.updateMany({
    where: {
      episodeId,
      version: submittedVersion,
    },
    data: {
      projectData,
      version: { increment: 1 },
    },
  })

  if (updateResult.count === 0) {
    await throwConflict(episodeId)
  }

  const editorProject = await prisma.novelPromotionEditorProject.findUniqueOrThrow({
    where: { episodeId },
    select: editorProjectSelect,
  })

  return NextResponse.json({ data: editorProject })
})
