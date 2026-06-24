import { describe, expect, it } from 'vitest'
import {
  applyCaptionsToProject,
  buildCaptionTrack,
  buildInitialProject,
  mergeCaptionTrackIntoProject,
} from '@/lib/twick/project-builder'
import {
  calculateCaptionBillingDurationSeconds,
  toCaptionVoiceLineSources,
} from '@/lib/twick/caption-duration'
import type { CaptionVoiceLineSource, PanelVideoSource, VoiceLineSource } from '@/lib/twick/types'

describe('project-builder', () => {
  const panels: PanelVideoSource[] = [
    { panelId: 'p1', storyboardId: 'sb1', videoMediaObjectId: 'mo1', duration: 3 },
    { panelId: 'p2', storyboardId: 'sb1', videoMediaObjectId: 'mo2', duration: 4 },
    { panelId: 'p3', storyboardId: 'sb2', videoMediaObjectId: 'mo3', duration: 2.5 },
  ]

  const voiceLines: VoiceLineSource[] = [
    { voiceLineId: 'vl1', audioMediaObjectId: 'a1', duration: 2.8, text: 'Line 1' },
    { voiceLineId: 'vl2', audioMediaObjectId: 'a2', duration: 3.9, text: 'Line 2' },
    { voiceLineId: 'vl3', audioMediaObjectId: 'a3', duration: 2.4, text: 'Line 3' },
  ]

  it('builds a real Twick ProjectJSON with video track elements placed sequentially', () => {
    const project = buildInitialProject(panels, [], {
      width: 720,
      height: 1280,
      includeAudio: false,
    })

    expect(project.version).toBe(1)
    expect(project.tracks).toHaveLength(1)
    expect(project.tracks[0]).toMatchObject({
      id: 'track-video-main',
      name: '视频',
      type: 'video',
    })
    expect(project.tracks[0].elements).toHaveLength(3)
    expect(project.tracks[0].elements.map((el) => [el.s, el.e])).toEqual([
      [0, 3],
      [3, 7],
      [7, 9.5],
    ])
    expect(project.tracks[0].elements[1].props.src).toBe('mediaobj://mo2')
    expect(project.metadata?.custom).toMatchObject({
      width: 720,
      height: 1280,
      fps: 30,
      duration: 9.5,
    })
    expect('width' in project).toBe(false)
    expect('height' in project).toBe(false)
    expect('duration' in project).toBe(false)
  })

  it('builds video and audio tracks when voice lines are included', () => {
    const project = buildInitialProject(panels, voiceLines, {
      width: 720,
      height: 1280,
      includeAudio: true,
    })

    expect(project.tracks).toHaveLength(2)
    const audioTrack = project.tracks.find((track) => track.type === 'audio')
    expect(audioTrack).toBeDefined()
    expect(audioTrack?.elements).toHaveLength(3)
    expect(audioTrack?.elements[0]).toMatchObject({
      type: 'audio',
      s: 0,
      e: 2.8,
      props: {
        src: 'mediaobj://a1',
        volume: 1,
      },
    })
  })

  it('builds a caption text track when captions are enabled', () => {
    const project = buildInitialProject(panels, voiceLines, {
      width: 720,
      height: 1280,
      includeAudio: true,
      includeCaptions: true,
    })

    expect(project.tracks).toHaveLength(3)
    const captionTrack = project.tracks.find((track) => track.type === 'caption')
    expect(captionTrack).toBeDefined()
    expect(captionTrack?.name).toBe('字幕')
    expect(captionTrack?.elements).toHaveLength(3)
    expect(captionTrack?.elements[0].t).toBe('Line 1')
  })

  it('handles empty panels with a valid empty ProjectJSON', () => {
    const project = buildInitialProject([], [], { width: 720, height: 1280 })

    expect(project).toMatchObject({
      version: 1,
      tracks: [
        {
          id: 'track-video-main',
          name: '视频',
          type: 'video',
          elements: [],
        },
      ],
    })
    expect(project.metadata?.custom?.duration).toBe(0)
  })

  it('builds a caption track from existing voice-line text with sequential timing and default style', () => {
    const captionVoiceLines: CaptionVoiceLineSource[] = [
      { voiceLineId: 'vl1', duration: 1.5, text: '第一句', speaker: 'A' },
      { voiceLineId: 'vl2', duration: 2, text: '第二句', speaker: 'B' },
    ]

    const track = buildCaptionTrack(captionVoiceLines)

    expect(track).toMatchObject({ id: 'track-captions', name: '字幕', type: 'caption' })
    expect(track.elements).toHaveLength(2)
    expect(track.elements.map((element) => [element.s, element.e, element.t])).toEqual([
      [0, 1.5, '第一句'],
      [1.5, 3.5, '第二句'],
    ])
    expect(track.elements[0]).toMatchObject({
      props: {
        fontSize: 32,
        fill: '#ffffff',
        stroke: '#000000',
        strokeWidth: 2,
        textAlign: 'center',
      },
      metadata: {
        voiceLineId: 'vl1',
        speaker: 'A',
        source: 'generated',
      },
    })
  })

  it('merges captions into an existing project by replacing the previous caption track only', () => {
    const project = buildInitialProject(panels.slice(0, 1), voiceLines.slice(0, 1), {
      width: 720,
      height: 1280,
      includeAudio: true,
      includeCaptions: true,
    })
    const newCaptionTrack = buildCaptionTrack([
      { voiceLineId: 'vl-new', duration: 2.25, text: 'New caption' },
    ])

    const merged = mergeCaptionTrackIntoProject(project, newCaptionTrack)

    expect(merged.tracks.filter((track) => track.type === 'caption')).toHaveLength(1)
    expect(merged.tracks.find((track) => track.type === 'video')?.elements).toHaveLength(1)
    expect(merged.tracks.find((track) => track.type === 'audio')?.elements).toHaveLength(1)
    const captionTrack = merged.tracks.find((track) => track.type === 'caption')
    expect(captionTrack?.elements).toHaveLength(1)
    expect(captionTrack?.elements[0].t).toBe('New caption')
    expect(merged.metadata?.custom?.duration).toBe(3)
  })

  it('applyCaptionsToProject prefers audio element s/e matched by metadata.voiceLineId and falls back sequentially', () => {
    const project = buildInitialProject(panels.slice(0, 1), [], {
      width: 720,
      height: 1280,
      includeAudio: false,
    })
    project.tracks.push({
      id: 'track-audio-main',
      name: '语音',
      type: 'audio',
      elements: [
        { id: 'audio-vl2', type: 'audio', s: 4, e: 6.5, props: {}, metadata: { voiceLineId: 'vl2' } },
      ],
    })

    const result = applyCaptionsToProject(project, [
      { voiceLineId: 'vl1', duration: 1, text: 'One' },
      { voiceLineId: 'vl2', duration: 99, text: 'Two' },
      { voiceLineId: 'vl3', duration: 1.5, text: 'Three' },
    ])

    const captionTrack = result.projectData.tracks.find((track) => track.type === 'caption')
    expect(captionTrack?.elements.map((element) => [element.t, element.s, element.e])).toEqual([
      ['One', 0, 1],
      ['Two', 4, 6.5],
      ['Three', 6.5, 8],
    ])
    expect(result.totalDurationSeconds).toBe(5)
  })

  it('applyCaptionsToProject returns caption count and total covered minutes input', () => {
    const project = buildInitialProject(panels.slice(0, 1), [], {
      width: 720,
      height: 1280,
      includeAudio: false,
    })

    const result = applyCaptionsToProject(project, [
      { voiceLineId: 'vl1', duration: 1, text: 'One' },
      { voiceLineId: 'vl2', duration: 2.5, text: 'Two' },
    ])

    expect(result.captionCount).toBe(2)
    expect(result.totalDurationSeconds).toBe(3.5)
    expect(result.projectData.tracks.find((track) => track.type === 'caption')?.elements).toHaveLength(2)
  })

  it('calculates caption billing duration from matched editor audio ranges and keeps freeze >= worker actual', () => {
    const project = buildInitialProject(panels.slice(0, 1), [], {
      width: 720,
      height: 1280,
      includeAudio: false,
    })
    project.tracks.push({
      id: 'track-audio-main',
      name: '语音',
      type: 'audio',
      elements: [
        { id: 'audio-vl1', type: 'audio', s: 2, e: 8, props: {}, metadata: { voiceLineId: 'vl1' } },
      ],
    })
    const captionSources = [
      { voiceLineId: 'vl1', duration: 1, text: 'One' },
    ]

    const freezeDurationSeconds = calculateCaptionBillingDurationSeconds(project, captionSources)
    const workerResult = applyCaptionsToProject(project, captionSources)

    expect(freezeDurationSeconds).toBe(6)
    expect(workerResult.totalDurationSeconds).toBe(6)
    expect(freezeDurationSeconds).toBeGreaterThanOrEqual(workerResult.totalDurationSeconds)
  })

  it('calculates caption billing duration from DB/fallback durations when editor audio is not matched', () => {
    const project = buildInitialProject(panels.slice(0, 1), [], {
      width: 720,
      height: 1280,
      includeAudio: false,
    })
    const captionSources = toCaptionVoiceLineSources([
      { id: 'vl1', content: 'One', audioDuration: 1500, audioMedia: { durationMs: 9000 } },
      { id: 'vl2', content: 'Two', audioDuration: null, audioMedia: { durationMs: 2500 } },
      { id: 'vl3', content: 'Three', audioDuration: null, audioMedia: null },
    ])

    expect(calculateCaptionBillingDurationSeconds(project, captionSources)).toBe(6)
  })

  it('calculates caption billing duration with mixed matched editor audio and fallback sources', () => {
    const project = buildInitialProject(panels.slice(0, 1), [], {
      width: 720,
      height: 1280,
      includeAudio: false,
    })
    project.tracks.push({
      id: 'track-audio-main',
      name: '语音',
      type: 'audio',
      elements: [
        { id: 'audio-vl2', type: 'audio', s: 10, e: 16, props: {}, metadata: { voiceLineId: 'vl2' } },
      ],
    })

    const durationSeconds = calculateCaptionBillingDurationSeconds(project, [
      { voiceLineId: 'vl1', duration: 1.5, text: 'One' },
      { voiceLineId: 'vl2', duration: 2, text: 'Two' },
      { voiceLineId: 'vl3', duration: 2.5, text: 'Three' },
    ])

    expect(durationSeconds).toBe(10)
  })
})
