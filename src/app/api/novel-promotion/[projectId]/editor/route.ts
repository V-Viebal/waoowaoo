import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, isErrorResponse, notFound, unauthorized } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

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

  if (typeof episodeId !== 'string' || !episodeId || projectData === undefined || projectData === null) {
    throw new ApiError('INVALID_PARAMS')
  }

  if (version !== undefined && (!Number.isInteger(version) || version < 0)) {
    throw new ApiError('INVALID_PARAMS')
  }

  await requireEpisode(projectId, episodeId)

  const existing = await prisma.novelPromotionEditorProject.findUnique({
    where: { episodeId },
    select: { id: true, version: true },
  })

  if (existing && existing.version !== version) {
    throw new ApiError('CONFLICT', {
      currentVersion: existing.version,
      message: 'Editor project has been modified elsewhere',
    })
  }

  const editorProject = await prisma.novelPromotionEditorProject.upsert({
    where: { episodeId },
    create: {
      episodeId,
      projectData,
      version: 1,
    },
    update: {
      projectData,
      version: { increment: 1 },
    },
    select: editorProjectSelect,
  })

  return NextResponse.json({ data: editorProject })
})
