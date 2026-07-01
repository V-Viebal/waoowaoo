import type { ProjectJSON } from '@twick/timeline'
import type { TwickTimelineElement } from '@/lib/twick/types'
import { TWICK_TRANSITION_KINDS, type TwickTransitionKind } from '@/lib/twick/transition'

export type SmartTransitionClip = {
  elementId: string
  storyboardId?: string | null
  panelId?: string | null
  type?: string | null
  start?: number | null
  end?: number | null
}

export type SmartTransitionReasonKey =
  | 'sameScene.dissolve'
  | 'sameScene.fade'
  | 'sceneChange.fade'
  | 'sceneChange.dissolve'
  | 'panelChange.slide'
  | 'dynamic.zoom'
  | 'fallback.general'

export type SmartTransitionRecommendation = {
  kind: TwickTransitionKind
  duration: number
  confidence: number
  reasonKey: SmartTransitionReasonKey
}

export type SmartTransitionInput = {
  from: SmartTransitionClip
  to: SmartTransitionClip
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isTransitionMediaElement(element: TwickTimelineElement): boolean {
  return element.type === 'video' || element.type === 'image'
}

function clipFromElement(element: TwickTimelineElement): SmartTransitionClip {
  const metadata = element.metadata && typeof element.metadata === 'object'
    ? element.metadata as Record<string, unknown>
    : {}

  return {
    elementId: element.id,
    type: element.type,
    storyboardId: readString(metadata.storyboardId),
    panelId: readString(metadata.panelId),
    start: readNumber(element.s),
    end: readNumber(element.e),
  }
}

function pushUniqueRecommendation(
  recommendations: SmartTransitionRecommendation[],
  recommendation: SmartTransitionRecommendation,
) {
  if (recommendations.some((item) => item.kind === recommendation.kind)) return
  recommendations.push(recommendation)
}

export function recommendSmartTransitions(input: SmartTransitionInput): SmartTransitionRecommendation[] {
  const sameStoryboard = !!input.from.storyboardId && input.from.storyboardId === input.to.storyboardId
  // ponytail: true when the two clips render different generated panels (adjacent shots
  // often move between panels). Old name `continuousPanels` was semantically inverted.
  const differentPanels = !!input.from.panelId && !!input.to.panelId && input.from.panelId !== input.to.panelId

  const recommendations: SmartTransitionRecommendation[] = []

  if (sameStoryboard) {
    pushUniqueRecommendation(recommendations, {
      kind: 'dissolve',
      duration: 0.55,
      confidence: 0.88,
      reasonKey: 'sameScene.dissolve',
    })
    pushUniqueRecommendation(recommendations, {
      kind: 'fade',
      duration: 0.45,
      confidence: 0.72,
      reasonKey: 'sameScene.fade',
    })
  } else {
    pushUniqueRecommendation(recommendations, {
      kind: 'fade',
      duration: 0.7,
      confidence: 0.86,
      reasonKey: 'sceneChange.fade',
    })
    pushUniqueRecommendation(recommendations, {
      kind: 'dissolve',
      duration: 0.6,
      confidence: 0.74,
      reasonKey: 'sceneChange.dissolve',
    })
  }

  if (differentPanels) {
    pushUniqueRecommendation(recommendations, {
      kind: 'slide',
      duration: 0.5,
      confidence: sameStoryboard ? 0.68 : 0.6,
      reasonKey: 'panelChange.slide',
    })
  }

  pushUniqueRecommendation(recommendations, {
    kind: 'zoom',
    duration: 0.45,
    confidence: sameStoryboard ? 0.58 : 0.52,
    reasonKey: 'dynamic.zoom',
  })

  for (const kind of TWICK_TRANSITION_KINDS) {
    if (recommendations.length >= 4) break
    pushUniqueRecommendation(recommendations, {
      kind,
      duration: 0.5,
      confidence: 0.5,
      reasonKey: 'fallback.general',
    })
  }

  return recommendations
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
}

export function buildSmartTransitionInputFromProject(params: {
  projectData: ProjectJSON
  fromElementId: string
  toElementId: string
}): SmartTransitionInput {
  if (params.fromElementId === params.toElementId) throw new Error('TRANSITION_SAME_ELEMENT')

  const allElements = (params.projectData.tracks || []).flatMap((track) => (
    Array.isArray(track.elements) ? track.elements as TwickTimelineElement[] : []
  ))
  if (!allElements.some((element) => element.id === params.fromElementId)) {
    throw new Error('TRANSITION_FROM_ELEMENT_NOT_FOUND')
  }
  if (!allElements.some((element) => element.id === params.toElementId)) {
    throw new Error('TRANSITION_TO_ELEMENT_NOT_FOUND')
  }

  for (const track of params.projectData.tracks || []) {
    const elements = Array.isArray(track.elements) ? track.elements as TwickTimelineElement[] : []
    const fromElement = elements.find((element) => element.id === params.fromElementId)
    const toElement = elements.find((element) => element.id === params.toElementId)

    if (!fromElement && !toElement) continue
    if (!fromElement) throw new Error('TRANSITION_FROM_TO_DIFFERENT_TRACKS')
    if (!toElement) throw new Error('TRANSITION_FROM_TO_DIFFERENT_TRACKS')
    if (!isTransitionMediaElement(fromElement) || !isTransitionMediaElement(toElement)) {
      throw new Error('TRANSITION_UNSUPPORTED_ELEMENT_TYPE')
    }

    const orderedMediaElements = elements
      .filter(isTransitionMediaElement)
      .slice()
      .sort((a, b) => (readNumber(a.s) ?? 0) - (readNumber(b.s) ?? 0))
    const fromIndex = orderedMediaElements.findIndex((element) => element.id === params.fromElementId)
    const expectedToElement = fromIndex >= 0 ? orderedMediaElements[fromIndex + 1] : null

    if (!expectedToElement || expectedToElement.id !== params.toElementId) {
      throw new Error('TRANSITION_ELEMENTS_NOT_ADJACENT')
    }

    const fromEnd = readNumber(fromElement.e)
    const toStart = readNumber(toElement.s)
    if (fromEnd !== null && toStart !== null && toStart < fromEnd - 0.01) {
      throw new Error('TRANSITION_ELEMENTS_NOT_ADJACENT')
    }

    return {
      from: clipFromElement(fromElement),
      to: clipFromElement(toElement),
    }
  }

  throw new Error('TRANSITION_FROM_TO_DIFFERENT_TRACKS')
}
