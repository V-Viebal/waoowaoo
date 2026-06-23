import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { generateUniqueKey, uploadObject } from '@/lib/storage'
import type { TaskJobData } from '@/lib/task/types'
import { isMediaObjRef, resolveMediaUrlForServerRender } from '@/lib/twick/media-url-resolver'
import { calculateTwickTimelineDurationSeconds } from '@/lib/twick/caption-duration'
import type { TwickTimelineProject } from '@/lib/twick/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'

type JsonRecord = Record<string, unknown>

type RenderSettings = {
  width: number
  height: number
  fps: number
  bitrate?: string
  format: 'mp4' | 'webm'
  quality?: string
}

const DEFAULT_RENDER_WIDTH = 720
const DEFAULT_RENDER_HEIGHT = 1280
const DEFAULT_RENDER_FPS = 30
const DEFAULT_RENDER_FORMAT: RenderSettings['format'] = 'mp4'
const RENDER_OUTPUT_DIR = path.join(os.tmpdir(), 'vvicat-twick-renders')

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

function readFormat(value: unknown): RenderSettings['format'] {
  return value === 'webm' ? 'webm' : DEFAULT_RENDER_FORMAT
}

function parseRenderPayload(job: Job<TaskJobData>) {
  const payload = asRecord(job.data.payload) || {}
  const episodeId = readString(payload.episodeId) || readString(job.data.episodeId) || null
  const editorProjectId = readString(payload.editorProjectId)
    || (job.data.targetType === 'NovelPromotionEditorProject' ? readString(job.data.targetId) : null)

  if (!episodeId) throw new Error('episodeId is required')
  if (!editorProjectId) throw new Error('editorProjectId is required')

  return {
    episodeId,
    editorProjectId,
    settings: asRecord(payload.settings) || {},
  }
}

function readProjectMetadata(projectData: unknown) {
  const project = asRecord(projectData) || {}
  const metadata = asRecord(project.metadata) || {}
  const custom = asRecord(metadata.custom) || {}
  const properties = asRecord(project.properties) || {}

  return {
    width: readPositiveNumber(custom.width ?? properties.width ?? project.width, DEFAULT_RENDER_WIDTH),
    height: readPositiveNumber(custom.height ?? properties.height ?? project.height, DEFAULT_RENDER_HEIGHT),
    fps: readPositiveNumber(custom.fps ?? properties.fps ?? project.fps, DEFAULT_RENDER_FPS),
    durationSeconds: calculateTwickTimelineDurationSeconds(project),
  }
}

function normalizeRenderSettings(projectData: unknown, rawSettings: JsonRecord): RenderSettings {
  const projectMeta = readProjectMetadata(projectData)
  return {
    width: Math.floor(readPositiveNumber(rawSettings.width, projectMeta.width)),
    height: Math.floor(readPositiveNumber(rawSettings.height, projectMeta.height)),
    fps: Math.floor(readPositiveNumber(rawSettings.fps, projectMeta.fps)),
    bitrate: readString(rawSettings.bitrate) || undefined,
    format: readFormat(rawSettings.format),
    quality: readString(rawSettings.quality) || 'high',
  }
}

function cloneWithProperties(projectData: TwickTimelineProject, settings: RenderSettings): JsonRecord {
  return {
    ...(projectData as unknown as JsonRecord),
    properties: {
      ...asRecord((projectData as unknown as JsonRecord).properties),
      width: settings.width,
      height: settings.height,
      fps: settings.fps,
    },
  }
}

type ServerRenderContext = {
  userId: string
  projectId: string
  editorProjectId: string
  episodeId: string
}

async function resolveMediaRefsDeep(value: unknown, context?: ServerRenderContext): Promise<unknown> {
  if (typeof value === 'string') {
    return isMediaObjRef(value) ? await resolveMediaUrlForServerRender(value, context) : value
  }
  if (Array.isArray(value)) {
    return await Promise.all(value.map((item) => resolveMediaRefsDeep(item, context)))
  }
  const record = asRecord(value)
  if (!record) return value

  const entries = await Promise.all(Object.entries(record).map(async ([key, entryValue]) => [
    key,
    await resolveMediaRefsDeep(entryValue, context),
  ] as const))
  return Object.fromEntries(entries)
}

export async function buildTwickRenderInput(projectData: unknown, settingsInput?: JsonRecord, context?: ServerRenderContext): Promise<{
  variables: JsonRecord
  settings: RenderSettings
  durationSeconds: number
}> {
  const projectRecord = asRecord(projectData)
  if (!projectRecord || !Array.isArray(projectRecord.tracks)) {
    throw new Error('EDITOR_PROJECT_TIMELINE_INVALID')
  }

  const settings = normalizeRenderSettings(projectData, settingsInput || {})
  const durationSeconds = readProjectMetadata(projectData).durationSeconds
  const input = cloneWithProperties(projectData as TwickTimelineProject, settings)
  const resolvedInput = await resolveMediaRefsDeep(input, context) as JsonRecord

  return {
    variables: { input: resolvedInput },
    settings,
    durationSeconds,
  }
}

function buildRenderOutputPath(taskId: string, format: RenderSettings['format']): string {
  return path.join(RENDER_OUTPUT_DIR, `editor-render-${taskId}.${format}`)
}

