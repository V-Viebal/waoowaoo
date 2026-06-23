import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, isErrorResponse, notFound, unauthorized } from '@/lib/api-auth'
import { apiHandler, ApiError, getIdempotencyKey, getRequestId } from '@/lib/api-errors'
import { removeTaskJob } from '@/lib/task/queues'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { cancelTask, getTaskById } from '@/lib/task/service'
import { submitTask } from '@/lib/task/submitter'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { normalizeTaskError } from '@/lib/errors/normalize'
import { calculateEditorRenderBillingMinutes, calculateTwickTimelineDurationSeconds } from '@/lib/twick/caption-duration'

type RouteContext = { params: Promise<{ projectId: string }> }
type JsonRecord = Record<string, unknown>

const ACTIVE_TASK_STATUSES = [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] as const
const DEFAULT_RENDER_WIDTH = 720
const DEFAULT_RENDER_HEIGHT = 1280
const DEFAULT_RENDER_FPS = 30
const MIN_BILLING_MINUTES = 0.01

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readPositiveNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function readInteger(value: unknown, fallback: number): number {
  return Math.max(1, Math.floor(readPositiveNumber(value, fallback)))
}

function normalizeSettings(rawSettings: unknown, projectData: unknown) {
  const settings = asRecord(rawSettings) || {}
  const project = asRecord(projectData) || {}
  const metadata = asRecord(project.metadata) || {}
  const custom = asRecord(metadata.custom) || {}
  const properties = asRecord(project.properties) || {}

  return {
    width: readInteger(settings.width, readInteger(custom.width ?? properties.width ?? project.width, DEFAULT_RENDER_WIDTH)),
    height: readInteger(settings.height, readInteger(custom.height ?? properties.height ?? project.height, DEFAULT_RENDER_HEIGHT)),
    fps: readInteger(settings.fps, readInteger(custom.fps ?? properties.fps ?? project.fps, DEFAULT_RENDER_FPS)),
    bitrate: readString(settings.bitrate) || undefined,
    format: settings.format === 'webm' ? 'webm' : 'mp4',
    quality: readString(settings.quality) || 'high',
  }
}

