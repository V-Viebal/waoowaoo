import { describe, it, expect, vi, beforeEach } from 'vitest'

const rewriteMock = vi.hoisted(() => ({ rewriteGridVideoPrompt: vi.fn() }))
const prismaMock = vi.hoisted(() => ({ update: vi.fn(), findFirst: vi.fn() }))
const modelMock = vi.hoisted(() => ({ resolveAnalysisModel: vi.fn() }))

vi.mock('@/lib/storyboard-images/grid-video-prompt', () => ({
  rewriteGridVideoPrompt: rewriteMock.rewriteGridVideoPrompt,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { novelPromotionPanel: { update: prismaMock.update, findFirst: prismaMock.findFirst } },
}))
vi.mock('@/lib/workers/handlers/resolve-analysis-model', () => ({
  resolveAnalysisModel: modelMock.resolveAnalysisModel,
}))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn() }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: vi.fn() }))

import { handleGridVideoPromptRewriteTask } from '@/lib/workers/handlers/grid-video-prompt-rewrite'

const job = {
  data: {
    userId: 'u1', projectId: 'p1', locale: 'zh',
    targetType: 'NovelPromotionPanel', targetId: 'panel-1',
    payload: { gridSize: 4, analysisModel: 'ark:doubao' },
  },
} as never

describe('handleGridVideoPromptRewriteTask', () => {
  beforeEach(() => {
    rewriteMock.rewriteGridVideoPrompt.mockReset()
    prismaMock.update.mockReset()
    prismaMock.findFirst.mockReset()
    modelMock.resolveAnalysisModel.mockReset()
    modelMock.resolveAnalysisModel.mockResolvedValue('ark:doubao')
    prismaMock.findFirst.mockResolvedValue({
      id: 'panel-1', description: '男人下班回家', shotType: '中景', cameraMove: '跟拍',
      location: '走廊', characters: '[]', srtSegment: '', videoPrompt: '旧提示词', imageLayout: 'grid',
    })
  })

  it('rewrites and persists videoPrompt + gridVideoPromptAt', async () => {
    rewriteMock.rewriteGridVideoPrompt.mockResolvedValue({ prompt: '0-3秒：推门', promptTokens: 10, completionTokens: 5 })
    const result = await handleGridVideoPromptRewriteTask(job)
    expect(prismaMock.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'panel-1',
        storyboard: { episode: { novelPromotionProject: { projectId: 'p1' } } },
      },
    })
    expect(modelMock.resolveAnalysisModel).toHaveBeenCalledWith({ userId: 'u1', inputModel: 'ark:doubao' })
    expect(rewriteMock.rewriteGridVideoPrompt).toHaveBeenCalledWith(expect.objectContaining({ model: 'ark:doubao' }))
    expect(prismaMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'panel-1' },
      data: expect.objectContaining({ videoPrompt: '0-3秒：推门', gridVideoPromptAt: expect.any(Date) }),
    }))
    expect(result).toEqual({ panelId: 'panel-1', rewritten: true })
  })

  it('throws when rewrite returns null (no persist)', async () => {
    rewriteMock.rewriteGridVideoPrompt.mockResolvedValue(null)
    await expect(handleGridVideoPromptRewriteTask(job)).rejects.toThrow()
    expect(prismaMock.update).not.toHaveBeenCalled()
  })

  it('throws for non-grid panel without rewrite or persist', async () => {
    prismaMock.findFirst.mockResolvedValue({
      id: 'panel-1', description: '男人下班回家', shotType: '中景', cameraMove: '跟拍',
      location: '走廊', characters: '[]', srtSegment: '', videoPrompt: '旧提示词', imageLayout: 'single',
    })

    await expect(handleGridVideoPromptRewriteTask(job)).rejects.toThrow('AI_GRID_VIDEO_PROMPT: panel is not a grid layout')
    expect(rewriteMock.rewriteGridVideoPrompt).not.toHaveBeenCalled()
    expect(prismaMock.update).not.toHaveBeenCalled()
  })
})
