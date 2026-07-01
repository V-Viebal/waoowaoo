import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { executeAiTextStep, executeAiVisionStep } from '@/lib/ai-runtime'
import { isGridLayout, rewriteGridVideoPrompt, parseGridVideoResponse } from '@/lib/storyboard-images/grid-video-prompt'

const promptMock = vi.hoisted(() => ({
  buildPromptAsync: vi.fn(),
}))

const aiMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(),
  executeAiVisionStep: vi.fn(),
}))

vi.mock('@/lib/prompt-i18n', () => ({
  buildPromptAsync: promptMock.buildPromptAsync,
  PROMPT_IDS: {
    NP_PANEL_GRID_VIDEO: 'np_panel_grid_video',
    NP_PANEL_GRID_VIDEO_VISION: 'np_panel_grid_video_vision',
  },
}))

vi.mock('@/lib/ai-runtime', () => ({
  executeAiTextStep: aiMock.executeAiTextStep,
  executeAiVisionStep: aiMock.executeAiVisionStep,
}))

vi.mock('@/lib/media/outbound-image', () => ({
  normalizeToBase64ForGeneration: vi.fn().mockResolvedValue('data:image/jpeg;base64,abc123'),
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

describe('parseGridVideoResponse', () => {
  it('strips markdown code fences and parses JSON', () => {
    const result = parseGridVideoResponse('```\n{"prompt": "0-3秒：画面", "duration": 5}\n```')
    expect(result.prompt).toBe('0-3秒：画面')
    expect(result.duration).toBe(5)
  })
  it('parses plain JSON without code fences', () => {
    const result = parseGridVideoResponse('{"prompt": "男人开门", "duration": 8}')
    expect(result.prompt).toBe('男人开门')
    expect(result.duration).toBe(8)
  })
  it('falls back to plain text when JSON is invalid', () => {
    const result = parseGridVideoResponse('男人推门进入房间')
    expect(result.prompt).toBe('男人推门进入房间')
    expect(result.duration).toBeNull()
  })
  it('extracts duration from plain text when JSON parse fails', () => {
    const result = parseGridVideoResponse('男人开门，时长5秒')
    expect(result.prompt).toBe('男人开门，时长5秒')
    expect(result.duration).toBe(5)
  })
})

describe('rewriteGridVideoPrompt', () => {
  beforeEach(() => {
    aiMock.executeAiTextStep.mockReset()
    aiMock.executeAiVisionStep.mockReset()
    promptMock.buildPromptAsync.mockReset()
  })

  it('builds prompt with grid context vars and returns rewritten text', async () => {
    promptMock.buildPromptAsync.mockResolvedValue('FILLED_TEMPLATE')
    aiMock.executeAiTextStep.mockResolvedValue({
      text: JSON.stringify({ prompt: '0-3秒：男人推门进入。\n音效：开门声。', duration: 5 }),
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
      duration: 5,
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

  it('returns basePrompt with estimated duration when model is empty', async () => {
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
    // 模型为空时，返回原始提示词，根据宫格大小估算时长
    expect(result).toEqual({
      prompt: '男人开门',
      duration: 4,
      promptTokens: 0,
      completionTokens: 0,
    })
    expect(aiMock.executeAiTextStep).not.toHaveBeenCalled()
    expect(promptMock.buildPromptAsync).not.toHaveBeenCalled()
  })

  it('falls back to basePrompt when LLM returns empty text', async () => {
    promptMock.buildPromptAsync.mockResolvedValue('FILLED')
    aiMock.executeAiTextStep.mockResolvedValue({ text: '   ', usage: {} })
    const result = await rewriteGridVideoPrompt({
      panelContext: {}, basePrompt: 'x', gridSize: 4, shotType: '', cameraMove: '',
      locale: 'zh', projectId: null, userId: 'u1', model: 'm',
    })
    // 空响应时会兜底使用 basePrompt，而不是返回 null
    expect(result).toEqual({
      prompt: 'x',
      duration: null,
      promptTokens: 0,
      completionTokens: 0,
    })
  })

  it('falls back to basePrompt when LLM throws', async () => {
    promptMock.buildPromptAsync.mockResolvedValue('FILLED')
    aiMock.executeAiTextStep.mockRejectedValue(new Error('llm down'))
    const result = await rewriteGridVideoPrompt({
      panelContext: {}, basePrompt: 'x', gridSize: 4, shotType: '', cameraMove: '',
      locale: 'zh', projectId: null, userId: 'u1', model: 'm',
    })
    // 模型调用失败时，返回原始提示词，估算时长
    expect(result).toEqual({
      prompt: 'x',
      duration: 4,
      promptTokens: 0,
      completionTokens: 0,
    })
  })
})

describe('rewriteGridVideoPrompt: vision path', () => {
  const baseParams = {
    basePrompt: 'character walking',
    gridSize: 4,
    shotType: 'medium shot',
    cameraMove: 'smooth pan',
    locale: 'zh' as const,
    projectId: 'proj-123',
    userId: 'user-123',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should use vision path when both visionModel and imageUrl provided', async () => {
    vi.mocked(executeAiVisionStep).mockResolvedValue({
      text: JSON.stringify({ prompt: 'vision rewritten prompt', duration: 10 }),
      reasoning: '',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      completion: {} as any,
    })

    const result = await rewriteGridVideoPrompt({
      ...baseParams,
      visionModel: 'openai:gpt-4o',
      imageUrl: 'cos://panel-image.jpg',
      gridGenerationContextJson: JSON.stringify({ panel: {}, context: {} }),
    })

    expect(executeAiVisionStep).toHaveBeenCalled()
    expect(executeAiTextStep).not.toHaveBeenCalled()
    expect(result?.prompt).toBe('vision rewritten prompt')
    expect(result?.duration).toBe(10)
  })

  it('should fall back to text path when visionModel not provided', async () => {
    vi.mocked(executeAiTextStep).mockResolvedValue({
      text: JSON.stringify({ prompt: 'text rewritten prompt', duration: 8 }),
      reasoning: '',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      completion: {} as any,
    })

    const result = await rewriteGridVideoPrompt({
      ...baseParams,
      model: 'openai:gpt-4',
      gridGenerationContextJson: JSON.stringify({ panel: {}, context: {} }),
    })

    expect(executeAiTextStep).toHaveBeenCalled()
    expect(executeAiVisionStep).not.toHaveBeenCalled()
    expect(result?.prompt).toBe('text rewritten prompt')
    expect(result?.duration).toBe(8)
  })

  it('should fall back to text path when vision call fails', async () => {
    vi.mocked(executeAiVisionStep).mockRejectedValue(new Error('vision failed'))
    vi.mocked(executeAiTextStep).mockResolvedValue({
      text: JSON.stringify({ prompt: 'fallback prompt', duration: 6 }),
      reasoning: '',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      completion: {} as any,
    })

    const result = await rewriteGridVideoPrompt({
      ...baseParams,
      visionModel: 'openai:gpt-4o',
      imageUrl: 'cos://panel-image.jpg',
      gridGenerationContextJson: JSON.stringify({ panel: {}, context: {} }),
    })

    expect(result?.prompt).toBe('fallback prompt')
    expect(result?.duration).toBe(6)
  })

  it('should use old panelContext format when gridGenerationContextJson not provided (backward compat)', async () => {
    vi.mocked(executeAiTextStep).mockResolvedValue({
      text: JSON.stringify({ prompt: 'compat prompt', duration: 5 }),
      reasoning: '',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      completion: {} as any,
    })

    const result = await rewriteGridVideoPrompt({
      ...baseParams,
      model: 'openai:gpt-4',
      panelContext: { shot_type: 'medium', description: 'test' },
    })

    expect(result?.prompt).toBe('compat prompt')
    expect(result?.duration).toBe(5)
  })
})

describe('rewriteGridVideoPrompt: srtSegment handling', () => {
  const baseParams = {
    basePrompt: 'character walking',
    gridSize: 4,
    shotType: 'medium shot',
    cameraMove: 'smooth pan',
    locale: 'zh' as const,
    projectId: 'proj-123',
    userId: 'user-123',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should NOT add [角色台词] marker blocks - dialogue handling is entirely up to LLM', async () => {
    vi.mocked(executeAiTextStep).mockResolvedValue({
      text: JSON.stringify({ prompt: 'rewritten prompt text', duration: 8 }),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    })

    const result = await rewriteGridVideoPrompt({
      ...baseParams,
      model: 'openai:gpt-4',
      srtSegment: '00:00:01,000 --> 00:00:03,000\n你好，世界',
    })

    // 台词处理完全交给 LLM，代码不做任何追加处理
    expect(result?.prompt).toBe('rewritten prompt text')
    expect(result?.prompt).not.toContain('[角色台词]')
  })

  it('should NOT add dialogue markers in vision path either', async () => {
    vi.mocked(executeAiVisionStep).mockResolvedValue({
      text: JSON.stringify({ prompt: 'vision rewritten prompt', duration: 10 }),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    } as any)

    const result = await rewriteGridVideoPrompt({
      ...baseParams,
      visionModel: 'openai:gpt-4o',
      imageUrl: 'cos://panel-image.jpg',
      srtSegment: '00:00:01,000 --> 00:00:03,000\n你好，世界',
    })

    expect(result?.prompt).toBe('vision rewritten prompt')
    expect(result?.prompt).not.toContain('[角色台词]')
  })

  it('should NOT add dialogue markers when no model provided - returns raw basePrompt', async () => {
    const result = await rewriteGridVideoPrompt({
      ...baseParams,
      model: '',
      srtSegment: '00:00:01,000 --> 00:00:03,000\n你好，世界',
    })

    expect(result?.prompt).toBe('character walking')
    expect(result?.prompt).not.toContain('[角色台词]')
  })

  it('should NOT add dialogue markers on LLM failure either', async () => {
    vi.mocked(executeAiTextStep).mockRejectedValue(new Error('llm down'))

    const result = await rewriteGridVideoPrompt({
      ...baseParams,
      model: 'openai:gpt-4',
      srtSegment: '00:00:01,000 --> 00:00:03,000\n你好，世界',
    })

    expect(result?.prompt).toBe('character walking')
    expect(result?.prompt).not.toContain('[角色台词]')
  })

  it('should return LLM output as-is when it properly embeds dialogue in time segments', async () => {
    // LLM 正确地将台词嵌入到时间分段中（理想输出）
    const correctlyRewritten = `0-3秒：画面为仰拍近景...
3-7秒：男人猛地抬起右手...台词：觉醒不了异能的废物不配待在张家，滚！嘴巴张大，表情愤怒扭曲
7-10秒：保持指向前方...`

    vi.mocked(executeAiTextStep).mockResolvedValue({
      text: JSON.stringify({ prompt: correctlyRewritten, duration: 10 }),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    })

    const result = await rewriteGridVideoPrompt({
      ...baseParams,
      model: 'openai:gpt-4',
      srtSegment: '觉醒不了异能的废物不配待在张家，滚！',
    })

    // 直接返回 LLM 输出，不做任何修改
    expect(result?.prompt).toBe(correctlyRewritten)
  })
})
