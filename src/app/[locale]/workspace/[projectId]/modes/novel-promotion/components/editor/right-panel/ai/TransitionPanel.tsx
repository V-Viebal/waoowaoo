'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useTimelineContext } from '@twick/timeline'
import { apiFetch } from '@/lib/api-fetch'
import { useEditorStageRuntime } from '@/lib/novel-promotion/stages/editor-stage-runtime-core'
import type { SmartTransitionRecommendation } from '@/lib/novel-promotion/editor/smart-transition'
import { normalizeTwickTransitionDuration, setTimelineElementTransition } from '@/lib/twick/transition'
import type { TwickTimelineElement } from '@/lib/twick/types'
import { useWorkspaceProvider } from '../../../../WorkspaceProvider'
import { AiCard } from './AiCard'

type TransitionPair = {
  fromElementId: string
  toElementId: string
  fromLabel: string
  toLabel: string
}

type TransitionResponse = {
  data?: {
    recommendations?: SmartTransitionRecommendation[]
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getSelectedElementId(selectedItem: unknown): string | null {
  if (!selectedItem || typeof selectedItem !== 'object') return null
  const maybeGetId = (selectedItem as { getId?: unknown }).getId
  if (typeof maybeGetId === 'function') {
    const id = maybeGetId.call(selectedItem)
    return readString(id)
  }
  return readString((selectedItem as { id?: unknown }).id)
}

function isTransitionMediaElement(element: TwickTimelineElement): boolean {
  return element.type === 'video' || element.type === 'image'
}

function getElementLabel(element: TwickTimelineElement): string {
  const metadata = element.metadata && typeof element.metadata === 'object'
    ? element.metadata as Record<string, unknown>
    : {}
  return readString(metadata.panelId) || element.id
}

function findAdjacentTransitionPair(params: {
  selectedElementId: string | null
  present: { tracks?: Array<{ elements?: TwickTimelineElement[] }> } | null
}): TransitionPair | null {
  if (!params.selectedElementId || !params.present?.tracks) return null

  for (const track of params.present.tracks) {
    const elements = (Array.isArray(track.elements) ? track.elements : [])
      .filter(isTransitionMediaElement)
      .slice()
      .sort((a, b) => (readNumber(a.s) ?? 0) - (readNumber(b.s) ?? 0))
    const selectedIndex = elements.findIndex((element) => element.id === params.selectedElementId)
    if (selectedIndex < 0) continue

    const selected = elements[selectedIndex]
    const next = elements[selectedIndex + 1]
    if (!next) return null

    const selectedEnd = readNumber(selected.e)
    const nextStart = readNumber(next.s)
    if (selectedEnd !== null && nextStart !== null && nextStart < selectedEnd - 0.01) {
      return null
    }

    return {
      fromElementId: selected.id,
      toElementId: next.id,
      fromLabel: getElementLabel(selected),
      toLabel: getElementLabel(next),
    }
  }

  return null
}

function readErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (typeof record.message === 'string') return record.message
    if (typeof record.errorMessage === 'string') return record.errorMessage
    if (typeof record.error === 'string') return record.error
  }
  return fallback
}

