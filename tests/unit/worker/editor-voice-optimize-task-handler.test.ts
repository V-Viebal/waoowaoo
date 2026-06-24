import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  novelPromotionEditorProject: {
    findFirst: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  novelPromotionVoiceLine: {
    findFirst: vi.fn(),
  },
  novelPromotionEditorAsset: {
    create: vi.fn(async () => ({ id: 'asset-1' })),
  },
}))

const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

const voiceMock = vi.hoisted(() => ({
  synthesizeVoiceLineAudio: vi.fn(),
  estimateVoiceLineMaxSeconds: vi.fn(() => 5),
}))

const mediaMock = vi.hoisted(() => ({
  ensureMediaObjectFromStorageKey: vi.fn(async () => ({
    id: 'new-audio-media',
    publicId: 'public-new-audio',
    url: '/m/public-new-audio',
    storageKey: 'editor/voice-optimize/project-1/episode-1/voice-1-task.wav',
    sha256: null,
    mimeType: 'audio/wav',
    sizeBytes: 100,
    width: null,
    height: null,
    durationMs: 2600,
    updatedAt: new Date().toISOString(),
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))
vi.mock('@/lib/voice/generate-voice-line', () => voiceMock)
vi.mock('@/lib/media/service', () => mediaMock)

import {
  buildVoiceOptimizeProject,
  handleEditorVoiceOptimizeTask,
  VOICE_OPTIMIZE_EMPTY_SPEAKER_ERROR,
  VOICE_OPTIMIZE_EMPTY_TEXT_ERROR,
  VOICE_OPTIMIZE_NO_VOICE_LINE_ERROR,
} from '@/lib/workers/handlers/editor-voice-optimize-task-handler'

function buildJob(payload: Record<string, unknown> = {}): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-voice-opt-1',
      type: TASK_TYPE.EDITOR_AI_VOICE_OPTIMIZE,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionEditorProject',
      targetId: 'editor-project-1',
      payload: {
        episodeId: 'episode-1',
        editorProjectId: 'editor-project-1',
        voiceLineId: 'voice-1',
        selectedElementId: 'audio-1',
        content: 'optimized text',
        speaker: 'A',
        speed: 1.25,
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
    metadata: { custom: { width: 720, height: 1280, fps: 30, duration: 8 } },
    tracks: [
      { id: 'track-video-main', name: '视频', type: 'video', elements: [{ id: 'video-1', type: 'video', s: 0, e: 8, props: { src: 'mediaobj://video-1' } }] },
      { id: 'track-audio-main', name: '语音', type: 'audio', elements: [{ id: 'audio-1', type: 'audio', s: 1, e: 4, props: { src: 'mediaobj://old-audio' }, metadata: { voiceLineId: 'voice-1', speaker: 'A' } }] },
    ],
  }
}

describe('editor voice optimize worker handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionEditorProject.findFirst.mockResolvedValue({
      id: 'editor-project-1',
      version: 3,
      projectData: buildEditorProjectData(),
    })
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValue({
      id: 'voice-1',
      episodeId: 'episode-1',
      speaker: 'A',
      content: 'old text',
      emotionPrompt: 'calm',
      emotionStrength: 0.4,
      audioDuration: 3000,
      audioMediaId: 'old-audio-media',
      audioMedia: { id: 'old-audio-media', durationMs: 3000 },
    })
    prismaMock.novelPromotionEditorProject.updateMany.mockResolvedValue({ count: 1 })
    voiceMock.synthesizeVoiceLineAudio.mockResolvedValue({
      lineId: 'voice-1-task-voice-opt-1',
      audioUrl: '/api/files/new.wav',
      storageKey: 'editor/voice-optimize/project-1/episode-1/voice-1-task-voice-opt-1.wav',
      audioDuration: 2600,
      audioDurationSeconds: 2.6,
      sizeBytes: 100,
    })
  })

  it('buildVoiceOptimizeProject replaces the target audio element without changing unrelated tracks', () => {
    const result = buildVoiceOptimizeProject({
      currentProjectData: buildEditorProjectData(),
      voiceLineId: 'voice-1',
      selectedElementId: 'audio-1',
      audioMediaObjectId: 'new-audio-media',
      durationSeconds: 2.6,
      speed: 1.25,
      content: 'optimized text',
      speaker: 'A',
    })

    const audioElement = result.projectData.tracks?.[1]?.elements?.[0]
    expect(audioElement).toEqual(expect.objectContaining({
      id: 'audio-1',
      s: 1,
      e: 1 + (2.6 / 1.25),
      props: expect.objectContaining({ src: 'mediaobj://new-audio-media' }),
      metadata: expect.objectContaining({ source: 'ai_enhanced', content: 'optimized text' }),
    }))
    expect(result.projectData.tracks?.[0]?.elements).toHaveLength(1)
  })

  it('generates new audio, stores an editor asset, replaces timeline element, and returns voice billing seconds', async () => {
    const result = await handleEditorVoiceOptimizeTask(buildJob())

    expect(voiceMock.synthesizeVoiceLineAudio).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      episodeId: 'episode-1',
      lineId: 'voice-1-task-voice-opt-1',
      userId: 'user-1',
      speaker: 'A',
      text: 'optimized text',
      emotionPrompt: 'calm',
      emotionStrength: 0.4,
      storageKeyPrefix: 'editor/voice-optimize',
    }))
    expect(mediaMock.ensureMediaObjectFromStorageKey).toHaveBeenCalledWith(
      'editor/voice-optimize/project-1/episode-1/voice-1-task-voice-opt-1.wav',
      expect.objectContaining({ mimeType: 'audio/wav', durationMs: 2600, sizeBytes: 100 }),
    )
    expect(prismaMock.novelPromotionEditorAsset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        editorProjectId: 'editor-project-1',
        mediaObjectId: 'new-audio-media',
        type: 'AUDIO',
        sourceType: 'AI_ENHANCED',
      }),
    })
    expect(workerMock.assertTaskActive).toHaveBeenCalledWith(expect.anything(), 'voice_optimize_persist_editor_project')
    expect(prismaMock.novelPromotionEditorProject.updateMany).toHaveBeenCalledWith({
      where: { id: 'editor-project-1', version: 3 },
      data: {
        projectData: expect.objectContaining({ tracks: expect.any(Array) }),
        version: { increment: 1 },
      },
    })
    const persisted = getUpdateManyCall(0).data.projectData as { tracks: Array<{ elements: Array<{ props: { src: string } }> }> }
    expect(persisted.tracks[1]?.elements[0]?.props.src).toBe('mediaobj://new-audio-media')
    expect(result).toEqual(expect.objectContaining({
      success: true,
      voiceLineId: 'voice-1',
      replacedElementId: 'audio-1',
      audioMediaObjectId: 'new-audio-media',
      audioDurationSeconds: 2.6,
      actualQuantity: 3,
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

    await handleEditorVoiceOptimizeTask(buildJob())

    expect(prismaMock.novelPromotionEditorProject.updateMany).toHaveBeenCalledTimes(2)
    const secondUpdate = getUpdateManyCall(1)
    expect(secondUpdate.where).toEqual({ id: 'editor-project-1', version: 4 })
    const persistedTracks = (secondUpdate.data.projectData as { tracks: Array<{ id: string; elements: unknown[] }> }).tracks
    expect(persistedTracks.find((track) => track.id === 'user-overlay')?.elements).toHaveLength(1)
  })

  it('throws when selected voice line is not in the episode and does not generate audio', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(null)

    await expect(handleEditorVoiceOptimizeTask(buildJob())).rejects.toThrow(VOICE_OPTIMIZE_NO_VOICE_LINE_ERROR)
    expect(voiceMock.synthesizeVoiceLineAudio).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEditorProject.updateMany).not.toHaveBeenCalled()
  })

  it('throws when optimized text is explicitly empty and does not fall back to the original text', async () => {
    await expect(handleEditorVoiceOptimizeTask(buildJob({ content: '   ' }))).rejects.toThrow(VOICE_OPTIMIZE_EMPTY_TEXT_ERROR)
    expect(voiceMock.synthesizeVoiceLineAudio).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEditorProject.updateMany).not.toHaveBeenCalled()
  })

  it('throws when speaker is explicitly empty and does not fall back to the original speaker', async () => {
    await expect(handleEditorVoiceOptimizeTask(buildJob({ speaker: '   ' }))).rejects.toThrow(VOICE_OPTIMIZE_EMPTY_SPEAKER_ERROR)
    expect(voiceMock.synthesizeVoiceLineAudio).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEditorProject.updateMany).not.toHaveBeenCalled()
  })

  it('fails before persisting timeline changes when generated duration exceeds the frozen maxSeconds', async () => {
    await expect(handleEditorVoiceOptimizeTask(buildJob({ maxSeconds: 2 }))).rejects.toThrow('VOICE_OPTIMIZE_BILLING_FREEZE_UNDERESTIMATED')
    expect(mediaMock.ensureMediaObjectFromStorageKey).toHaveBeenCalled()
    expect(prismaMock.novelPromotionEditorAsset.create).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEditorProject.updateMany).not.toHaveBeenCalled()
  })

  it('throws overlap error without persisting timeline changes when new audio would cover the next same-track element', async () => {
    prismaMock.novelPromotionEditorProject.findFirst.mockResolvedValueOnce({
      id: 'editor-project-1',
      version: 3,
      projectData: {
        ...buildEditorProjectData(),
        tracks: [
          buildEditorProjectData().tracks[0],
          {
            id: 'track-audio-main',
            name: '语音',
            type: 'audio',
            elements: [
              { id: 'audio-1', type: 'audio', s: 1, e: 4, props: { src: 'mediaobj://old-audio' }, metadata: { voiceLineId: 'voice-1', speaker: 'A' } },
              { id: 'audio-2', type: 'audio', s: 3, e: 5, props: { src: 'mediaobj://next-audio' }, metadata: { voiceLineId: 'voice-2', speaker: 'B' } },
            ],
          },
        ],
      },
    })

    await expect(handleEditorVoiceOptimizeTask(buildJob())).rejects.toThrow('VOICE_OPTIMIZE_DURATION_OVERLAP')
    expect(prismaMock.novelPromotionEditorProject.updateMany).not.toHaveBeenCalled()
  })
})
