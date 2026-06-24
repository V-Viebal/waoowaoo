import type { ElementTransitionJSON, ProjectJSON } from '@twick/timeline'
import type { TwickTimelineElement } from './types'

export const TWICK_TRANSITION_KINDS = ['fade', 'dissolve', 'slide', 'zoom'] as const

export type TwickTransitionKind = typeof TWICK_TRANSITION_KINDS[number]

export type TimelineTransitionInput = {
  fromElementId: string
  toElementId: string
  kind: TwickTransitionKind
  duration: number
}

type TransitionEditorLike = {
  addTransition?: (fromElementId: string, toElementId: string, kind: string, duration: number) => boolean
  updateElements?: (updates: Array<{ elementId: string; updates: Partial<TwickTimelineElement> }>) => void
  getProject?: () => ProjectJSON
}

function isSupportedKind(kind: string): kind is TwickTransitionKind {
  return (TWICK_TRANSITION_KINDS as readonly string[]).includes(kind)
}

function normalizeDuration(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0.5
  return Math.min(2, Math.max(0.2, Number(duration.toFixed(2))))
}

export function createTwickTransition(input: TimelineTransitionInput): ElementTransitionJSON {
  if (!isSupportedKind(input.kind)) {
    throw new Error(`Unsupported Twick transition kind: ${input.kind}`)
  }

  return {
    toElementId: input.toElementId,
    duration: normalizeDuration(input.duration),
    kind: input.kind,
  }
}

export function findTimelineElement(project: Pick<ProjectJSON, 'tracks'> | null | undefined, elementId: string): TwickTimelineElement | null {
  if (!project?.tracks || !elementId) return null

  for (const track of project.tracks) {
    const elements = Array.isArray(track.elements) ? track.elements as TwickTimelineElement[] : []
    const element = elements.find((candidate) => candidate.id === elementId)
    if (element) return element
  }

  return null
}

export function applyTwickTransitionToProject<TProject extends Pick<ProjectJSON, 'tracks'>>(
  project: TProject,
  input: TimelineTransitionInput,
): TProject {
  const transition = createTwickTransition(input)
  let foundFrom = false
  let foundTo = false

  const tracks = project.tracks.map((track) => ({
    ...track,
    elements: (track.elements || []).map((element) => {
      if (element.id === input.toElementId) foundTo = true
      if (element.id !== input.fromElementId) return element
      foundFrom = true
      return {
        ...element,
        transition,
      }
    }),
  }))

  if (!foundFrom) throw new Error('TRANSITION_FROM_ELEMENT_NOT_FOUND')
  if (!foundTo) throw new Error('TRANSITION_TO_ELEMENT_NOT_FOUND')

  return {
    ...project,
    tracks,
  }
}

export function setTimelineElementTransition(editor: TransitionEditorLike, input: TimelineTransitionInput): ProjectJSON | null {
  const transition = createTwickTransition(input)

  if (typeof editor.addTransition === 'function') {
    const ok = editor.addTransition(input.fromElementId, input.toElementId, transition.kind, transition.duration)
    if (!ok) return null
    return typeof editor.getProject === 'function' ? editor.getProject() : null
  }

  if (typeof editor.updateElements === 'function') {
    editor.updateElements([
      {
        elementId: input.fromElementId,
        updates: { transition },
      },
    ])
    return typeof editor.getProject === 'function' ? editor.getProject() : null
  }

  return null
}
