import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { isGridLayout } from '@/lib/storyboard-images/grid-video-prompt'
import { rewriteGridVideoPrompt, parseRewrittenPrompt } from '@/lib/storyboard-images/grid-video-prompt'

const promptMock = vi.hoisted(() => ({
  buildPromptAsync: vi.fn(),
}))

const aiMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(),
}))

vi.mock('@/lib/prompt-i18n', () => ({
  buildPromptAsync: promptMock.buildPromptAsync,
  PROMPT_IDS: {
    NP_PANEL_GRID_VIDEO: 'np_panel_grid_video',
  },
}))

vi.mock('@/lib/ai-runtime', () => ({
  executeAiTextStep: aiMock.executeAiTextStep,
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

describe('panel_grid_video template', () => {
  it('keeps the zh template focused on one continuous scene instead of dynamic grid cuts', () => {
    const template = fs.readFileSync(
      path.resolve(process.cwd(), 'lib/prompts/novel-promotion/panel_grid_video.zh.txt'),
      'utf8',
    )

    expect(template).toContain('单一连续镜头')
    expect(template).toContain('绝对不要出现宫格')
    expect(template).toContain('分屏')
    expect(template).toContain('边框')
  })

  it('keeps the en template focused on one continuous scene instead of dynamic grid cuts', () => {
    const template = fs.readFileSync(
      path.resolve(process.cwd(), 'lib/prompts/novel-promotion/panel_grid_video.en.txt'),
      'utf8',
    )

    expect(template).toContain('single continuous live-action shot')
    expect(template).toContain('Never output the words or form of grid')
    expect(template).toContain('split-screen')
    expect(template).toContain('borders')
  })
})

describe('parseRewrittenPrompt', () => {
  it('strips markdown code fences and trims', () => {
    expect(parseRewrittenPrompt('```\n0-3秒：画面\n```')).toBe('0-3秒：画面')
  })
  it('returns plain text unchanged', () => {
    expect(parseRewrittenPrompt('  0-3秒：画面  ')).toBe('0-3秒：画面')
  })
})

describe('rewriteGridVideoPrompt', () => {
  beforeEach(() => {
    aiMock.executeAiTextStep.mockReset()
    promptMock.buildPromptAsync.mockReset()
  })

  it('builds prompt with grid context vars and returns rewritten text', async () => {
    promptMock.buildPromptAsync.mockResolvedValue('FILLED_TEMPLATE')
    aiMock.executeAiTextStep.mockResolvedValue({
      text: '0-3秒：男人推门进入。\n音效：开门声。',
      usage: { promptTokens: 120, completionTokens: 80, totalTokens: 200 },
    })

    const result = await rewriteGridVideoPrompt({
      panelContext: { description: '男人下班回家' },
      basePrompt: '男人开门',
      gridSize: 4,
      shotType: '中景',
      cameraMove: '跟拍',
      locale: 'zh',
      projectId: 'p1',
      userId: 'u1',
      model: 'ark:doubao',
    })

    expect(promptMock.buildPromptAsync).toHaveBeenCalledWith(expect.objectContaining({
      promptId: 'np_panel_grid_video',
      variables: expect.objectContaining({
        storyboard_context_json: expect.any(String),
        base_prompt: '男人开门',
        grid_layout: '3 列 × 2 行排列，实际 4 格（末 2 格为空）',
        panel_grid_size: '4',
        shot_type: '中景',
        camera_move: '跟拍',
      }),
    }))
    expect(aiMock.executeAiTextStep).toHaveBeenCalledWith(expect.objectContaining({
      model: 'ark:doubao',
      userId: 'u1',
      projectId: 'p1',
    }))
    expect(result).toEqual({
      prompt: '0-3秒：男人推门进入。\n音效：开门声。',
      promptTokens: 120,
      completionTokens: 80,
    })
  })

  it('returns null when gridSize <= 1', async () => {
    const result = await rewriteGridVideoPrompt({
      panelContext: {}, basePrompt: 'x', gridSize: 1, shotType: '', cameraMove: '',
      locale: 'zh', projectId: null, userId: 'u1', model: 'm',
    })
    expect(result).toBeNull()
    expect(aiMock.executeAiTextStep).not.toHaveBeenCalled()
  })

  it('returns null when model is empty', async () => {
    const result = await rewriteGridVideoPrompt({
      panelContext: { description: '男人下班回家' },
      basePrompt: '男人开门',
      gridSize: 4,
      shotType: '中景',
      cameraMove: '跟拍',
      locale: 'zh',
      projectId: null,
      userId: 'u1',
      model: '',
    })
    expect(result).toBeNull()
    expect(aiMock.executeAiTextStep).not.toHaveBeenCalled()
    expect(promptMock.buildPromptAsync).not.toHaveBeenCalled()
  })

  it('returns null when LLM returns empty text', async () => {
    promptMock.buildPromptAsync.mockResolvedValue('FILLED')
    aiMock.executeAiTextStep.mockResolvedValue({ text: '   ', usage: {} })
    const result = await rewriteGridVideoPrompt({
      panelContext: {}, basePrompt: 'x', gridSize: 4, shotType: '', cameraMove: '',
      locale: 'zh', projectId: null, userId: 'u1', model: 'm',
    })
    expect(result).toBeNull()
  })

  it('returns null when LLM throws', async () => {
    promptMock.buildPromptAsync.mockResolvedValue('FILLED')
    aiMock.executeAiTextStep.mockRejectedValue(new Error('llm down'))
    const result = await rewriteGridVideoPrompt({
      panelContext: {}, basePrompt: 'x', gridSize: 4, shotType: '', cameraMove: '',
      locale: 'zh', projectId: null, userId: 'u1', model: 'm',
    })
    expect(result).toBeNull()
  })
})
