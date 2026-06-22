import type { TwickTimelineProject, TwickTrack } from './types'

type JsonRecord = Record<string, unknown>

export type EditorEnhanceType = 'smart_crop' | 'restore'
export type SmartCropAnchor = 'center' | 'top' | 'bottom' | 'left' | 'right'

export const ENHANCE_VIDEO_ELEMENT_NOT_FOUND = 'ENHANCE_VIDEO_ELEMENT_NOT_FOUND'
export const ENHANCE_UNSUPPORTED_TYPE = 'ENHANCE_UNSUPPORTED_TYPE'

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

function normalizeAnchor(value: unknown): SmartCropAnchor {
  return value === 'top' || value === 'bottom' || value === 'left' || value === 'right' || value === 'center'
    ? value
    : 'center'
}

function normalizeAspectRatio(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(trimmed)) return null
  return trimmed
}

function readProjectAspectRatio(projectData: TwickTimelineProject): string | null {
  const metadata = asRecord(projectData.metadata)
  const custom = asRecord(metadata?.custom)
  const width = readNumber(custom?.width)
  const height = readNumber(custom?.height)
  if (!width || !height || width <= 0 || height <= 0) return null
  return `${Math.round(width)}:${Math.round(height)}`
}

function readElementDurationSeconds(element: JsonRecord): number {
  const start = readNumber(element.s) ?? 0
  const end = readNumber(element.e) ?? start
  return Math.max(0, end - start)
}

export function findVideoElementInProject(params: {
  projectData: TwickTimelineProject
  selectedElementId?: string | null
}): { element: JsonRecord; durationSeconds: number; panelId: string | null; src: string | null } | null {
  if (!params.selectedElementId) return null
  for (const track of Array.isArray(params.projectData.tracks) ? params.projectData.tracks : []) {
    const elements = Array.isArray(track.elements) ? track.elements : []
    for (const element of elements) {
      const record = asRecord(element)
      if (!record || record.type !== 'video') continue
      if (readString(record.id) !== params.selectedElementId) continue
      const metadata = asRecord(record.metadata)
      const props = asRecord(record.props)
      return {
        element: record,
        durationSeconds: readElementDurationSeconds(record),
        panelId: readString(metadata?.panelId),
        src: readString(props?.src),
      }
    }
  }
  return null
}

export function applySmartCropToVideoElement(params: {
  projectData: TwickTimelineProject
  selectedElementId: string
  targetAspectRatio?: string | null
  anchor?: SmartCropAnchor | string | null
  cropStrength?: number | null
}): {
  projectData: TwickTimelineProject
  replacedElementId: string
  sourcePanelId: string | null
  oldSrc: string | null
  durationSeconds: number
  targetAspectRatio: string
  anchor: SmartCropAnchor
} {
  const targetAspectRatio = normalizeAspectRatio(params.targetAspectRatio) || readProjectAspectRatio(params.projectData) || '9:16'
  const anchor = normalizeAnchor(params.anchor)
  const cropStrength = typeof params.cropStrength === 'number' && Number.isFinite(params.cropStrength)
    ? Math.min(1, Math.max(0, params.cropStrength))
    : 1

  let replacedElementId: string | null = null
  let sourcePanelId: string | null = null
  let oldSrc: string | null = null
  let durationSeconds = 0

  const tracks = (Array.isArray(params.projectData.tracks) ? params.projectData.tracks : []).map((track) => {
    const clonedTrack = cloneTrack(track)
    clonedTrack.elements = (clonedTrack.elements || []).map((element) => {
      if (replacedElementId) return element
      const record = element as unknown as JsonRecord
      if (record.type !== 'video') return element
      const elementId = readString(record.id)
      if (elementId !== params.selectedElementId) return element

      const props = asRecord(record.props) || {}
      const metadata = asRecord(record.metadata) || {}
      replacedElementId = elementId
      sourcePanelId = readString(metadata.panelId)
      oldSrc = readString(props.src)
      durationSeconds = readElementDurationSeconds(record)

      return {
        ...record,
        props: {
          ...props,
          objectFit: 'cover',
          fit: 'cover',
          crop: {
            mode: 'smart_crop',
            targetAspectRatio,
            anchor,
            strength: cropStrength,
          },
        },
        metadata: {
          ...metadata,
          source: 'ai_enhanced',
          enhanceType: 'smart_crop',
          enhancedAt: new Date().toISOString(),
          originalSrc: oldSrc,
          targetAspectRatio,
          cropAnchor: anchor,
        },
      } as unknown as typeof element
    })
    return clonedTrack
  })

  if (!replacedElementId) {
    throw new Error(ENHANCE_VIDEO_ELEMENT_NOT_FOUND)
  }

  return {
    projectData: updateProjectDuration({
      ...params.projectData,
      tracks,
    }),
    replacedElementId,
    sourcePanelId,
    oldSrc,
    durationSeconds,
    targetAspectRatio,
    anchor,
  }
}
