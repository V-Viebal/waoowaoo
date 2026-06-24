import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { withTaskLifecycle } from '@/lib/workers/shared'

const prismaMock = vi.hoisted(() => ({
  novelPromotionEditorProject: {
    findFirst: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  novelPromotionStoryboard: {
    findMany: vi.fn(),
  },
  novelPromotionVoiceLine: {
    findMany: vi.fn(),
  },
}))

const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
  withTaskLifecycle: vi.fn(async (_job: unknown, handler: () => Promise<unknown>) => handler()),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: workerMock.reportTaskProgress,
  withTaskLifecycle: workerMock.withTaskLifecycle,
}))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))

import { buildSmartCutProject, handleEditorSmartCutTask } from '@/lib/workers/handlers/editor-smart-cut-task-handler'

function buildJob(payload: Record<string, unknown> = {}): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-smart-cut-1',
      type: TASK_TYPE.EDITOR_AI_SMART_CUT,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionEditorProject',
      targetId: 'editor-project-1',
      payload: {
        episodeId: 'episode-1',
        editorProjectId: 'editor-project-1',
        ...payload,
      },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

function buildStoryboards() {
  return [
    {
      id: 'storyboard-1',
      clip: { id: 'clip-1', start: 0 },
      panels: [
        {
          id: 'panel-1',
          panelIndex: 0,
          description: 'panel one',
          videoPrompt: 'motion one',
          duration: 4,
          videoMediaId: 'video-media-1',
          videoMedia: { id: 'video-media-1', durationMs: 4500 },
        },
        {
          id: 'panel-2',
          panelIndex: 1,
          description: 'panel two',
          videoPrompt: null,
          duration: null,
          videoMediaId: 'video-media-2',
          videoMedia: { id: 'video-media-2', durationMs: null },
        },
      ],
    },
  ]
}

function buildVoiceLines() {
  return [
    {
      id: 'voice-1',
      lineIndex: 0,
      speaker: 'A',
      content: 'hello',
      audioDuration: 4200,
      audioMediaId: 'audio-media-1',
      audioMedia: { id: 'audio-media-1', durationMs: 4200 },
      matchedPanelId: 'panel-1',
      matchedStoryboardId: null,
      matchedPanelIndex: null,
    },
    {
      id: 'voice-2',
      lineIndex: 1,
      speaker: 'B',
      content: 'world',
      audioDuration: null,
      audioMediaId: 'audio-media-2',
      audioMedia: { id: 'audio-media-2', durationMs: 2800 },
      matchedPanelId: null,
      matchedStoryboardId: 'storyboard-1',
      matchedPanelIndex: 1,
    },
  ]
}

