'use client'

import { useCallback, useRef, useState } from 'react'
import { GlassButton, GlassModalShell, GlassSurface } from '@/components/ui/primitives'
import { AppIcon } from '@/components/ui/icons'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import {
  formatTimeAgo,
  usePanelHistory,
  usePanelHistoryActions,
  type HistoryItem,
  type PanelHistoryMediaType,
} from '@/lib/query/hooks/usePanelHistory'

interface PanelHistoryDrawerProps {
  projectId: string
  panelId: string
  mediaType: PanelHistoryMediaType
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function HistoryItemMeta({ item }: { item: HistoryItem }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 text-sm text-[var(--glass-text-secondary)]">
        <AppIcon name="clock" className="h-3.5 w-3.5" />
        <span>{formatTimeAgo(item.timestamp)}</span>
      </div>
      {item.sizeBytes != null && (
        <div className="mt-1 text-xs text-[var(--glass-text-tertiary)]">
          {formatSize(item.sizeBytes)}
        </div>
      )}
    </div>
  )
}

function HistoryItemActions({
  item,
  useVersionPending,
  onUseVersion,
}: {
  item: HistoryItem
  useVersionPending: boolean
  onUseVersion: (url: string) => void
}) {
  return (
    <div className="flex flex-shrink-0 gap-2">
      <GlassButton
        variant="primary"
        size="sm"
        loading={useVersionPending}
        onClick={() => onUseVersion(item.url)}
      >
        使用此版本
      </GlassButton>
      <a
        href={item.publicUrl}
        download
        className="glass-btn-base glass-btn-ghost h-8 px-3 text-xs"
      >
        <AppIcon name="download" className="mr-1 h-3.5 w-3.5" />
        下载
      </a>
    </div>
  )
}

function VideoHistoryItem({
  item,
  useVersionPending,
  onUseVersion,
}: {
  item: HistoryItem
  useVersionPending: boolean
  onUseVersion: (url: string) => void
}) {
  const [playing, setPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const handlePlay = useCallback(() => {
    setPlaying(true)
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.play().catch(() => {
          // Autoplay may fail if gesture not recognized; controls are visible so user can tap play.
        })
      }
    }, 50)
  }, [])

  const handleStop = useCallback(() => {
    setPlaying(false)
  }, [])

  return (
    <div className={playing ? 'flex flex-col gap-3' : 'flex gap-3'}>
      {playing ? (
        <video
          ref={videoRef}
          key={item.publicUrl}
          src={item.publicUrl}
          controls
          playsInline
          autoPlay
          className="w-full rounded-[var(--glass-radius-md)] bg-black object-contain"
          onEnded={handleStop}
          onPause={(event) => {
            if (!event.currentTarget.ended) handleStop()
          }}
        />
      ) : (
        <button
          type="button"
          onClick={handlePlay}
          className="group relative h-28 w-28 flex-shrink-0 overflow-hidden rounded-[var(--glass-radius-md)] bg-[var(--glass-bg-muted)]"
          aria-label="播放视频"
        >
          <video
            src={item.publicUrl}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors group-hover:bg-black/50">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-lg transition-transform group-hover:scale-110">
              <AppIcon name="play" className="ml-0.5 h-5 w-5 text-black" />
            </div>
          </div>
        </button>
      )}
      {playing ? (
        <div className="flex items-center gap-3">
          <HistoryItemMeta item={item} />
          <HistoryItemActions
            item={item}
            useVersionPending={useVersionPending}
            onUseVersion={onUseVersion}
          />
        </div>
      ) : (
        <>
          <HistoryItemMeta item={item} />
          <div className="flex-1" />
          <HistoryItemActions
            item={item}
            useVersionPending={useVersionPending}
            onUseVersion={onUseVersion}
          />
        </>
      )}
    </div>
  )
}

export default function PanelHistoryDrawer({
  projectId,
  panelId,
  mediaType,
  open,
  onOpenChange,
}: PanelHistoryDrawerProps) {
  const { data, isLoading } = usePanelHistory(projectId, panelId, mediaType, open)
  const { useVersion, downloadZip } = usePanelHistoryActions(projectId)

  const title = mediaType === 'image' ? '历史图片' : '历史视频'
  const items: HistoryItem[] = data?.items ?? []

  const handleUseVersion = useCallback(
    (url: string) => {
      useVersion.mutate({ panelId, mediaType, url })
    },
    [useVersion, panelId, mediaType],
  )

  return (
    <GlassModalShell
      open={open}
      onClose={() => onOpenChange(false)}
      title={title}
      size="lg"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-sm text-[var(--glass-text-secondary)]">
          {items.length} 个历史版本
        </span>
        <GlassButton
          variant="secondary"
          size="sm"
          disabled={items.length === 0 || isLoading}
          onClick={() => downloadZip(panelId, mediaType)}
          iconLeft={<AppIcon name="download" className="h-4 w-4" />}
        >
          全部下载
        </GlassButton>
      </div>

      <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
        {isLoading && (
          <p className="py-8 text-center text-sm text-[var(--glass-text-secondary)]">
            加载中…
          </p>
        )}
        {!isLoading && items.length === 0 && (
          <p className="py-8 text-center text-sm text-[var(--glass-text-tertiary)]">
            暂无历史素材
          </p>
        )}
        {!isLoading &&
          items.map((item, index) => (
            <GlassSurface
              key={`${item.url}-${index}`}
              variant="panel"
              padded={false}
              className="p-3"
            >
              {mediaType === 'image' ? (
                <div className="flex gap-3">
                  <div className="h-28 w-28 flex-shrink-0 overflow-hidden rounded-[var(--glass-radius-md)] bg-[var(--glass-bg-muted)]">
                    <MediaImageWithLoading
                      src={item.publicUrl}
                      alt=""
                      containerClassName="h-full w-full"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <HistoryItemMeta item={item} />
                  <div className="flex-1" />
                  <HistoryItemActions
                    item={item}
                    useVersionPending={useVersion.isPending}
                    onUseVersion={handleUseVersion}
                  />
                </div>
              ) : (
                <VideoHistoryItem
                  item={item}
                  useVersionPending={useVersion.isPending}
                  onUseVersion={handleUseVersion}
                />
              )}
            </GlassSurface>
          ))}
      </div>
    </GlassModalShell>
  )
}
