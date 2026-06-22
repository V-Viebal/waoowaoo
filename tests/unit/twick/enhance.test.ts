import { describe, expect, it } from 'vitest'
import {
  applySmartCropToVideoElement,
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
      props: expect.objectContaining({
        src: 'mediaobj://video-1',
        objectFit: 'cover',
        fit: 'cover',
        crop: expect.objectContaining({ mode: 'smart_crop', targetAspectRatio: '16:9', anchor: 'top' }),
      }),
      metadata: expect.objectContaining({ source: 'ai_enhanced', enhanceType: 'smart_crop', originalSrc: 'mediaobj://video-1' }),
    }))
    expect(result.projectData.tracks?.[1]?.elements?.[0]?.props?.src).toBe('mediaobj://audio-1')
    expect(original.tracks?.[0]?.elements?.[0]?.props?.objectFit).toBeUndefined()
  })

  it('throws a stable error when no selected video exists', () => {
    expect(() => applySmartCropToVideoElement({
      projectData: buildProject(),
      selectedElementId: 'missing-video',
    })).toThrow(ENHANCE_VIDEO_ELEMENT_NOT_FOUND)
  })
})
