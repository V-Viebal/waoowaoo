import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const txMocks = vi.hoisted(() => ({
  updateStoryboard: vi.fn(async () => ({})),
  createImageVersion: vi.fn(async () => ({ id: 'version-1' })),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionStoryboard: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(async (fn: (tx: {
    novelPromotionStoryboard: { update: typeof txMocks.updateStoryboard }
    storyboardImageVersion: { create: typeof txMocks.createImageVersion }
  }) => Promise<unknown>) => {
    return await fn({
      novelPromotionStoryboard: {
        update: txMocks.updateStoryboard,
      },
      storyboardImageVersion: {
        create: txMocks.createImageVersion,
      },
    })
  }),
}))

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({
    storyboardModel: 'storyboard-model-1',
    artStyle: 'realistic',
    artStylePrompt: 'custom storyboard style',
  })),
  resolveImageSourceFromGeneration: vi.fn(async () => 'generated-storyboard-source'),
  uploadImageSourceToCos: vi.fn(async () => 'cos/storyboard-image.png'),
}))

const sharedMock = vi.hoisted(() => ({
  resolveNovelData: vi.fn(async () => ({
    videoRatio: '9:16',
    characters: [],
    locations: [],
  })),
}))

const promptMock = vi.hoisted(() => ({
  buildPromptAsync: vi.fn(async () => 'storyboard-image-prompt'),
}))

const mediaMock = vi.hoisted(() => ({
  ensureMediaObjectFromStorageKey: vi.fn(async () => ({
    id: 'media-1',
    url: '/m/storyboard-image-public',
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/media/service', () => mediaMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: vi.fn(),
    child: vi.fn(),
  })),
}))
vi.mock('@/lib/workers/handlers/image-task-handler-shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workers/handlers/image-task-handler-shared')>(
    '@/lib/workers/handlers/image-task-handler-shared',
  )
  return {
    ...actual,
    resolveNovelData: sharedMock.resolveNovelData,
  }
})
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: { NP_STORYBOARD_GRID_IMAGE: 'np_storyboard_grid_image' },
  buildPromptAsync: promptMock.buildPromptAsync,
}))

import { handleStoryboardImageTask } from '@/lib/workers/handlers/storyboard-image-task-handler'

function buildJob(payload: Record<string, unknown>, targetId = 'storyboard-1'): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-storyboard-image-1',
      type: TASK_TYPE.STORYBOARD_IMAGE,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionStoryboard',
      targetId,
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker storyboard-image-task-handler behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    prismaMock.novelPromotionStoryboard.findUnique.mockResolvedValue({
      id: 'storyboard-1',
      storyboardTextJson: '[{"panel":1}]',
      clip: {
        content: 'clip source text',
      },
      episode: {
        novelPromotionProject: {
          projectId: 'project-1',
        },
      },
      panels: [
        {
          id: 'panel-1',
          panelIndex: 0,
          panelNumber: 1,
          shotType: 'wide',
          cameraMove: 'static',
          description: 'opening shot',
          imagePrompt: 'opening image prompt',
          videoPrompt: 'opening video prompt',
          location: 'Main Hall',
          characters: JSON.stringify([{ name: 'Hero' }]),
          srtSegment: 'first line',
          photographyRules: JSON.stringify({ lens: '35mm' }),
          actingNotes: null,
        },
        {
          id: 'panel-2',
          panelIndex: 1,
          panelNumber: 2,
          shotType: 'close-up',
          cameraMove: 'push',
          description: 'reaction shot',
          imagePrompt: 'reaction image prompt',
          videoPrompt: 'reaction video prompt',
          location: 'Main Hall',
          characters: JSON.stringify([{ name: 'Hero' }]),
          srtSegment: 'second line',
          photographyRules: null,
          actingNotes: JSON.stringify({ emotion: 'tense' }),
        },
      ],
    })
  })

  it('generates one AI storyboard image and persists version metadata', async () => {
    const result = await handleStoryboardImageTask(buildJob({
      storyboardId: 'storyboard-1',
      gridPreset: 'grid_auto',
    }))

    expect(result).toEqual({
      storyboardId: 'storyboard-1',
      imageUrl: '/m/storyboard-image-public',
      imageMediaId: 'media-1',
      versionId: 'version-1',
      mode: 'ai_storyboard',
      gridPreset: 'grid_auto',
      gridConfig: {
        preset: 'grid_auto',
        columns: 2,
        rows: 1,
        capacity: 2,
        panelCount: 2,
      },
    })

    expect(promptMock.buildPromptAsync).toHaveBeenCalledWith(expect.objectContaining({
      promptId: 'np_storyboard_grid_image',
      projectId: 'project-1',
      variables: expect.objectContaining({
        aspect_ratio: '9:16',
        style: 'custom storyboard style',
        source_text: 'clip source text',
        grid_layout: '2 列 x 1 行',
        panel_count: '2',
        storyboard_text_json_input: expect.stringContaining('"panel_number": 1'),
      }),
    }))
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'user-1',
        modelId: 'storyboard-model-1',
        prompt: 'storyboard-image-prompt',
        options: { aspectRatio: '9:16' },
        allowTaskExternalIdResume: true,
      }),
    )
    expect(utilsMock.uploadImageSourceToCos).toHaveBeenCalledWith(
      'generated-storyboard-source',
      'storyboard-image',
      'storyboard-1',
    )
    expect(mediaMock.ensureMediaObjectFromStorageKey).toHaveBeenCalledWith('cos/storyboard-image.png', {
      mimeType: 'image/png',
    })
    expect(txMocks.updateStoryboard).toHaveBeenCalledWith({
      where: { id: 'storyboard-1' },
      data: { storyboardImageUrl: 'cos/storyboard-image.png' },
    })
    expect(txMocks.createImageVersion).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storyboardId: 'storyboard-1',
        mode: 'ai_storyboard',
        imageUrl: '/m/storyboard-image-public',
        imageMediaId: 'media-1',
        gridPreset: 'grid_auto',
        promptSnapshot: 'storyboard-image-prompt',
        createdByUserId: 'user-1',
      }),
    })
  })

  it('rejects storyboards outside the task project', async () => {
    prismaMock.novelPromotionStoryboard.findUnique.mockResolvedValueOnce({
      id: 'storyboard-1',
      storyboardTextJson: null,
      clip: null,
      episode: {
        novelPromotionProject: {
          projectId: 'other-project',
        },
      },
      panels: [],
    })

    await expect(handleStoryboardImageTask(buildJob({ storyboardId: 'storyboard-1' }))).rejects.toThrow('Storyboard not found')
    expect(utilsMock.resolveImageSourceFromGeneration).not.toHaveBeenCalled()
  })
})
