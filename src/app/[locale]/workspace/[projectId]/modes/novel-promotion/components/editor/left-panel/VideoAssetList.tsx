'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useTimelineContext } from '@twick/timeline'
import { ElementDeserializer } from '@twick/timeline'
import { useEditorStageRuntime } from '@/lib/novel-promotion/stages/editor-stage-runtime-core'
import { panelToVideoElement } from '@/lib/twick/asset-adapter'
import type { PanelVideoSource } from '@/lib/twick/types'
import { AppIcon } from '@/components/ui/icons'
import { useWorkspaceProvider } from '../../../WorkspaceProvider'

// Resolve mediaobj URLs to HTTP URLs for display
async function resolveMediaObjUrl(projectId: string, mediaObjRef: string): Promise<string> {
  try {
    const response = await fetch(`/api/novel-promotion/${projectId}/media-resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refs: [mediaObjRef] })
    })
    if (response.ok) {
      const { urls } = await response.json()
      return urls[mediaObjRef] || ''
    }
  } catch {
    // ignore
  }
  return ''
}

interface VideoThumbnailProps {
  panel: PanelVideoSource
  projectId: string
}

function VideoThumbnail({ panel, projectId }: VideoThumbnailProps) {
  const [imageUrl, setImageUrl] = useState<string>('')
  const [videoFrameUrl, setVideoFrameUrl] = useState<string>('')
  const videoRef = useRef<HTMLVideoElement>(null)

  // 优先使用分镜图作为封面
  useEffect(() => {
    if (!panel.posterMediaObjectId) return
    let cancelled = false
    const mediaObjRef = `mediaobj://${panel.posterMediaObjectId}`
    resolveMediaObjUrl(projectId, mediaObjRef).then((url) => {
      if (!cancelled) setImageUrl(url)
    })
    return () => { cancelled = true }
  }, [panel.posterMediaObjectId, projectId])

  // 如果没有分镜图，加载视频提取首帧
  useEffect(() => {
    if (imageUrl || !panel.videoMediaObjectId) return
    let cancelled = false
    const mediaObjRef = `mediaobj://${panel.videoMediaObjectId}`
    resolveMediaObjUrl(projectId, mediaObjRef).then((url) => {
      if (!cancelled && url) {
        setVideoFrameUrl(url)
      }
    })
    return () => { cancelled = true }
  }, [imageUrl, panel.videoMediaObjectId, projectId])

  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="" className="h-full w-full object-cover" />
  }

  if (videoFrameUrl) {
    return (
      <video
        ref={videoRef}
        src={videoFrameUrl}
        className="h-full w-full object-cover"
        muted
        preload="metadata"
        onLoadedMetadata={(e) => { (e.currentTarget as HTMLVideoElement).currentTime = 0.1 }}
      />
    )
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-100 text-slate-400">
      <AppIcon name="play" className="h-5 w-5" />
    </div>
  )
}

export function VideoAssetList() {
  const t = useTranslations('novelPromotion.editor.assets')
  const { panelVideos } = useEditorStageRuntime()
  const { projectId } = useWorkspaceProvider()
  const { editor, present } = useTimelineContext()

  const handleAddVideo = async (panelId: string) => {
    const panel = panelVideos.find((item) => item.panelId === panelId)
    if (!panel) return

    const videoTrack = editor.getTracksByType('video')[0] ?? editor.addTrack(t('tracks.video'), 'video')
    // ponytail: guard against missing/NaN `e` — Math.max(..., NaN) is NaN.
    const videoEnds = present?.tracks
      ?.flatMap((track) => track.elements ?? [])
      .filter((element) => element.type === 'video')
      .map((element) => (typeof element.e === 'number' && Number.isFinite(element.e) ? element.e : 0)) ?? []
    const currentEnd = videoEnds.length > 0 ? Math.max(0, ...videoEnds) : 0
    const element = ElementDeserializer.fromJSON(panelToVideoElement(panel, currentEnd))
    if (!element) return

    try {
      await editor.addElementToTrack(videoTrack, element)
    } catch (error) {
      // ponytail: catch ELEMENT_NOT_ADDED and similar errors to prevent unhandled rejection
      console.warn('[VideoAssetList] Failed to add element:', error)
    }
  }

  const sortedPanels = useMemo(() => {
    return [...panelVideos].sort((a, b) => {
      const ai = a.panelIndex ?? 0
      const bi = b.panelIndex ?? 0
      return ai - bi
    })
  }, [panelVideos])

  if (sortedPanels.length === 0) {
    return <EmptyState text={t('empty.video')} />
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {sortedPanels.map((panel, index) => (
        <button
          key={panel.panelId}
          type="button"
          draggable
          onClick={() => { void handleAddVideo(panel.panelId) }}
          className="group relative overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] text-left transition hover:border-[var(--glass-accent-from)] hover:shadow-md"
          title={panel.description || panel.panelId}
        >
          <div className="relative aspect-video w-full overflow-hidden bg-slate-100">
            <VideoThumbnail panel={panel} projectId={projectId} />
            <span className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] text-white">
              {t('duration', { duration: panel.duration.toFixed(1) })}
            </span>
            <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] text-white">
              #{index + 1}
            </span>
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
              <span className="rounded-full bg-white/90 px-2 py-1 text-[10px] font-medium text-slate-900">
                {t('clickToAdd')}
              </span>
            </div>
          </div>
          <div className="line-clamp-2 px-2 py-1.5 text-[11px] text-[var(--glass-text-secondary)]">
            {panel.description || panel.panelId}
          </div>
        </button>
      ))}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--glass-border)] p-4 text-center text-xs text-[var(--glass-text-secondary)]">
      {text}
    </div>
  )
}
