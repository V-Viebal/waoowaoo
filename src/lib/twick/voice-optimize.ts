import { toMediaObjRef } from './media-ref'
import type { TwickTimelineProject, TwickTrack } from './types'

type JsonRecord = Record<string, unknown>

export const VOICE_OPTIMIZE_AUDIO_ELEMENT_NOT_FOUND = 'VOICE_OPTIMIZE_AUDIO_ELEMENT_NOT_FOUND'
export const VOICE_OPTIMIZE_DURATION_OVERLAP = 'VOICE_OPTIMIZE_DURATION_OVERLAP'

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readElementEnd(element: unknown): number {
  const record = asRecord(element)
  if (!record) return 0
  return Math.max(0, readNumber(record.e) ?? 0)
}

function readElementStart(element: unknown): number {
  const record = asRecord(element)
  if (!record) return 0
  return Math.max(0, readNumber(record.s) ?? 0)
}

function calculateTrackDuration(track: TwickTrack): number {
  return Math.max(0, ...(track.elements || []).map(readElementEnd))
}

function calculateProjectDuration(project: TwickTimelineProject): number {
  return Math.max(0, ...(project.tracks || []).map(calculateTrackDuration))
}

function updateProjectDuration(project: TwickTimelineProject): TwickTimelineProject {
  const metadata = asRecord(project.metadata) || {}
  const custom = asRecord(metadata.custom) || {}
  return {
    ...project,
    metadata: {
      ...metadata,
      custom: {
        ...custom,
        duration: calculateProjectDuration(project),
      },
    },
  }
}

function cloneElement(element: JsonRecord): JsonRecord {
  const props = asRecord(element.props)
  const metadata = asRecord(element.metadata)
  return {
    ...element,
    ...(props ? { props: { ...props } } : {}),
    ...(metadata ? { metadata: { ...metadata } } : {}),
  }
}

function cloneTrack(track: TwickTrack): TwickTrack {
  return {
    ...track,
    elements: Array.isArray(track.elements)
      ? track.elements.map((element) => cloneElement(element as unknown as JsonRecord)) as TwickTrack['elements']
      : [],
  }
}

export function replaceVoiceOptimizeAudioElement(params: {
  projectData: TwickTimelineProject
  voiceLineId: string
  audioMediaObjectId: string
  durationSeconds: number
  selectedElementId?: string | null
  speed?: number | null
  content?: string | null
  speaker?: string | null
}): { projectData: TwickTimelineProject; replacedElementId: string; oldSrc: string | null } {
  const durationSeconds = Number.isFinite(params.durationSeconds) && params.durationSeconds > 0
    ? params.durationSeconds
    : 0
  if (durationSeconds <= 0) {
    throw new Error('VOICE_OPTIMIZE_INVALID_AUDIO_DURATION')
  }

  let replacedElementId: string | null = null
  let oldSrc: string | null = null
  const tracks = (Array.isArray(params.projectData.tracks) ? params.projectData.tracks : []).map((track) => {
    const clonedTrack = cloneTrack(track)
    const elements = clonedTrack.elements || []
    clonedTrack.elements = elements.map((element, elementIndex) => {
      if (replacedElementId) return element
      const record = element as unknown as JsonRecord
      if (record.type !== 'audio') return element
      const metadata = asRecord(record.metadata)
      const elementVoiceLineId = readString(metadata?.voiceLineId)
      const elementId = readString(record.id)
      const matchesVoiceLine = elementVoiceLineId === params.voiceLineId
      const matchesSelected = params.selectedElementId ? elementId === params.selectedElementId : true
      if (!matchesVoiceLine || !matchesSelected) return element

      const start = readNumber(record.s) ?? 0
      const nextEnd = start + durationSeconds
      const nextElementStart = elements
        .filter((candidate, candidateIndex) => {
          if (candidateIndex === elementIndex) return false
          const candidateRecord = asRecord(candidate)
          return candidateRecord?.type === 'audio'
        })
        .map(readElementStart)
        .filter((candidateStart) => candidateStart >= start)
        .sort((a, b) => a - b)[0]
      if (typeof nextElementStart === 'number' && nextEnd > nextElementStart) {
        throw new Error(VOICE_OPTIMIZE_DURATION_OVERLAP)
      }

      const props = asRecord(record.props) || {}
      oldSrc = readString(props.src)
      replacedElementId = elementId || params.voiceLineId
      const nextMetadata: JsonRecord = {
        ...(metadata || {}),
        voiceLineId: params.voiceLineId,
        source: 'ai_enhanced',
        optimizedAt: new Date().toISOString(),
      }
      if (params.content?.trim()) nextMetadata.content = params.content.trim()
      if (params.speaker?.trim()) nextMetadata.speaker = params.speaker.trim()
      if (typeof params.speed === 'number' && Number.isFinite(params.speed) && params.speed > 0) {
        nextMetadata.speed = params.speed
      }

      return {
        ...record,
        e: nextEnd,
        props: {
          ...props,
          src: toMediaObjRef(params.audioMediaObjectId),
          time: 0,
          ...(typeof params.speed === 'number' && Number.isFinite(params.speed) && params.speed > 0
            ? { playbackRate: params.speed }
            : {}),
        },
        metadata: nextMetadata,
      } as unknown as typeof element
    })
    return clonedTrack
  })

  if (!replacedElementId) {
    throw new Error(VOICE_OPTIMIZE_AUDIO_ELEMENT_NOT_FOUND)
  }

  return {
    projectData: updateProjectDuration({
      ...params.projectData,
      tracks,
    }),
    replacedElementId,
    oldSrc,
  }
}
