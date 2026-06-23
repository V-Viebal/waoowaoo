import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  novelPromotionEditorProject: {
    findFirst: vi.fn(),
    update: vi.fn(async () => undefined),
  },
}))
const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async () => Buffer.from('rendered-video')),
  unlink: vi.fn(async () => undefined),
}))
const storageMock = vi.hoisted(() => ({
  generateUniqueKey: vi.fn(() => 'videos/editor-render-editor-project-1.mp4'),
  uploadObject: vi.fn(async () => 'videos/editor-render-editor-project-1.mp4'),
}))
const mediaMock = vi.hoisted(() => ({
  ensureMediaObjectFromStorageKey: vi.fn(async () => ({
    id: 'media-render-1',
    publicId: 'public-render-1',
    url: '/m/public-render-1',
    storageKey: 'videos/editor-render-editor-project-1.mp4',
    sha256: null,
    mimeType: 'video/mp4',
    sizeBytes: 14,
    width: 720,
    height: 1280,
    durationMs: 6000,
    updatedAt: '2026-01-01T00:00:00.000Z',
  })),
}))
const resolverMock = vi.hoisted(() => ({
  resolveMediaUrlForServerRender: vi.fn(async (src: string) => src.startsWith('mediaobj://')
    ? `https://media.example/${src.slice('mediaobj://'.length)}`
    : src),
}))
const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))
const renderServerMock = vi.hoisted(() => ({
  renderTwickVideo: vi.fn(async () => '/tmp/rendered-video.mp4'),
}))

vi.mock('node:fs', () => ({ promises: fsMock }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/storage', () => storageMock)
vi.mock('@/lib/media/service', () => mediaMock)
vi.mock('@/lib/twick/media-url-resolver', () => resolverMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))
vi.mock('@twick/render-server', () => renderServerMock)

import { buildTwickRenderInput, handleEditorRenderTask } from '@/lib/workers/handlers/editor-render-task-handler'

function buildProjectData() {
  return {
    version: 1,
    metadata: { custom: { width: 1080, height: 1920, fps: 24, duration: 6 } },
    tracks: [
      {
        id: 'track-video',
        type: 'video',
        elements: [
          { id: 'video-1', type: 'video', s: 0, e: 6, props: { src: 'mediaobj://video-media-1' } },
        ],
      },
      {
        id: 'track-audio',
        type: 'audio',
        elements: [
          { id: 'audio-1', type: 'audio', s: 0, e: 6, props: { src: 'mediaobj://audio-media-1', volume: 1 } },
        ],
      },
    ],
  }
}

function buildJob(payload: Record<string, unknown> = {}): Job<TaskJobData> {
  return {
    queueName: 'video',
    data: {
      taskId: 'task-render-1',
      type: TASK_TYPE.EDITOR_RENDER,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionEditorProject',
      targetId: 'editor-project-1',
      payload: {
        episodeId: 'episode-1',
        editorProjectId: 'editor-project-1',
        settings: { width: 720, height: 1280, fps: 30, format: 'mp4' },
        ...payload,
      },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('editor render worker handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionEditorProject.findFirst.mockResolvedValue({
      id: 'editor-project-1',
      projectData: buildProjectData(),
    })
  })

  it('buildTwickRenderInput resolves mediaobj:// refs to server-fetchable URLs', async () => {
    const result = await buildTwickRenderInput(buildProjectData(), { width: 720, height: 1280, fps: 30, format: 'mp4' })

    expect(result.settings).toEqual(expect.objectContaining({ width: 720, height: 1280, fps: 30, format: 'mp4' }))
    expect(result.durationSeconds).toBe(6)
    const tracks = (result.variables.input as { tracks: Array<{ elements: Array<{ props: { src: string } }> }> }).tracks
    expect(tracks[0].elements[0].props.src).toBe('https://media.example/video-media-1')
    expect(tracks[1].elements[0].props.src).toBe('https://media.example/audio-media-1')
    expect(resolverMock.resolveMediaUrlForServerRender).toHaveBeenCalledWith('mediaobj://video-media-1')
  })

  it('renders, uploads to storage, creates MediaObject, updates editor render fields, and returns actual billing quantity', async () => {
    const result = await handleEditorRenderTask(buildJob())

    expect(prismaMock.novelPromotionEditorProject.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'editor-project-1', episodeId: 'episode-1' },
    }))
    expect(renderServerMock.renderTwickVideo).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ properties: expect.objectContaining({ width: 720, height: 1280, fps: 30 }) }) }),
      expect.objectContaining({ outFile: 'editor-render-task-render-1.mp4', quality: 'high' }),
    )
    expect(storageMock.uploadObject).toHaveBeenCalledWith(
      Buffer.from('rendered-video'),
      'videos/editor-render-editor-project-1.mp4',
      undefined,
      'video/mp4',
    )
    expect(mediaMock.ensureMediaObjectFromStorageKey).toHaveBeenCalledWith(
      'videos/editor-render-editor-project-1.mp4',
      expect.objectContaining({ mimeType: 'video/mp4', width: 720, height: 1280, durationMs: 6000 }),
    )
    expect(prismaMock.novelPromotionEditorProject.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'editor-project-1' },
      data: expect.objectContaining({
        renderStatus: 'PROCESSING',
        renderTaskId: 'task-render-1',
      }),
    })
    expect(prismaMock.novelPromotionEditorProject.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'editor-project-1' },
      data: expect.objectContaining({
        renderStatus: 'DONE',
        renderOutputMediaObjectId: 'media-render-1',
        renderTaskId: 'task-render-1',
      }),
    })
    expect(result).toEqual(expect.objectContaining({
      success: true,
      mediaObjectId: 'media-render-1',
      outputUrl: '/m/public-render-1',
      actualQuantity: 0.1,
    }))
    expect(fsMock.unlink).toHaveBeenCalledWith('/tmp/rendered-video.mp4')
  })

  it('marks editor render as FAILED and rethrows so lifecycle rolls back billing on render failure', async () => {
    renderServerMock.renderTwickVideo.mockRejectedValueOnce(new Error('puppeteer missing'))

    await expect(handleEditorRenderTask(buildJob())).rejects.toThrow('puppeteer missing')

    expect(prismaMock.novelPromotionEditorProject.update).toHaveBeenLastCalledWith({
      where: { id: 'editor-project-1' },
      data: {
        renderStatus: 'FAILED',
        renderTaskId: 'task-render-1',
      },
    })
    expect(mediaMock.ensureMediaObjectFromStorageKey).not.toHaveBeenCalled()
  })

  it('throws when the editor project does not belong to the episode', async () => {
    prismaMock.novelPromotionEditorProject.findFirst.mockResolvedValueOnce(null)

    await expect(handleEditorRenderTask(buildJob())).rejects.toThrow('EDITOR_PROJECT_NOT_FOUND')
    expect(renderServerMock.renderTwickVideo).not.toHaveBeenCalled()
  })
})
