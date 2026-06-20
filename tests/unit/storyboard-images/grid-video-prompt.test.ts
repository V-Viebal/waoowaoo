import { describe, expect, it, vi, beforeEach } from 'vitest'
import { buildGridVideoPrompt, isGridLayout } from '@/lib/storyboard-images/grid-video-prompt'

const promptMock = vi.hoisted(() => ({
  buildPromptAsync: vi.fn(),
}))

vi.mock('@/lib/prompt-i18n', () => ({
  buildPromptAsync: promptMock.buildPromptAsync,
  PROMPT_IDS: {
    NP_PANEL_GRID_VIDEO: 'np_panel_grid_video',
  },
}))

describe('isGridLayout', () => {
  it('returns true for "grid"', () => {
    expect(isGridLayout('grid')).toBe(true)
  })

  it('returns false for "single"', () => {
    expect(isGridLayout('single')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isGridLayout(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isGridLayout(undefined)).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isGridLayout('')).toBe(false)
  })
})

describe('buildGridVideoPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when basePrompt is empty', async () => {
    const result = await buildGridVideoPrompt({
      basePrompt: '',
      panelDescription: 'test description',
      gridSize: 4,
      shotType: 'medium shot',
      cameraMove: 'pan right',
    })
    expect(result).toBeNull()
    expect(promptMock.buildPromptAsync).not.toHaveBeenCalled()
  })

  it('returns null when gridSize is 1 (single panel)', async () => {
    const result = await buildGridVideoPrompt({
      basePrompt: 'character walks forward',
      panelDescription: 'test',
      gridSize: 1,
      shotType: 'close-up',
      cameraMove: 'static',
    })
    expect(result).toBeNull()
    expect(promptMock.buildPromptAsync).not.toHaveBeenCalled()
  })

  it('returns null when gridSize is 0', async () => {
    const result = await buildGridVideoPrompt({
      basePrompt: 'character walks forward',
      panelDescription: 'test',
      gridSize: 0,
      shotType: 'close-up',
      cameraMove: 'static',
    })
    expect(result).toBeNull()
  })

  it('builds grid video prompt with correct variables for zh locale', async () => {
    promptMock.buildPromptAsync.mockResolvedValueOnce('grid video prompt content')

    const result = await buildGridVideoPrompt({
      basePrompt: '主角缓步走向镜头，表情凝重',
      panelDescription: '雨夜小巷，主角撑伞独行',
      gridSize: 4,
      shotType: '中景',
      cameraMove: '缓慢推进',
      locale: 'zh',
      projectId: 'proj-1',
    })

    expect(result).toBe('grid video prompt content')
    expect(promptMock.buildPromptAsync).toHaveBeenCalledWith({
      promptId: 'np_panel_grid_video',
      locale: 'zh',
      projectId: 'proj-1',
      variables: expect.objectContaining({
        base_prompt: '主角缓步走向镜头，表情凝重',
        panel_description: '雨夜小巷，主角撑伞独行',
        panel_grid_size: '4',
        grid_layout: expect.stringContaining('列'),
        grid_layout: expect.stringContaining('行'),
        shot_type: '中景',
        camera_move: '缓慢推进',
      }),
    })
  })

  it('builds grid video prompt with correct variables for en locale', async () => {
    promptMock.buildPromptAsync.mockResolvedValueOnce('en grid prompt')

    const result = await buildGridVideoPrompt({
      basePrompt: 'character walks toward camera',
      panelDescription: 'rainy alley, character with umbrella',
      gridSize: 6,
      shotType: 'medium shot',
      cameraMove: 'slow push in',
      locale: 'en',
    })

    expect(result).toBe('en grid prompt')
    expect(promptMock.buildPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'en',
        variables: expect.objectContaining({
          panel_grid_size: '6',
          grid_layout: expect.stringContaining('columns'),
          grid_layout: expect.stringContaining('rows'),
        }),
      }),
    )
  })

  it('uses default shot_type and camera_move when not provided (zh)', async () => {
    promptMock.buildPromptAsync.mockResolvedValueOnce('prompt')

    await buildGridVideoPrompt({
      basePrompt: 'some action',
      panelDescription: 'some scene',
      gridSize: 4,
      shotType: '',
      cameraMove: '',
      locale: 'zh',
    })

    expect(promptMock.buildPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          shot_type: '中景',
          camera_move: '逐格推进',
        }),
      }),
    )
  })

  it('falls back to basePrompt when panelDescription is empty', async () => {
    promptMock.buildPromptAsync.mockResolvedValueOnce('prompt')

    await buildGridVideoPrompt({
      basePrompt: 'main action description',
      panelDescription: '',
      gridSize: 4,
      shotType: 'close-up',
      cameraMove: 'static',
      locale: 'zh',
    })

    expect(promptMock.buildPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          panel_description: 'main action description',
        }),
      }),
    )
  })

  it('returns null when buildPromptAsync throws (graceful fallback)', async () => {
    promptMock.buildPromptAsync.mockRejectedValueOnce(new Error('prompt not found'))

    const result = await buildGridVideoPrompt({
      basePrompt: 'test',
      panelDescription: 'test',
      gridSize: 4,
      shotType: 'medium',
      cameraMove: 'static',
    })

    expect(result).toBeNull()
  })

  it('correctly computes 3x2 grid layout for gridSize=4 (max 3 columns)', async () => {
    promptMock.buildPromptAsync.mockResolvedValueOnce('prompt')

    await buildGridVideoPrompt({
      basePrompt: 'test',
      panelDescription: 'test',
      gridSize: 4,
      shotType: 'medium',
      cameraMove: 'static',
      locale: 'zh',
    })

    expect(promptMock.buildPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          grid_layout: '3 列 × 2 行',
        }),
      }),
    )
  })

  it('correctly computes 3x2 grid layout for gridSize=6', async () => {
    promptMock.buildPromptAsync.mockResolvedValueOnce('prompt')

    await buildGridVideoPrompt({
      basePrompt: 'test',
      panelDescription: 'test',
      gridSize: 6,
      shotType: 'medium',
      cameraMove: 'static',
      locale: 'en',
    })

    expect(promptMock.buildPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          grid_layout: '3 columns × 2 rows',
        }),
      }),
    )
  })
})
