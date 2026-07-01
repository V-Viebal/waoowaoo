import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { TwickTimelineProject } from '@/lib/twick/types'
import { isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireOwnedProject } from './_auth'

const MAX_PROJECT_DATA_JSON_CHARS = 5 * 1024 * 1024
const MEDIA_OBJ_PREFIX = 'mediaobj://'
const MEDIA_FIELD_KEYS = new Set([
  'src',
  'source',
  'url',
  'poster',
  'posterSrc',
  'maskSrc',
  'imageSrc',
  'videoSrc',
  'audioSrc',
])

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

function isMediaFieldKey(key: string) {
  return MEDIA_FIELD_KEYS.has(key) || key.endsWith('Src') || key.endsWith('Url')
}

function isMediaElementRecord(record: Record<string, unknown>) {
  return record.type === 'video' || record.type === 'audio' || record.type === 'image'
}

function isPropsPath(pathParts: string[]) {
  return pathParts[pathParts.length - 1] === 'props'
}

function assertValidMediaSources(value: unknown, mediaContext = false, pathParts: string[] = []): void {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (mediaContext && trimmed && !(value.startsWith(MEDIA_OBJ_PREFIX) && value.slice(MEDIA_OBJ_PREFIX.length).trim().length > 0)) {
      throw new ApiError('INVALID_PARAMS', {
        message: 'EDITOR_RENDER_INVALID_MEDIA_SOURCE',
        path: pathParts.join('.') || 'media',
      })
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertValidMediaSources(item, mediaContext, [...pathParts, String(index)]))
    return
  }
  if (!value || typeof value !== 'object') return

  const record = value as Record<string, unknown>
  const isMediaElement = isMediaElementRecord(record)
  const insideProps = isPropsPath(pathParts)
  for (const [key, entryValue] of Object.entries(record)) {
    const nextMediaContext = mediaContext || (isMediaFieldKey(key) && (insideProps || isMediaElement))
    assertValidMediaSources(entryValue, nextMediaContext, [...pathParts, key])
  }
}

function assertValidProjectData(projectData: unknown): asserts projectData is TwickTimelineProject {
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

  assertValidMediaSources(projectData)
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
  const projectDataJson = projectData as unknown as Prisma.InputJsonValue

  if (version !== undefined && (typeof version !== 'number' || !Number.isInteger(version) || version < 0)) {
    throw new ApiError('INVALID_PARAMS')
  }
  const submittedVersion = version

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
          projectData: projectDataJson,
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
      projectData: projectDataJson,
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
