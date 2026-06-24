import { describe, expect, it } from 'vitest'
import {
  panelToVideoElement,
  voiceLineToAudioElement,
  voiceLineToCaptionElement,
} from '@/lib/twick/asset-adapter'
import type { PanelVideoSource, VoiceLineSource } from '@/lib/twick/types'

describe('asset-adapter', () => {
  const panel: PanelVideoSource = {
    panelId: 'panel-1',
    storyboardId: 'sb-1',
    videoMediaObjectId: 'mo-video-1',
    duration: 3.5,
    description: 'A test panel',
  }

  const voiceLine: VoiceLineSource = {
    voiceLineId: 'vl-1',
    audioMediaObjectId: 'mo-audio-1',
    duration: 2,
    text: 'Hello world',
    speaker: 'narrator',
  }

  describe('panelToVideoElement', () => {
    it('converts a panel to a Twick video element using s/e and props.src', () => {
      const element = panelToVideoElement(panel, 5)

      expect(element).toMatchObject({
        type: 'video',
        s: 5,
        e: 8.5,
        props: {
          src: 'mediaobj://mo-video-1',
          time: 0,
        },
        metadata: {
          panelId: 'panel-1',
          storyboardId: 'sb-1',
          source: 'generated',
          description: 'A test panel',
        },
      })
      expect(element.id).toMatch(/^video-panel-1-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/)
      expect('src' in element).toBe(false)
      expect('start' in element).toBe(false)
      expect('duration' in element).toBe(false)
    })

    it('creates a unique element id for each video instance while keeping panel metadata', () => {
      const first = panelToVideoElement(panel, 0)
      const second = panelToVideoElement(panel, 0)

      expect(first.id).not.toBe(second.id)
      expect(first.id).toContain('video-panel-1-')
      expect(second.id).toContain('video-panel-1-')
      expect(first.metadata?.panelId).toBe('panel-1')
      expect(second.metadata?.panelId).toBe('panel-1')
    })
  })

  describe('voiceLineToAudioElement', () => {
    it('converts a voice line to a Twick audio element with volume in props', () => {
      const element = voiceLineToAudioElement(voiceLine, 1.5)

      expect(element).toMatchObject({
        type: 'audio',
        s: 1.5,
        e: 3.5,
        props: {
          src: 'mediaobj://mo-audio-1',
          volume: 1,
          time: 0,
        },
        metadata: {
          voiceLineId: 'vl-1',
          speaker: 'narrator',
          source: 'generated',
        },
      })
      expect(element.id).toMatch(/^audio-vl-1-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/)
      expect('volume' in element).toBe(false)
    })

    it('creates a unique element id for each audio instance while keeping voice line metadata', () => {
      const first = voiceLineToAudioElement(voiceLine, 0)
      const second = voiceLineToAudioElement(voiceLine, 0)

      expect(first.id).not.toBe(second.id)
      expect(first.id).toContain('audio-vl-1-')
      expect(second.id).toContain('audio-vl-1-')
      expect(first.metadata?.voiceLineId).toBe('vl-1')
      expect(second.metadata?.voiceLineId).toBe('vl-1')
    })
  })

  describe('voiceLineToCaptionElement', () => {
    it('converts voice line text to a Twick caption element using the top-level t field', () => {
      const element = voiceLineToCaptionElement(voiceLine, 1.5)

      expect(element).toMatchObject({
        id: 'caption-vl-1',
        type: 'caption',
        t: 'Hello world',
        s: 1.5,
        e: 3.5,
        props: {
          fontSize: 32,
          fill: '#ffffff',
          stroke: '#000000',
          strokeWidth: 2,
          textAlign: 'center',
        },
        metadata: {
          voiceLineId: 'vl-1',
          speaker: 'narrator',
          source: 'generated',
        },
      })
    })
  })
})
