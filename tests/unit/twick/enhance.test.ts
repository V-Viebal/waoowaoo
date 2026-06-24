import { describe, expect, it } from 'vitest'
import {
  applySmartCropToVideoElement,
  calculateSmartCropFrame,
  ENHANCE_VIDEO_ELEMENT_NOT_FOUND,
  findVideoElementInProject,
} from '@/lib/twick/enhance'
import type { TwickTimelineProject } from '@/lib/twick/types'

function buildProject(): TwickTimelineProject {
  return {
    version: 1,
    metadata: { custom: { duration: 8, width: 720, height: 1280, fps: 30 } },
    tracks: [
      {
        id: 'track-video-main',
        name: '视频',
        type: 'video',
        elements: [
          { id: 'video-1', type: 'video', s: 0, e: 8, props: { src: 'mediaobj://video-1', time: 0 }, metadata: { panelId: 'panel-1', source: 'generated' } },
        ],
      },
      {
        id: 'track-audio-main',
        name: '语音',
        type: 'audio',
        elements: [
          { id: 'audio-1', type: 'audio', s: 0, e: 8, props: { src: 'mediaobj://audio-1' }, metadata: { voiceLineId: 'voice-1' } },
        ],
      },
    ],
  } as TwickTimelineProject
}

describe('editor enhance twick helpers', () => {
  it('finds a selected video element and returns duration/source metadata', () => {
    const selected = findVideoElementInProject({ projectData: buildProject(), selectedElementId: 'video-1' })

    expect(selected).toEqual(expect.objectContaining({
      durationSeconds: 8,
      panelId: 'panel-1',
      src: 'mediaobj://video-1',
    }))
  })

  it('applies smart crop parameters to only the selected video without changing src or unrelated tracks', () => {
    const original = buildProject()
    const result = applySmartCropToVideoElement({
      projectData: original,
      selectedElementId: 'video-1',
      targetAspectRatio: '16:9',
      anchor: 'top',
    })

    expect(result).toEqual(expect.objectContaining({
      replacedElementId: 'video-1',
      sourcePanelId: 'panel-1',
      oldSrc: 'mediaobj://video-1',
      durationSeconds: 8,
      targetAspectRatio: '16:9',
      anchor: 'top',
    }))
    const video = result.projectData.tracks?.[0]?.elements?.[0]
    expect(video).toEqual(expect.objectContaining({
      id: 'video-1',
      objectFit: 'cover',
      frame: expect.objectContaining({
        x: 0,
        y: 0,
        size: [720, 405],
      }),
      props: expect.objectContaining({
        src: 'mediaobj://video-1',
      }),
      metadata: expect.objectContaining({ source: 'ai_enhanced', enhanceType: 'smart_crop', originalSrc: 'mediaobj://video-1' }),
    }))
    expect(video?.props?.objectFit).toBeUndefined()
    expect(video?.props?.fit).toBeUndefined()
    expect(video?.props?.crop).toBeUndefined()
    expect(result.projectData.tracks?.[1]?.elements?.[0]?.props?.src).toBe('mediaobj://audio-1')
    expect(original.tracks?.[0]?.elements?.[0]?.props?.objectFit).toBeUndefined()
  })

  it('calculates centered 9:16 crop frame inside a 16:9 canvas with exact aspect math', () => {
    expect(calculateSmartCropFrame({
      canvasWidth: 1920,
      canvasHeight: 1080,
      targetAspectRatio: '9:16',
      anchor: 'center',
    })).toEqual({
      x: 656.25,
      y: 0,
      size: [607.5, 1080],
    })
  })

  it('calculates anchored 16:9 crop frame inside a 9:16 canvas with exact aspect math', () => {
    expect(calculateSmartCropFrame({
      canvasWidth: 720,
      canvasHeight: 1280,
      targetAspectRatio: '16:9',
      anchor: 'bottom',
    })).toEqual({
      x: 0,
      y: 875,
      size: [720, 405],
    })
  })

  it('throws a stable error when no selected video exists', () => {
    expect(() => applySmartCropToVideoElement({
      projectData: buildProject(),
      selectedElementId: 'missing-video',
    })).toThrow(ENHANCE_VIDEO_ELEMENT_NOT_FOUND)
  })
})