describe('editor smart cut worker handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionEditorProject.findFirst.mockResolvedValue({
      id: 'editor-project-1',
      version: 3,
      projectData: {
        metadata: {
          title: 'Existing editor project',
          custom: { width: 1080, height: 1920, fps: 24 },
        },
        backgroundColor: '#111111',
      },
    })
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValue(buildStoryboards())
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValue(buildVoiceLines())
  })

  it('buildSmartCutProject reuses buildInitialProject semantics for ordered panels and matched voice lines', async () => {
    const result = await buildSmartCutProject({
      currentProjectData: {
        metadata: { custom: { width: 1080, height: 1920, fps: 24 } },
      },
      storyboards: buildStoryboards(),
      voiceLines: buildVoiceLines(),
    })

    expect(result.panelCount).toBe(2)
    expect(result.voiceLineCount).toBe(2)
    expect(result.projectData.metadata?.custom).toEqual(expect.objectContaining({
      width: 1080,
      height: 1920,
      fps: 24,
      duration: 7.5,
    }))
    const tracks = result.projectData.tracks || []
    const videoElements = tracks[0]?.elements || []
    const audioElements = tracks[1]?.elements || []
    expect(videoElements.map((element) => element.props?.src)).toEqual([
      'mediaobj://video-media-1',
      'mediaobj://video-media-2',
    ])
    expect(videoElements.map((element) => [element.s, element.e])).toEqual([
      [0, 4.5],
      [4.5, 7.5],
    ])
    expect(audioElements.map((element) => element.props?.src)).toEqual([
      'mediaobj://audio-media-1',
      'mediaobj://audio-media-2',
    ])
  })

  it('updates editor project data, increments version, and returns actualQuantity=1 for billing settlement', async () => {
    const result = await handleEditorSmartCutTask(buildJob())

    expect(prismaMock.novelPromotionStoryboard.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { episodeId: 'episode-1' },
    }))
    expect(prismaMock.novelPromotionVoiceLine.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { episodeId: 'episode-1' },
      orderBy: { lineIndex: 'asc' },
    }))
    expect(workerMock.assertTaskActive).toHaveBeenCalledWith(expect.anything(), 'smart_cut_persist_editor_project')
    expect(prismaMock.novelPromotionEditorProject.updateMany).toHaveBeenCalledWith({
      where: { id: 'editor-project-1', version: 3 },
      data: {
        projectData: expect.objectContaining({ tracks: expect.any(Array) }),
        version: { increment: 1 },
      },
    })
    expect(result).toEqual(expect.objectContaining({
      success: true,
      editorProjectId: 'editor-project-1',
      episodeId: 'episode-1',
      panelCount: 2,
      voiceLineCount: 2,
      actualQuantity: 1,
    }))
  })

  it('rereads latest projectData and retries with version CAS when a concurrent edit wins first', async () => {
    prismaMock.novelPromotionEditorProject.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
    prismaMock.novelPromotionEditorProject.findFirst
      .mockResolvedValueOnce({
        id: 'editor-project-1',
        version: 3,
        projectData: {
          metadata: { custom: { width: 1080, height: 1920, fps: 24 } },
          backgroundColor: '#111111',
        },
      })
      .mockResolvedValueOnce({
        id: 'editor-project-1',
        version: 4,
        projectData: {
          metadata: { custom: { width: 1080, height: 1920, fps: 24 } },
          backgroundColor: '#111111',
          tracks: [
            { id: 'user-overlay', name: '用户新编辑', type: 'overlay', elements: [{ id: 'overlay-1', type: 'image', s: 0, e: 2, props: {} }] },
          ],
        },
      })

    await handleEditorSmartCutTask(buildJob())

    expect(prismaMock.novelPromotionEditorProject.updateMany).toHaveBeenCalledTimes(2)
    const calls = prismaMock.novelPromotionEditorProject.updateMany.mock.calls as unknown as Array<[{
      where: Record<string, unknown>
      data: { projectData: { tracks: Array<{ id: string; elements: unknown[] }> } }
    }]>
    expect(calls[0][0].where).toEqual({ id: 'editor-project-1', version: 3 })
    expect(calls[1][0].where).toEqual({ id: 'editor-project-1', version: 4 })
    expect(calls[1][0].data.projectData.tracks.find((track) => track.id === 'user-overlay')?.elements).toHaveLength(1)
  })

  it('filters panelIds when the route payload scopes the rough cut', async () => {
    await handleEditorSmartCutTask(buildJob({ panelIds: ['panel-2'] }))

    const updateMock = prismaMock.novelPromotionEditorProject.updateMany as unknown as {
      mock: { calls: Array<[{
        data: { projectData: { tracks: Array<{ elements: Array<{ props: { src: string } }> }> } }
      }]> }
    }
    const updateArgs = updateMock.mock.calls[0]![0]
    const videoElements = updateArgs.data.projectData.tracks[0].elements
    expect(videoElements).toHaveLength(1)
    expect(videoElements[0].props.src).toBe('mediaobj://video-media-2')
  })

  it('throws when no usable video panels exist and does not overwrite projectData', async () => {
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValueOnce([
      {
        id: 'storyboard-empty',
        clip: { id: 'clip-empty', start: 0 },
        panels: [
          {
            id: 'panel-empty',
            panelIndex: 0,
            description: 'no video yet',
            videoPrompt: null,
            duration: 3,
            videoMediaId: null,
            videoMedia: null,
          },
        ],
      },
    ])

    await expect(handleEditorSmartCutTask(buildJob())).rejects.toThrow('SMART_CUT_NO_VIDEO_PANELS')
    expect(workerMock.assertTaskActive).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEditorProject.updateMany).not.toHaveBeenCalled()
  })

  it('propagates empty-video failures through withTaskLifecycle so billing rollback path runs', async () => {
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValueOnce([])

    await expect(withTaskLifecycle(buildJob(), () => handleEditorSmartCutTask(buildJob()))).rejects.toThrow('SMART_CUT_NO_VIDEO_PANELS')
    expect(workerMock.withTaskLifecycle).toHaveBeenCalled()
    expect(prismaMock.novelPromotionEditorProject.updateMany).not.toHaveBeenCalled()
  })

  it('throws explicit error when editor project does not belong to the episode', async () => {
    prismaMock.novelPromotionEditorProject.findFirst.mockResolvedValueOnce(null)

    await expect(handleEditorSmartCutTask(buildJob())).rejects.toThrow('EDITOR_PROJECT_NOT_FOUND')
    expect(prismaMock.novelPromotionEditorProject.updateMany).not.toHaveBeenCalled()
  })
})
