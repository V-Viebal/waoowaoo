'use client'

import { useTranslations } from 'next-intl'
import { useTimelineContext } from '@twick/timeline'
import { ElementDeserializer } from '@twick/timeline'
import { useEditorStageRuntime } from '@/lib/novel-promotion/stages/editor-stage-runtime-core'
import { panelToVideoElement } from '@/lib/twick/asset-adapter'

export function VideoAssetList() {
  const t = useTranslations('novelPromotion.editor.assets')
  const { panelVideos } = useEditorStageRuntime()
  const { editor, present } = useTimelineContext()

  const handleAddVideo = async (panelId: string) => {
    const panel = panelVideos.find((item) => item.panelId === panelId)
    if (!panel) return

    const videoTrack = editor.getTracksByType('video')[0] ?? editor.addTrack(t('tracks.video'), 'video')
    const currentEnd = Math.max(
      0,
      ...(present?.tracks
        ?.flatMap((track) => track.elements ?? [])
        .filter((element) => element.type === 'video')
        .map((element) => element.e) ?? []),
    )
    const element = ElementDeserializer.fromJSON(panelToVideoElement(panel, currentEnd))
    if (!element) return

    await editor.addElementToTrack(videoTrack, element)
  }

  if (panelVideos.length === 0) {
    return <EmptyState text={t('empty.video')} />
  }

  return (
    <div className="space-y-2">
      {panelVideos.map((panel, index) => (
        <button
          key={panel.panelId}
          type="button"
          draggable
          onClick={() => { void handleAddVideo(panel.panelId) }}
          className="w-full cursor-pointer rounded-2xl border border-slate-200 bg-slate-50 p-2 text-left transition hover:border-slate-400 hover:bg-white"
          title={panel.description || panel.panelId}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-slate-500">#{index + 1}</span>
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-600">
              {t('duration', { duration: panel.duration.toFixed(1) })}
            </span>
          </div>
          <div className="mt-1 line-clamp-2 text-xs text-slate-900">
            {panel.description || panel.panelId}
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
