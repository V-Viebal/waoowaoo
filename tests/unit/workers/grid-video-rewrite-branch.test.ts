import { describe, it, expect, vi, beforeEach } from 'vitest'

const rewriteMock = vi.hoisted(() => ({ rewriteGridVideoPrompt: vi.fn() }))
vi.mock('@/lib/storyboard-images/grid-video-prompt', async (orig) => {
  const actual = await orig() as Record<string, unknown>
  return { ...actual, rewriteGridVideoPrompt: rewriteMock.rewriteGridVideoPrompt }
})

import { resolveGridVideoPrompt } from '@/lib/workers/grid-video-prompt-resolver'

describe('resolveGridVideoPrompt', () => {
  beforeEach(() => rewriteMock.rewriteGridVideoPrompt.mockReset())

  const baseArgs = {
    basePrompt: '男人开门',
    panelContext: { description: '男人下班回家' },
    gridSize: 4,
    shotType: '中景',
    cameraMove: '跟拍',
    locale: 'zh' as const,
    projectId: 'p1',
    userId: 'u1',
    model: 'ark:doubao',
  }

  it('reuses existing prompt when alreadyRewritten=true (cache hit)', async () => {
    const res = await resolveGridVideoPrompt({ ...baseArgs, alreadyRewritten: true })
    expect(res).toEqual({ prompt: '男人开门', rewritten: false, usage: null, duration: null })
    expect(rewriteMock.rewriteGridVideoPrompt).not.toHaveBeenCalled()
  })

  it('rewrites when not yet rewritten and returns new prompt + usage', async () => {
    rewriteMock.rewriteGridVideoPrompt.mockResolvedValue({ prompt: '0-3秒：推门', promptTokens: 10, completionTokens: 5, duration: 8 })
    const res = await resolveGridVideoPrompt({ ...baseArgs, alreadyRewritten: false })
    expect(res).toEqual({ prompt: '0-3秒：推门', rewritten: true, usage: { promptTokens: 10, completionTokens: 5 }, duration: 8 })
  })

  it('falls back to basePrompt when rewrite returns null', async () => {
    rewriteMock.rewriteGridVideoPrompt.mockResolvedValue(null)
    const res = await resolveGridVideoPrompt({ ...baseArgs, alreadyRewritten: false })
    expect(res).toEqual({ prompt: '男人开门', rewritten: false, usage: null, duration: null })
  })
})
