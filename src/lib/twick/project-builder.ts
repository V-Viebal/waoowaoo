import {
  panelToVideoElement,
  voiceLineToAudioElement,
  voiceLineToCaptionElement,
} from './asset-adapter'
import { alignCaptionSourcesToAudioRanges } from './caption-duration'
import type {
  CaptionVoiceLineSource,
  PanelVideoSource,
  TwickTimelineProject,
  TwickTrack,
  VoiceLineSource,
} from './types'

export interface BuildProjectOptions {
  width: number
  height: number
  fps?: number
  includeAudio?: boolean
  includeCaptions?: boolean
  backgroundColor?: string
  title?: string
}

function createTrack(id: string, name: string, type: string): TwickTrack {
  return {
    id,
    name,
    type,
    elements: [],
  }
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readElementEnd(element: unknown): number {
  if (!element || typeof element !== 'object') return 0
  const record = element as Record<string, unknown>
  return Math.max(0, readNumber(record.e) ?? 0)
}

function cloneElement<T extends Record<string, unknown>>(element: T): T {
  return {
    ...element,
    ...(element.props && typeof element.props === 'object'
      ? { props: { ...(element.props as Record<string, unknown>) } }
      : {}),
    ...(element.metadata && typeof element.metadata === 'object'
      ? { metadata: { ...(element.metadata as Record<string, unknown>) } }
      : {}),
  }
}

function cloneTrack(track: TwickTrack): TwickTrack {
  return {
    ...track,
    elements: Array.isArray(track.elements)
      ? track.elements.map((element) => cloneElement(element as unknown as Record<string, unknown>)) as TwickTrack['elements']
      : [],
  }
}

function calculateTrackDuration(track: TwickTrack): number {
  return Math.max(0, ...(track.elements || []).map(readElementEnd))
}

function calculateProjectDuration(project: TwickTimelineProject): number {
  return Math.max(0, ...(project.tracks || []).map(calculateTrackDuration))
}

function updateProjectDuration(project: TwickTimelineProject): TwickTimelineProject {
  const duration = calculateProjectDuration(project)
  const metadata = project.metadata && typeof project.metadata === 'object' ? project.metadata : {}
  const custom = metadata.custom && typeof metadata.custom === 'object' ? metadata.custom : {}

  return {
    ...project,
    metadata: {
      ...metadata,
      custom: {
        ...custom,
        duration,
      },
    },
  }
}

export function buildCaptionTrack(
  voiceLines: CaptionVoiceLineSource[],
  options: {
    startTime?: number
    trackId?: string
    trackName?: string
  } = {},
): TwickTrack {
  const captionTrack = createTrack(
    options.trackId || 'track-captions',
    options.trackName || '字幕',
    'caption',
  )

  let currentTime = options.startTime || 0
  for (const voiceLine of voiceLines) {
    const text = voiceLine.text.trim()
    const duration = Number.isFinite(voiceLine.duration) && voiceLine.duration > 0
      ? voiceLine.duration
      : 0
    const explicitStart = readNumber(voiceLine.startTime)
    const explicitEnd = readNumber(voiceLine.endTime)
    const hasExplicitRange = explicitStart !== null
      && explicitEnd !== null
      && explicitStart >= 0
      && explicitEnd > explicitStart
    const startTime = hasExplicitRange ? explicitStart : currentTime
    const captionDuration = hasExplicitRange ? explicitEnd - explicitStart : duration

    if (text && captionDuration > 0) {
      captionTrack.elements.push(voiceLineToCaptionElement({
        voiceLineId: voiceLine.voiceLineId,
        duration: captionDuration,
        text,
        speaker: voiceLine.speaker,
      }, startTime))
    }
    currentTime = hasExplicitRange ? Math.max(currentTime, explicitEnd) : currentTime + duration
  }

  return captionTrack
}

export function mergeCaptionTrackIntoProject(
  projectData: TwickTimelineProject,
  captionTrack: TwickTrack,
): TwickTimelineProject {
  const existingTracks = Array.isArray(projectData.tracks) ? projectData.tracks : []
  const tracks = existingTracks
    .filter((track) => track.type !== 'caption' && track.id !== captionTrack.id)
    .map(cloneTrack)

  if ((captionTrack.elements || []).length > 0) {
    tracks.push(cloneTrack(captionTrack))
  }

  return updateProjectDuration({
    ...projectData,
    tracks,
  })
}

export function applyCaptionsToProject(
  projectData: TwickTimelineProject,
  voiceLines: CaptionVoiceLineSource[],
): {
  projectData: TwickTimelineProject
  captionCount: number
  totalDurationSeconds: number
} {
  const captionTrack = buildCaptionTrack(alignCaptionSourcesToAudioRanges(projectData, voiceLines))
  return {
    projectData: mergeCaptionTrackIntoProject(projectData, captionTrack),
    captionCount: captionTrack.elements.length,
    totalDurationSeconds: (captionTrack.elements || []).reduce((sum, element) => {
      const start = readNumber((element as Record<string, unknown>).s) ?? 0
      const end = readElementEnd(element)
      return sum + Math.max(0, end - start)
    }, 0),
  }
}

export function buildInitialProject(
  panels: PanelVideoSource[],
  voiceLines: VoiceLineSource[],
  options: BuildProjectOptions,
): TwickTimelineProject {
  const {
    width,
    height,
    fps = 30,
    includeAudio = true,
    includeCaptions = false,
    backgroundColor,
    title,
  } = options

  const videoTrack = createTrack('track-video-main', '视频', 'video')
  const audioTrack = createTrack('track-audio-main', '语音', 'audio')
  const captionTrack = createTrack('track-captions', '字幕', 'caption')

  let currentTime = 0

  for (let index = 0; index < panels.length; index += 1) {
    const panel = panels[index]
    videoTrack.elements.push(panelToVideoElement(panel, currentTime))

    const voiceLine = voiceLines[index]
    if (voiceLine) {
      if (includeAudio) {
        audioTrack.elements.push(voiceLineToAudioElement(voiceLine, currentTime))
      }
      if (includeCaptions) {
        captionTrack.elements.push(voiceLineToCaptionElement(voiceLine, currentTime))
      }
    }

    currentTime += panel.duration
  }

  const tracks: TwickTrack[] = [videoTrack]
  if (audioTrack.elements.length > 0) tracks.push(audioTrack)
  if (captionTrack.elements.length > 0) tracks.push(captionTrack)

  return {
    version: 1,
    ...(backgroundColor ? { backgroundColor } : {}),
    metadata: {
      ...(title ? { title } : {}),
      custom: {
        width,
        height,
        fps,
        duration: currentTime,
      },
    },
    tracks,
  }
}