export function TransitionPanel() {
  const t = useTranslations('novelPromotion.editor.rightPanel.ai')
  const { projectId, episodeId } = useWorkspaceProvider()
  const { present, selectedItem, editor } = useTimelineContext()
  const { editorProjectId, isLoadingData, isLoadingProject, updateProjectData, flushProjectSave } = useEditorStageRuntime()
  const [recommendations, setRecommendations] = useState<SmartTransitionRecommendation[]>([])
  const [localError, setLocalError] = useState<string | null>(null)
  const [appliedKind, setAppliedKind] = useState<string | null>(null)

  const selectedElementId = getSelectedElementId(selectedItem)
  const pair = useMemo(() => findAdjacentTransitionPair({
    selectedElementId,
    present,
  }), [present, selectedElementId])

  useEffect(() => {
    setRecommendations([])
    setLocalError(null)
    setAppliedKind(null)
  }, [pair?.fromElementId, pair?.toElementId])

  const recommendationMutation = useMutation({
    mutationFn: async () => {
      if (!episodeId || !editorProjectId || !pair) throw new Error(t('transition.missingContext'))
      setLocalError(null)
      setAppliedKind(null)
      await flushProjectSave()
      const res = await apiFetch(`/api/novel-promotion/${projectId}/editor/ai/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId,
          editorProjectId,
          fromElementId: pair.fromElementId,
          toElementId: pair.toElementId,
          requestId: `transition:${editorProjectId}:${pair.fromElementId}:${pair.toElementId}:${Date.now()}`,
        }),
      })
      const json = await res.json().catch(() => ({})) as TransitionResponse & Record<string, unknown>
      if (!res.ok) {
        throw new Error(readErrorMessage(json, t('transition.failed')))
      }
      const nextRecommendations = Array.isArray(json.data?.recommendations) ? json.data.recommendations : []
      setRecommendations(nextRecommendations)
      return nextRecommendations
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : null
      if (message === 'conflict') {
        setLocalError(t('transition.saveConflict'))
      } else if (message === 'unsaved-changes') {
        setLocalError(t('transition.unsavedChanges'))
      } else if (message === 'TRANSITION_FROM_ELEMENT_NOT_FOUND' || message === 'TRANSITION_TO_ELEMENT_NOT_FOUND') {
        setLocalError(t('transition.elementNotFound'))
      } else {
        setLocalError(message || t('transition.failed'))
      }
    },
  })

  const applyRecommendation = async (recommendation: SmartTransitionRecommendation) => {
    if (!pair) return
    setLocalError(null)
    const latestProject = setTimelineElementTransition(editor, {
      fromElementId: pair.fromElementId,
      toElementId: pair.toElementId,
      kind: recommendation.kind,
      duration: recommendation.duration,
    })
    if (!latestProject) {
      setLocalError(t('transition.applyFailed'))
      return
    }
    try {
      updateProjectData(latestProject)
      await flushProjectSave()
      setAppliedKind(recommendation.kind)
    } catch (error) {
      const message = error instanceof Error ? error.message : null
      setLocalError(message === 'conflict' ? t('transition.saveConflict') : message || t('transition.applyFailed'))
    }
  }

  const disabledReason = useMemo(() => {
    if (!episodeId || !editorProjectId) return t('transition.missingContext')
    if (isLoadingData || isLoadingProject) return t('transition.loading')
    if (!selectedElementId) return t('transition.selectClip')
    if (!pair) return t('transition.noNextClip')
    return null
  }, [editorProjectId, episodeId, isLoadingData, isLoadingProject, pair, selectedElementId, t])

  const canRecommend = !disabledReason && !recommendationMutation.isPending
  const statusText = recommendationMutation.isPending
    ? t('transition.running')
    : localError
      ? localError
      : appliedKind
        ? t('transition.applied', { kind: appliedKind })
        : disabledReason

  return (
    <AiCard
      tone="amber"
      icon="shuffle"
      title={t('transition.title')}
      description={t('transition.description')}
      status={statusText || null}
      isError={!!localError}
      actionLabel={recommendationMutation.isPending ? t('transition.runningButton') : t('transition.button')}
      onAction={() => { void recommendationMutation.mutateAsync() }}
      disabled={!canRecommend}
      running={recommendationMutation.isPending}
    >
      {pair ? (
        <div className="rounded-lg bg-white/70 px-2 py-1.5 text-[11px] leading-4 text-slate-600 ring-1 ring-inset ring-slate-100">
          {t('transition.selectedPair', { from: pair.fromLabel, to: pair.toLabel })}
        </div>
      ) : null}
      {recommendations.length ? (
        <div className="mt-2 space-y-2">
          {recommendations.map((recommendation) => {
            const isApplied = appliedKind === recommendation.kind
            return (
              <button
                key={recommendation.kind}
                type="button"
                onClick={() => { void applyRecommendation(recommendation) }}
                className={`w-full rounded-xl border p-2 text-left transition ${isApplied ? 'border-amber-400 bg-amber-50 shadow-sm' : 'border-slate-200 bg-white hover:border-amber-300 hover:bg-amber-50/50'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">{t(`transition.kinds.${recommendation.kind}`)}</span>
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                    {Math.round(recommendation.confidence * 100)}%
                  </span>
                </div>
                <div className="mt-1 text-[10px] leading-4 text-slate-500">
                  {t('transition.duration', { seconds: normalizeTwickTransitionDuration(recommendation.duration).toFixed(2) })}
                </div>
                <div className="mt-1 text-[10px] leading-4 text-slate-400">{t(`transition.reasons.${recommendation.reasonKey}`)}</div>
              </button>
            )
          })}
        </div>
      ) : null}
      <div className="mt-1 text-[10px] leading-4 text-slate-400">{t('transition.freeNote')}</div>
      <div className="mt-1 text-[10px] leading-4 text-amber-600">{t('transition.renderSupportNote')}</div>
    </AiCard>
  )
}
