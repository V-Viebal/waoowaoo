import { describe, expect, it } from 'vitest'
import { replaceVoiceOptimizeAudioElement, VOICE_OPTIMIZE_AUDIO_ELEMENT_NOT_FOUND, VOICE_OPTIMIZE_DURATION_OVERLAP } from '@/lib/twick/voice-optimize'
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
          { id: 'video-1', type: 'video', s: 0, e: 8, props: { src: 'mediaobj://video-1' } },
        ],
      },
      {
        id: 'track-audio-main',
        name: '语音',
        type: 'audio',
        elements: [
          { id: 'audio-1', type: 'audio', s: 1, e: 4, props: { src: 'mediaobj://old-audio', volume: 0.8 }, metadata: { voiceLineId: 'voice-1', speaker: 'A' } },
          { id: 'audio-2', type: 'audio', s: 5, e: 7, props: { src: 'mediaobj://other-audio' }, metadata: { voiceLineId: 'voice-2' } },
        ],
      },
    ],
  } as TwickTimelineProject
}

describe('replaceVoiceOptimizeAudioElement', () => {
  it('replaces only the selected voice-line audio src and aligns end time to new duration', () => {
    const original = buildProject()
    const result = replaceVoiceOptimizeAudioElement({
      projectData: original,
      voiceLineId: 'voice-1',
      selectedElementId: 'audio-1',
      audioMediaObjectId: 'new-audio-media',
      durationSeconds: 2.5,
      content: 'new text',
      speaker: 'B',
      speed: 1.25,
    })

    expect(result.replacedElementId).toBe('audio-1')
    expect(result.oldSrc).toBe('mediaobj://old-audio')
    const audioTrack = result.projectData.tracks?.find((track) => track.id === 'track-audio-main')
    const [first, second] = audioTrack?.elements || []
    expect(first).toEqual(expect.objectContaining({
      id: 'audio-1',
      s: 1,
      e: 3.5,
      props: expect.objectContaining({
        src: 'mediaobj://new-audio-media',
        volume: 0.8,
        playbackRate: 1.25,
      }),
      metadata: expect.objectContaining({
        voiceLineId: 'voice-1',
        source: 'ai_enhanced',
        content: 'new text',
        speaker: 'B',
        speed: 1.25,
      }),
    }))
    expect(second?.props?.src).toBe('mediaobj://other-audio')
    expect(original.tracks?.[1]?.elements?.[0]?.props?.src).toBe('mediaobj://old-audio')
  })

  it('updates project duration when the replacement extends beyond existing tracks', () => {
    const result = replaceVoiceOptimizeAudioElement({
      projectData: buildProject(),
      voiceLineId: 'voice-2',
      selectedElementId: 'audio-2',
      audioMediaObjectId: 'long-audio-media',
      durationSeconds: 6,
    })

    const audioElement = result.projectData.tracks?.[1]?.elements?.[1]
    expect(audioElement?.e).toBe(11)
    expect(result.projectData.metadata?.custom).toEqual(expect.objectContaining({ duration: 11 }))
  })

  it('throws a stable overlap error when the new duration would cover the next same-track element', () => {
    expect(() => replaceVoiceOptimizeAudioElement({
      projectData: buildProject(),
      voiceLineId: 'voice-1',
      selectedElementId: 'audio-1',
      audioMediaObjectId: 'overlap-audio-media',
      durationSeconds: 4.1,
    })).toThrow(VOICE_OPTIMIZE_DURATION_OVERLAP)
  })

  it('throws a stable error when no matching audio element exists', () => {
    expect(() => replaceVoiceOptimizeAudioElement({
      projectData: buildProject(),
      voiceLineId: 'missing-voice',
      audioMediaObjectId: 'new-audio-media',
      durationSeconds: 2,
    })).toThrow(VOICE_OPTIMIZE_AUDIO_ELEMENT_NOT_FOUND)
  })
})
