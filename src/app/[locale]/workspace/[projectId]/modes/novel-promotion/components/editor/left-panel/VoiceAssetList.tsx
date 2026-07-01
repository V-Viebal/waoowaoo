'use client'

import { useTranslations } from 'next-intl'
import { ElementDeserializer, useTimelineContext } from '@twick/timeline'
import { useEditorStageRuntime } from '@/lib/novel-promotion/stages/editor-stage-runtime-core'
import { voiceLineToAudioElement } from '@/lib/twick/asset-adapter'

export function VoiceAssetList() {
  const t = useTranslations('novelPromotion.editor.assets')
  const { voiceLineSources } = useEditorStageRuntime()
  const { editor, present } = useTimelineContext()

  const handleAddVoice = async (voiceLineId: string) => {
    const voiceLine = voiceLineSources.find((item) => item.voiceLineId === voiceLineId)
    if (!voiceLine) return

    const audioTrack = editor.getTracksByType('audio')[0] ?? editor.addTrack(t('tracks.audio'), 'audio')
    // ponytail: guard against missing/NaN `e` — Math.max(..., NaN) is NaN and would
    // produce an audio element with s/e of NaN.
    const audioEnds = present?.tracks
      ?.flatMap((track) => track.elements ?? [])
      .filter((element) => element.type === 'audio')
      .map((element) => (typeof element.e === 'number' && Number.isFinite(element.e) ? element.e : 0)) ?? []
    const currentEnd = audioEnds.length > 0 ? Math.max(0, ...audioEnds) : 0
    const element = ElementDeserializer.fromJSON(voiceLineToAudioElement(voiceLine, currentEnd))
    if (!element) return

    try {
      await editor.addElementToTrack(audioTrack, element)
    } catch (error) {
      // ponytail: Twick throws ELEMENT_NOT_ADDED for element-mount/geometry races.
      // Log & drop — matches VideoAssetList's error handling.
      console.warn('[VoiceAssetList] addElementToTrack failed', error)
    }
  }

  if (voiceLineSources.length === 0) {
    return <EmptyState text={t('empty.audio')} />
  }

  return (
    <div className="space-y-2">
      {voiceLineSources.map((voiceLine, index) => (
        <button
          key={voiceLine.voiceLineId}
          type="button"
          draggable
          onClick={() => { void handleAddVoice(voiceLine.voiceLineId) }}
          className="w-full cursor-pointer rounded-2xl border border-slate-200 bg-slate-50 p-2 text-left transition hover:border-slate-400 hover:bg-white"
          title={voiceLine.text || voiceLine.voiceLineId}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-slate-500">
              {voiceLine.speaker || t('voiceLine', { index: index + 1 })}
            </span>
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-600">
              {t('duration', { duration: voiceLine.duration.toFixed(1) })}
            </span>
          </div>
          <div className="mt-1 line-clamp-2 text-xs text-slate-900">
            {voiceLine.text || voiceLine.voiceLineId}
          </div>
          <div className="mt-2 text-[10px] text-slate-400">{t('clickToAdd')}</div>
        </button>
      ))}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
      {text}
    </div>
  )
}
