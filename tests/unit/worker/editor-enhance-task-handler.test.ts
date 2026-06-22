import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { ENHANCE_VIDEO_ELEMENT_NOT_FOUND } from '@/lib/twick/enhance'
const prismaMock = vi.hoisted(() => ({
  novelPromotionEditorProject: {
    findFirst: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  novelPromotionEditorAsset: {
    create: vi.fn(async () => ({ id: 'asset-1' })),
  },
}))

const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))

import {
  buildEnhancedProject,
  ENHANCE_RESTORE_PROVIDER_UNAVAILABLE,
  handleEditorEnhanceTask,
} from '@/lib/workers/handlers/editor-enhance-task-handler'

function buildJob(payload: Record<string, unknown> = {}): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-enhance-1',
      type: TASK_TYPE.EDITOR_AI_ENHANCE,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionEditorProject',
      targetId: 'editor-project-1',
      payload: {
        episodeId: 'episode-1',
        editorProjectId: 'editor-project-1',
        selectedElementId: 'video-1',
        enhanceType: 'smart_crop',
        targetAspectRatio: '9:16',
        durationSeconds: 6,
        ...payload,
      },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

type UpdateManyArgs = {
  where: Record<string, unknown>
  data: { projectData: unknown }
}

function getUpdateManyCall(index: number): UpdateManyArgs {
  const calls = prismaMock.novelPromotionEditorProject.updateMany.mock.calls as unknown as Array<[UpdateManyArgs]>
  const call = calls[index]
  if (!call) throw new Error(`missing updateMany call ${index}`)
  return call[0]
}

function buildEditorProjectData() {
  return {
    version: 1,
    metadata: { custom: { width: 720, height: 1280, fps: 30, duration: 6 } },
    tracks: [
      { id: 'track-video-main', name: '视频', type: 'video', elements: [{ id: 'video-1', type: 'video', s: 0, e: 6, props: { src: 'mediaobj://video-1' }, metadata: { panelId: 'panel-1', source: 'generated' } }] },
      { id: 'track-audio-main', name: '语音', type: 'audio', elements: [{ id: 'audio-1', type: 'audio', s: 0, e: 6, props: { src: 'mediaobj://audio-1' }, metadata: { voiceLineId: 'voice-1' } }] },
    ],
  }
}

describe('editor enhance worker handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionEditorProject.findFirst.mockResolvedValue({
      id: 'editor-project-1',
      version: 3,
      projectData: buildEditorProjectData(),
    })
    prismaMock.novelPromotionEditorProject.updateMany.mockResolvedValue({ count: 1 })
  })

  it('buildEnhancedProject applies smart crop without creating a new media source', () => {
    const result = buildEnhancedProject({
      currentProjectData: buildEditorProjectData(),
      selectedElementId: 'video-1',
      enhanceType: 'smart_crop',
      targetAspectRatio: '16:9',
      anchor: 'center',
    })

    const videoElement = result.projectData.tracks?.[0]?.elements?.[0]
    expect(videoElement).toEqual(expect.objectContaining({
      id: 'video-1',
      props: expect.objectContaining({
        src: 'mediaobj://video-1',
        objectFit: 'cover',
        crop: expect.objectContaining({ targetAspectRatio: '16:9' }),
      }),
      metadata: expect.objectContaining({ source: 'ai_enhanced', enhanceType: 'smart_crop' }),
    }))
  })

  it('updates editor project data, increments version, and returns zero actualQuantity for free MVP smart crop settlement', async () => {
    const result = await handleEditorEnhanceTask(buildJob())

    expect(workerMock.assertTaskActive).toHaveBeenCalledWith(expect.anything(), 'enhance_persist_editor_project')
    expect(prismaMock.novelPromotionEditorAsset.create).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEditorProject.updateMany).toHaveBeenCalledWith({
      where: { id: 'editor-project-1', version: 3 },
      data: {
        projectData: expect.objectContaining({ tracks: expect.any(Array) }),
        version: { increment: 1 },
      },
    })
    const persisted = getUpdateManyCall(0).data.projectData as { tracks: Array<{ elements: Array<{ props: { src: string; crop?: unknown } }> }> }
    expect(persisted.tracks[0]?.elements[0]?.props.src).toBe('mediaobj://video-1')
    expect(persisted.tracks[0]?.elements[0]?.props.crop).toEqual(expect.objectContaining({ mode: 'smart_crop' }))
    expect(result).toEqual(expect.objectContaining({
      success: true,
      enhanceType: 'smart_crop',
      mode: 'timeline_parameter_smart_crop',
      replacedElementId: 'video-1',
      sourcePanelId: 'panel-1',
      actualSeconds: 0,
      actualQuantity: 0,
      editorAssetCreated: false,
    }))
  })

  it('rereads latest projectData and retries replacement when version changed before persist', async () => {
    prismaMock.novelPromotionEditorProject.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
    prismaMock.novelPromotionEditorProject.findFirst
      .mockResolvedValueOnce({ id: 'editor-project-1', version: 3, projectData: buildEditorProjectData() })
      .mockResolvedValueOnce({
        id: 'editor-project-1',
        version: 4,
        projectData: {
          ...buildEditorProjectData(),
          tracks: [
            ...buildEditorProjectData().tracks,
            { id: 'user-overlay', name: '用户新编辑', type: 'overlay', elements: [{ id: 'overlay-1', type: 'image', s: 0, e: 2, props: {} }] },
          ],
        },
      })

    await handleEditorEnhanceTask(buildJob())

    expect(prismaMock.novelPromotionEditorProject.updateMany).toHaveBeenCalledTimes(2)
    const secondUpdate = getUpdateManyCall(1)
    expect(secondUpdate.where).toEqual({ id: 'editor-project-1', version: 4 })
    const persistedTracks = (secondUpdate.data.projectData as { tracks: Array<{ id: string; elements: unknown[] }> }).tracks
    expect(persistedTracks.find((track) => track.id === 'user-overlay')?.elements).toHaveLength(1)
  })

  it('throws for missing or non-video selected element and does not persist', async () => {
    await expect(handleEditorEnhanceTask(buildJob({ selectedElementId: 'audio-1' }))).rejects.toThrow(ENHANCE_VIDEO_ELEMENT_NOT_FOUND)
    expect(prismaMock.novelPromotionEditorProject.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEditorAsset.create).not.toHaveBeenCalled()
  })

  it('throws restore provider placeholder error and does not persist or create EditorAsset', async () => {
    await expect(handleEditorEnhanceTask(buildJob({ enhanceType: 'restore' }))).rejects.toThrow(ENHANCE_RESTORE_PROVIDER_UNAVAILABLE)
    expect(prismaMock.novelPromotionEditorProject.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEditorAsset.create).not.toHaveBeenCalled()
  })
})
