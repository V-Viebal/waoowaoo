import { toMediaObjRef } from './media-ref'
import type {
  CaptionVoiceLineSource,
  PanelVideoSource,
  TwickCaptionElement,
  TwickMediaElement,
  TwickSourceMetadata,
  VoiceLineSource,
} from './types'

function endSec(startSec: number, durationSec: number): number {
  return startSec + durationSec
}

let elementIdCounter = 0

function createElementInstanceId(prefix: string, sourceId: string): string {
  elementIdCounter = (elementIdCounter + 1) % Number.MAX_SAFE_INTEGER
  const randomSuffix = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${sourceId}-${Date.now().toString(36)}-${elementIdCounter.toString(36)}-${randomSuffix}`
}

export function panelToVideoElement(
  panel: PanelVideoSource,
  startSec: number,
): TwickMediaElement {
  const metadata: TwickSourceMetadata = {
    panelId: panel.panelId,
    storyboardId: panel.storyboardId,
    source: 'generated',
  }
  if (panel.description) metadata.description = panel.description

  return {
    id: createElementInstanceId('video', panel.panelId),
    type: 'video',
    s: startSec,
    e: endSec(startSec, panel.duration),
    props: {
      src: toMediaObjRef(panel.videoMediaObjectId),
      time: 0,
    },
    metadata,
  }
}

export function voiceLineToAudioElement(
  voiceLine: VoiceLineSource,
  startSec: number,
): TwickMediaElement {
  const metadata: TwickSourceMetadata = {
    voiceLineId: voiceLine.voiceLineId,
    source: 'generated',
  }
  if (voiceLine.speaker) metadata.speaker = voiceLine.speaker

  return {
    id: createElementInstanceId('audio', voiceLine.voiceLineId),
    type: 'audio',
    s: startSec,
    e: endSec(startSec, voiceLine.duration),
    props: {
      src: toMediaObjRef(voiceLine.audioMediaObjectId),
      time: 0,
      volume: 1,
    },
    metadata,
  }
}

export function voiceLineToCaptionElement(
  voiceLine: CaptionVoiceLineSource,
  startSec: number,
): TwickCaptionElement {
  const metadata: TwickSourceMetadata = {
    voiceLineId: voiceLine.voiceLineId,
    source: 'generated',
  }
  if (voiceLine.speaker) metadata.speaker = voiceLine.speaker

  return {
    id: `caption-${voiceLine.voiceLineId}`,
    type: 'caption',
    t: voiceLine.text,
    s: startSec,
    e: endSec(startSec, voiceLine.duration),
    props: {
      fontSize: 32,
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: 2,
      textAlign: 'center',
    },
    metadata,
  }
}
