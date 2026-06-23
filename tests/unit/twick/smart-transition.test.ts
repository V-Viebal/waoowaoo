import { describe, expect, it, vi } from 'vitest'
import { buildSmartTransitionInputFromProject, recommendSmartTransitions } from '@/lib/novel-promotion/editor/smart-transition'
import { applyTwickTransitionToProject, setTimelineElementTransition } from '@/lib/twick/transition'
import type { TwickTimelineProject } from '@/lib/twick/types'

function projectWithTwoClips(overrides?: {
  firstStoryboardId?: string | null
  secondStoryboardId?: string | null
  secondType?: 'video' | 'image' | 'audio'
  includeMiddleClip?: boolean
  secondTrack?: boolean
}): TwickTimelineProject {
  const firstStoryboardId = overrides?.firstStoryboardId === undefined ? 'storyboard-1' : overrides.firstStoryboardId
  const secondStoryboardId = overrides?.secondStoryboardId === undefined ? 'storyboard-1' : overrides.secondStoryboardId
  const clip1 = {
    id: 'clip-1',
    type: 'video',
    s: 0,
    e: 4,
    props: { src: 'mediaobj://video-1' },
    metadata: { panelId: 'panel-1', ...(firstStoryboardId ? { storyboardId: firstStoryboardId } : {}) },
  }
  const middleClip = {
    id: 'clip-middle',
    type: 'video',
    s: 4,
    e: 6,
    props: { src: 'mediaobj://video-middle' },
    metadata: { panelId: 'panel-middle', storyboardId: 'storyboard-middle' },
  }
  const clip2 = {
    id: 'clip-2',
    type: overrides?.secondType ?? 'video',
    s: overrides?.includeMiddleClip ? 6 : 4,
    e: overrides?.includeMiddleClip ? 10 : 8,
    props: { src: 'mediaobj://video-2' },
    metadata: { panelId: 'panel-2', ...(secondStoryboardId ? { storyboardId: secondStoryboardId } : {}) },
  }

  return {
    version: 1,
    tracks: [
      {
        id: 'track-video-main',
        name: 'Video',
        type: 'video',
        elements: overrides?.secondTrack
          ? [clip1]
          : [clip1, ...(overrides?.includeMiddleClip ? [middleClip] : []), clip2],
      },
      ...(overrides?.secondTrack
        ? [{ id: 'track-video-secondary', name: 'Video 2', type: 'video', elements: [clip2] }]
        : []),
    ],
  }
}

describe('smart transition recommendations', () => {
  it('prefers dissolve for clips in the same storyboard', () => {
    const input = buildSmartTransitionInputFromProject({
      projectData: projectWithTwoClips(),
      fromElementId: 'clip-1',
      toElementId: 'clip-2',
    })

    const recommendations = recommendSmartTransitions(input)

    expect(recommendations).toHaveLength(4)
    expect(recommendations[0]).toEqual(expect.objectContaining({
      kind: 'dissolve',
      confidence: expect.any(Number),
    }))
    expect(recommendations.map((item) => item.kind)).toEqual(['dissolve', 'fade', 'slide', 'zoom'])
  })

  it('prefers fade for clips in different storyboards', () => {
    const input = buildSmartTransitionInputFromProject({
      projectData: projectWithTwoClips({ secondStoryboardId: 'storyboard-2' }),
      fromElementId: 'clip-1',
      toElementId: 'clip-2',
    })

    const recommendations = recommendSmartTransitions(input)

    expect(recommendations[0]).toEqual(expect.objectContaining({
      kind: 'fade',
    }))
    expect(recommendations.map((item) => item.kind)).toContain('dissolve')
  })

  it('handles missing storyboard metadata as a scene change recommendation', () => {
    const input = buildSmartTransitionInputFromProject({
      projectData: projectWithTwoClips({ firstStoryboardId: null, secondStoryboardId: null }),
      fromElementId: 'clip-1',
      toElementId: 'clip-2',
    })

    const recommendations = recommendSmartTransitions(input)

    expect(input.from.storyboardId).toBeNull()
    expect(input.to.storyboardId).toBeNull()
    expect(recommendations[0]).toEqual(expect.objectContaining({ kind: 'fade' }))
  })

  it('throws a boundary error when the selected first clip has no successor', () => {
    expect(() => buildSmartTransitionInputFromProject({
      projectData: projectWithTwoClips(),
      fromElementId: 'missing-previous-clip',
      toElementId: 'clip-1',
    })).toThrow('TRANSITION_FROM_ELEMENT_NOT_FOUND')
  })

  it('rejects non-adjacent transition pairs', () => {
    expect(() => buildSmartTransitionInputFromProject({
      projectData: projectWithTwoClips({ includeMiddleClip: true }),
      fromElementId: 'clip-1',
      toElementId: 'clip-2',
    })).toThrow('TRANSITION_ELEMENTS_NOT_ADJACENT')
  })

  it('rejects transition pairs on different tracks', () => {
    expect(() => buildSmartTransitionInputFromProject({
      projectData: projectWithTwoClips({ secondTrack: true }),
      fromElementId: 'clip-1',
      toElementId: 'clip-2',
    })).toThrow('TRANSITION_FROM_TO_DIFFERENT_TRACKS')
  })

  it('rejects unsupported transition element types', () => {
    expect(() => buildSmartTransitionInputFromProject({
      projectData: projectWithTwoClips({ secondType: 'audio' }),
      fromElementId: 'clip-1',
      toElementId: 'clip-2',
    })).toThrow('TRANSITION_UNSUPPORTED_ELEMENT_TYPE')
  })
})

describe('Twick transition writer', () => {
  it('writes the real top-level Twick transition field to the from element', () => {
    const updated = applyTwickTransitionToProject(projectWithTwoClips(), {
      fromElementId: 'clip-1',
      toElementId: 'clip-2',
      kind: 'fade',
      duration: 0.75,
    })

    expect(updated.tracks[0].elements[0]).toEqual(expect.objectContaining({
      transition: {
        toElementId: 'clip-2',
        duration: 0.75,
        kind: 'fade',
      },
    }))
    expect(updated.tracks[0].elements[1]).not.toHaveProperty('transition')
  })

  it('uses TimelineEditor.addTransition and returns the latest project for immediate save', () => {
    const latestProject = applyTwickTransitionToProject(projectWithTwoClips(), {
      fromElementId: 'clip-1',
      toElementId: 'clip-2',
      kind: 'zoom',
      duration: 0.45,
    })
    const addTransition = vi.fn(() => true)
    const getProject = vi.fn(() => latestProject)

    const updatedProject = setTimelineElementTransition({ addTransition, getProject }, {
      fromElementId: 'clip-1',
      toElementId: 'clip-2',
      kind: 'zoom',
      duration: 0.45,
    })

    expect(updatedProject).toBe(latestProject)
    expect(addTransition).toHaveBeenCalledWith('clip-1', 'clip-2', 'zoom', 0.45)
    expect(getProject).toHaveBeenCalledOnce()
  })

  it('returns null when the editor cannot expose the updated project for immediate save', () => {
    const addTransition = vi.fn(() => true)

    const updatedProject = setTimelineElementTransition({ addTransition }, {
      fromElementId: 'clip-1',
      toElementId: 'clip-2',
      kind: 'zoom',
      duration: 0.45,
    })

    expect(updatedProject).toBeNull()
  })
})
