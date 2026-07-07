'use client'

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
              className="flex gap-3 p-3"
            >
              <div className="h-28 w-28 flex-shrink-0 overflow-hidden rounded-[var(--glass-radius-md)] bg-[var(--glass-bg-muted)]">
                {mediaType === 'image' ? (
                  <MediaImageWithLoading
                    src={item.publicUrl}
                    alt=""
                    containerClassName="h-full w-full"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <video
                    src={item.publicUrl}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
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
                <div className="flex-1" />
                <div className="mt-2 flex gap-2">
                  <GlassButton
                    variant="primary"
                    size="sm"
                    loading={useVersion.isPending}
                    onClick={() =>
                      useVersion.mutate({ panelId, mediaType, url: item.url })
                    }
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
              </div>
            </GlassSurface>
          ))}
      </div>
    </GlassModalShell>
  )
}