async function renderTwickVideoToFile(variables: JsonRecord, settings: RenderSettings, taskId: string): Promise<string> {
  await fs.mkdir(RENDER_OUTPUT_DIR, { recursive: true })
  const outFile = path.basename(buildRenderOutputPath(taskId, settings.format))
  const renderSettings = {
    outDir: RENDER_OUTPUT_DIR,
    outFile,
    quality: settings.quality || 'high',
    ...(settings.bitrate ? { bitrate: settings.bitrate } : {}),
  }
  const { renderTwickVideo } = await import('@twick/render-server')
  return await renderTwickVideo(variables, renderSettings)
}

async function uploadRenderedVideo(filePath: string, editorProjectId: string, settings: RenderSettings, durationSeconds: number) {
  const buffer = await fs.readFile(filePath)
  const ext = settings.format === 'webm' ? 'webm' : 'mp4'
  const mimeType = settings.format === 'webm' ? 'video/webm' : 'video/mp4'
  const storageKey = await uploadObject(
    buffer,
    generateUniqueKey(`editor-render-${editorProjectId}`, ext),
    undefined,
    mimeType,
  )

  return await ensureMediaObjectFromStorageKey(storageKey, {
    mimeType,
    sizeBytes: buffer.length,
    width: settings.width,
    height: settings.height,
    durationMs: Math.max(1, Math.round(durationSeconds * 1000)),
  })
}

export async function handleEditorRenderTask(job: Job<TaskJobData>) {
  const { episodeId, editorProjectId, settings: rawSettings } = parseRenderPayload(job)
  let renderedFilePath: string | null = null
  let expectedOutputPath: string | null = null

  try {
    await reportTaskProgress(job, 10, { stage: 'editor_render_load_project' })
    const editorProject = await prisma.novelPromotionEditorProject.findFirst({
      where: {
        id: editorProjectId,
        episodeId,
      },
      select: {
        id: true,
        projectData: true,
      },
    })
    if (!editorProject) throw new Error('EDITOR_PROJECT_NOT_FOUND')

    const renderContext = {
      userId: job.data.userId,
      projectId: job.data.projectId,
      editorProjectId,
      episodeId,
    }
    const { variables, settings, durationSeconds } = await buildTwickRenderInput(editorProject.projectData, rawSettings, renderContext)
    expectedOutputPath = buildRenderOutputPath(job.data.taskId, settings.format)
    const durationMinutes = Math.max(0.01, durationSeconds / 60)

    await assertTaskActive(job, 'editor_render_mark_processing')
    const processingUpdate = await prisma.novelPromotionEditorProject.updateMany({
      where: {
        id: editorProjectId,
        renderStatus: 'PROCESSING',
        OR: [
          { renderTaskId: job.data.taskId },
          { renderTaskId: null },
        ],
      },
      data: {
        renderStatus: 'PROCESSING',
        renderTaskId: job.data.taskId,
        renderSettings: settings as unknown as object,
      },
    })
    if (processingUpdate.count === 0) {
      throw new Error('EDITOR_RENDER_TASK_STALE')
    }

    await reportTaskProgress(job, 25, {
      stage: 'editor_render_resolved_media',
      width: settings.width,
      height: settings.height,
      fps: settings.fps,
      format: settings.format,
    })

    await assertTaskActive(job, 'editor_render_render_video')
    renderedFilePath = await renderTwickVideoToFile(variables, settings, job.data.taskId)

    await reportTaskProgress(job, 85, { stage: 'editor_render_upload_output' })
    await assertTaskActive(job, 'editor_render_upload_output')
    const mediaObject = await uploadRenderedVideo(renderedFilePath, editorProjectId, settings, durationSeconds)

    await assertTaskActive(job, 'editor_render_persist_output')
    await prisma.novelPromotionEditorProject.updateMany({
      where: {
        id: editorProjectId,
        renderTaskId: job.data.taskId,
      },
      data: {
        renderStatus: 'DONE',
        renderOutputMediaObjectId: mediaObject.id,
        renderSettings: settings as unknown as object,
        renderTaskId: job.data.taskId,
      },
    })

    await reportTaskProgress(job, 95, {
      stage: 'editor_render_completed',
      mediaObjectId: mediaObject.id,
    })

    return {
      success: true,
      editorProjectId,
      episodeId,
      mediaObjectId: mediaObject.id,
      outputUrl: mediaObject.url,
      storageKey: mediaObject.storageKey,
      renderSettings: settings,
      durationSeconds,
      actualQuantity: durationMinutes,
    }
  } catch (error) {
    await prisma.novelPromotionEditorProject.updateMany({
      where: {
        id: editorProjectId,
        renderTaskId: job.data.taskId,
      },
      data: {
        renderStatus: 'FAILED',
        renderTaskId: job.data.taskId,
      },
    }).catch(() => undefined)
    throw error
  } finally {
    const cleanupPaths = new Set<string>()
    if (expectedOutputPath) cleanupPaths.add(expectedOutputPath)
    if (renderedFilePath) cleanupPaths.add(renderedFilePath)
    for (const filePath of cleanupPaths) {
      await fs.unlink(filePath).catch(() => undefined)
    }
    if (expectedOutputPath) {
      const basename = path.basename(expectedOutputPath, path.extname(expectedOutputPath))
      const outputDir = path.dirname(expectedOutputPath)
      const entries = await fs.readdir(outputDir).catch(() => [])
      await Promise.all(entries
        .filter((entry) => entry.startsWith(basename) && path.join(outputDir, entry) !== expectedOutputPath)
        .map((entry) => fs.unlink(path.join(outputDir, entry)).catch(() => undefined)))
    }
  }
}
