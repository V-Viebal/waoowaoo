import { describe, expect, it } from 'vitest'
import { applyTwickAiPatch } from '@/lib/twick/ai-patch-adapter'
import type { TwickTimelineProject } from '@/lib/twick/types'

describe('ai-patch-adapter', () => {
  it('applies the minimal replace-project patch', () => {
    const original: TwickTimelineProject = {
      version: 1,
      tracks: [],
    }
    const replacement: TwickTimelineProject = {
      version: 1,
      backgroundColor: '#000000',
      tracks: [
        {
          id: 'track-video-main',
          name: '视频',
          type: 'video',
          elements: [],
        },
      ],
    }

    expect(applyTwickAiPatch(original, {
      operation: 'replace-project',
      project: replacement,
    })).toBe(replacement)
  })
})
