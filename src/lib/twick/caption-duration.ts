import type { CaptionVoiceLineSource, TwickTimelineProject, TwickTrack } from './types'

export const DEFAULT_CAPTION_VOICE_DURATION_SECONDS = 2

export interface CaptionDurationVoiceLineInput {
  id: string
  content: string | null
  speaker?: string | null
  audioDuration?: number | null
  audioMedia?: {
    durationMs?: number | null
  } | null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }
  return null
}

function readPositiveNumber(value: unknown): number {
  const numeric = readNumber(value)
  return numeric !== null && numeric > 0 ? numeric : 0
}

function readJsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readElementStart(element: unknown): number {
  if (!element || typeof element !== 'object') return 0
  const record = element as Record<string, unknown>
  return Math.max(0, readNumber(record.s) ?? 0)
}

function readElementEnd(element: unknown): number {
  if (!element || typeof element !== 'object') return 0
  const record = element as Record<string, unknown>
  return Math.max(0, readNumber(record.e) ?? 0)
}

export function durationMsToCaptionSeconds(
  value: number | null | undefined,
  fallbackSeconds = DEFAULT_CAPTION_VOICE_DURATION_SECONDS,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallbackSeconds
  return value / 1000
}

export function toCaptionVoiceLineSources(
  voiceLines: CaptionDurationVoiceLineInput[],
): CaptionVoiceLineSource[] {
  return voiceLines
    .map((line) => ({
      voiceLineId: line.id,
      duration: durationMsToCaptionSeconds(
        line.audioDuration,
        durationMsToCaptionSeconds(line.audioMedia?.durationMs),
      ),
      text: line.content || '',
      speaker: line.speaker || undefined,
    }))
    .filter((line) => line.duration > 0)
}

function buildVoiceLineAudioRangeLookup(projectData: TwickTimelineProject): Map<string, { startTime: number; endTime: number }> {
  const lookup = new Map<string, { startTime: number; endTime: number }>()
  const tracks = Array.isArray(projectData?.tracks) ? projectData.tracks : []

  for (const track of tracks) {
    if (track.type !== 'audio') continue
    const elements = Array.isArray(track.elements) ? track.elements : []
    for (const element of elements) {
      const record = readJsonRecord(element)
      const metadata = readJsonRecord(record?.metadata)
      const voiceLineId = readString(metadata?.voiceLineId)
      if (!voiceLineId || lookup.has(voiceLineId)) continue

      const startTime = readElementStart(element)
      const endTime = readElementEnd(element)
      if (endTime > startTime) {
        lookup.set(voiceLineId, { startTime, endTime })
      }
    }
  }

  return lookup
}

export function alignCaptionSourcesToAudioRanges(
  projectData: TwickTimelineProject,
  voiceLines: CaptionVoiceLineSource[],
): CaptionVoiceLineSource[] {
  const audioRangeByVoiceLineId = buildVoiceLineAudioRangeLookup(projectData)

  return voiceLines.map((voiceLine) => {
    const audioRange = audioRangeByVoiceLineId.get(voiceLine.voiceLineId)
    if (!audioRange) return voiceLine
    return {
      ...voiceLine,
      startTime: audioRange.startTime,
      endTime: audioRange.endTime,
      duration: audioRange.endTime - audioRange.startTime,
    }
  })
}

export function calculateCaptionSourceDurationSeconds(voiceLines: CaptionVoiceLineSource[]): number {
  return voiceLines.reduce((sum, voiceLine) => {
    const duration = Number.isFinite(voiceLine.duration) && voiceLine.duration > 0
      ? voiceLine.duration
      : 0
    return voiceLine.text.trim() && duration > 0 ? sum + duration : sum
  }, 0)
}

export function calculateCaptionTimelineDurationSeconds(
  projectData: TwickTimelineProject,
  voiceLines: CaptionVoiceLineSource[],
): number {
  return calculateCaptionSourceDurationSeconds(alignCaptionSourcesToAudioRanges(projectData, voiceLines))
}

export function calculateTwickTimelineMaxEndSeconds(projectData: unknown): number {
  const projectRecord = readJsonRecord(projectData)
  const tracks = Array.isArray(projectRecord?.tracks) ? projectRecord.tracks : []
  let maxEnd = 0

  for (const track of tracks) {
    const trackRecord = readJsonRecord(track)
    const elements = Array.isArray(trackRecord?.elements) ? trackRecord.elements : []
    for (const element of elements) {
      const elementRecord = readJsonRecord(element)
      maxEnd = Math.max(maxEnd, readPositiveNumber(elementRecord?.e))
    }
  }

  return maxEnd
}

export function calculateTwickTimelineDurationSeconds(projectData: unknown, fallbackSeconds = 1): number {
  const projectRecord = readJsonRecord(projectData) || {}
  const metadata = readJsonRecord(projectRecord.metadata) || {}
  const custom = readJsonRecord(metadata.custom) || {}
  const explicitDuration = Math.max(
    readPositiveNumber(custom.duration),
    readPositiveNumber(projectRecord.duration),
  )
  const maxTrackEnd = calculateTwickTimelineMaxEndSeconds(projectData)
  const duration = Math.max(explicitDuration, maxTrackEnd)
  return duration > 0 ? duration : fallbackSeconds
}

export function calculateEditorRenderBillingMinutes(projectData: unknown, minMinutes = 0.01): number {
  return Math.max(minMinutes, calculateTwickTimelineDurationSeconds(projectData) / 60)
}

export function calculateCaptionBillingDurationSeconds(
  projectData: TwickTimelineProject,
  voiceLines: CaptionVoiceLineSource[],
): number {
  return Math.max(
    calculateCaptionSourceDurationSeconds(voiceLines),
    calculateCaptionTimelineDurationSeconds(projectData, voiceLines),
  )
}