function fingerprint(value: unknown): string {
  return createHash('sha1')
    .update(JSON.stringify(value) || '')
    .digest('hex')
    .slice(0, 16)
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

async function requireOwnedEditorProject(params: {
  projectId: string
  episodeId: string
  editorProjectId: string
}) {
  const editorProject = await prisma.novelPromotionEditorProject.findFirst({
    where: {
      id: params.editorProjectId,
      episodeId: params.episodeId,
      episode: {
        novelPromotionProject: {
          projectId: params.projectId,
        },
      },
    },
    select: {
      id: true,
      episodeId: true,
      projectData: true,
      renderStatus: true,
      renderTaskId: true,
      renderOutputMediaObjectId: true,
      renderSettings: true,
    },
  })

  if (!editorProject) {
    throw new ApiError('NOT_FOUND')
  }

  return editorProject
}

async function requireOwnedTask(params: { taskId: string; projectId: string; userId: string }) {
  const task = await getTaskById(params.taskId)
  if (
    !task
    || task.projectId !== params.projectId
    || task.userId !== params.userId
    || task.type !== TASK_TYPE.EDITOR_RENDER
    || task.targetType !== 'NovelPromotionEditorProject'
  ) {
    throw new ApiError('NOT_FOUND')
  }
  return task
}

export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const authResult = await requireOwnedProject(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json() as JsonRecord
  const episodeId = readString(body.episodeId)
  const editorProjectId = readString(body.editorProjectId)
  if (!episodeId || !editorProjectId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const editorProject = await requireOwnedEditorProject({ projectId, episodeId, editorProjectId })
  const settings = normalizeSettings(body.settings, editorProject.projectData)
  const durationSeconds = calculateTwickTimelineDurationSeconds(editorProject.projectData)
  const durationMinutes = calculateEditorRenderBillingMinutes(editorProject.projectData, MIN_BILLING_MINUTES)
  const requestId = getRequestId(request) || null
  const clientRequestId = readString(body.requestId) || request.headers.get('x-request-id') || getIdempotencyKey(request)
  const locale = resolveRequiredTaskLocale(request, body)

  const payload = {
    episodeId,
    editorProjectId,
    settings,
    durationSeconds,
    durationMinutes,
    quantity: durationMinutes,
    route: 'editor-render',
  }

  const lockResult = await prisma.novelPromotionEditorProject.updateMany({
    where: {
      id: editorProjectId,
      episodeId,
      renderStatus: { in: ['IDLE', 'FAILED', 'DONE'] },
    },
    data: {
      renderStatus: 'PROCESSING',
      renderTaskId: null,
      renderSettings: settings,
    },
  })
  if (lockResult.count === 0) {
    const activeTask = await prisma.task.findFirst({
      where: {
        projectId,
        type: TASK_TYPE.EDITOR_RENDER,
        targetType: 'NovelPromotionEditorProject',
        targetId: editorProjectId,
        status: { in: [...ACTIVE_TASK_STATUSES] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    })
    throw new ApiError('CONFLICT', {
      message: 'Editor render task already in progress',
      taskId: activeTask?.id,
      status: activeTask?.status || editorProject.renderStatus,
    })
  }

  try {
    const result = await submitTask({
      userId: authResult.session.user.id,
      locale,
      requestId,
      projectId,
      episodeId,
      type: TASK_TYPE.EDITOR_RENDER,
      targetType: 'NovelPromotionEditorProject',
      targetId: editorProjectId,
      payload,
      dedupeKey: `editor-render:${editorProjectId}:${clientRequestId || fingerprint(payload)}`,
    })

    if (!result.deduped) {
      await prisma.novelPromotionEditorProject.update({
        where: { id: editorProjectId },
        data: {
          renderStatus: 'PROCESSING',
          renderTaskId: result.taskId,
          renderSettings: settings,
        },
      })
    }

    return NextResponse.json({
      data: {
        taskId: result.taskId,
        status: result.status,
        settings,
        durationSeconds,
        durationMinutes,
        deduped: result.deduped,
      },
    })
  } catch (error) {
    await prisma.novelPromotionEditorProject.updateMany({
      where: {
        id: editorProjectId,
        renderStatus: 'PROCESSING',
        renderTaskId: null,
      },
      data: { renderStatus: editorProject.renderStatus },
    }).catch(() => undefined)
    throw error
  }

})

export const GET = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const authResult = await requireOwnedProject(projectId)
  if (isErrorResponse(authResult)) return authResult

  const taskId = request.nextUrl.searchParams.get('taskId')?.trim()
  if (!taskId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const task = await requireOwnedTask({ taskId, projectId, userId: authResult.session.user.id })
  const editorProject = await prisma.novelPromotionEditorProject.findFirst({
    where: {
      id: task.targetId,
      episode: {
        novelPromotionProject: {
          projectId,
        },
      },
    },
    select: {
      id: true,
      renderStatus: true,
      renderOutputMediaObjectId: true,
      renderSettings: true,
      renderTaskId: true,
    },
  })

  return NextResponse.json({
    data: {
      task: {
        ...task,
        error: normalizeTaskError(task.errorCode, task.errorMessage),
      },
      editorProject,
    },
  })
})

export const DELETE = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const authResult = await requireOwnedProject(projectId)
  if (isErrorResponse(authResult)) return authResult

  const taskId = request.nextUrl.searchParams.get('taskId')?.trim()
  if (!taskId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const task = await requireOwnedTask({ taskId, projectId, userId: authResult.session.user.id })
  const { task: updatedTask, cancelled } = await cancelTask(taskId)
  if (!updatedTask) {
    throw new ApiError('NOT_FOUND')
  }

  if (cancelled) {
    await removeTaskJob(taskId).catch(() => false)
    if (task.status === TASK_STATUS.QUEUED || task.status === TASK_STATUS.PROCESSING) {
      await prisma.novelPromotionEditorProject.updateMany({
        where: {
          id: task.targetId,
          renderTaskId: taskId,
        },
        data: {
          renderStatus: task.status === TASK_STATUS.QUEUED ? 'IDLE' : 'FAILED',
        },
      })
    }
  }

  return NextResponse.json({
    data: {
      success: true,
      cancelled,
      task: {
        ...updatedTask,
        error: normalizeTaskError(updatedTask.errorCode, updatedTask.errorMessage),
      },
    },
  })
})
