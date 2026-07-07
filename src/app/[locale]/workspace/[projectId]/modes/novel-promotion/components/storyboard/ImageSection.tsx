'use client'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useParams } from 'next/navigation'
import './ImageSection.css'
import { GlassButton } from '@/components/ui/primitives'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import TaskStatusOverlay from '@/components/task/TaskStatusOverlay'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import ImageSectionCandidateMode from './ImageSectionCandidateMode'
import ImageSectionActionButtons from './ImageSectionActionButtons'
import PanelHistoryDrawer from './PanelHistoryDrawer'
import { AppIcon } from '@/components/ui/icons'
import { useImageGenerationCount } from '@/lib/image-generation/use-image-generation-count'
import { getImageGenerationCountOptions, normalizeImageGenerationCount } from '@/lib/image-generation/count'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import { parsePanelHistory } from '@/lib/novel-promotion/panel-history'

interface PanelCandidateData {
  candidates: string[]
  selectedIndex: number
}

interface ImageSectionProps {
  panelId: string
  imageUrl: string | null
  imageHistory?: string | null
  globalPanelNumber: number
  shotType: string
  videoRatio: string
  isDeleting: boolean
  isModifying: boolean
  isSubmittingPanelImageTask: boolean
  failedError: string | null
  candidateData: PanelCandidateData | null
  previousImageUrl?: string | null
  onRegeneratePanelImage: (panelId: string, count?: number, force?: boolean, panelGridSize?: number) => void
  onOpenEditModal: () => void
  onOpenAIDataModal: () => void
  onSelectCandidateIndex: (panelId: string, index: number) => void
  onConfirmCandidate: (panelId: string, imageUrl: string) => Promise<void>
  onCancelCandidate: (panelId: string) => void
  onClearError: () => void
  onUndo?: (panelId: string) => void
  onPreviewImage?: (url: string) => void
}

export default function ImageSection({
  panelId,
  imageUrl,
  imageHistory,
  globalPanelNumber,
  shotType,
  videoRatio,
  isDeleting,
  isModifying,
  isSubmittingPanelImageTask,
  failedError,
  candidateData,
  previousImageUrl,
  onRegeneratePanelImage,
  onOpenEditModal,
  onOpenAIDataModal,
  onSelectCandidateIndex,
  onConfirmCandidate,
  onCancelCandidate,
  onClearError,
  onUndo,
  onPreviewImage,
}: ImageSectionProps) {
  const t = useTranslations('storyboard')
  const params = useParams()
  const projectId = (params?.projectId as string) || ''
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyCount = parsePanelHistory(imageHistory).length
  const { count: candidateCount, setCount: setCandidateCount } = useImageGenerationCount('storyboard-candidates')
  // 分镜宫格数：读写项目级配置（所有镜头共享、与项目配置同源），而非 localStorage
  const runtime = useWorkspaceStageRuntime()
  const panelGridSize = normalizeImageGenerationCount('storyboard-grid', runtime.panelGridSize)
  const setPanelGridSize = (value: number) => { void runtime.onPanelGridSizeChange(value) }
  const [isTaskPulseAnimating, setIsTaskPulseAnimating] = useState(false)
  const cssAspectRatio = videoRatio.replace(':', '/')
  const hasValidCandidates = !!candidateData && candidateData.candidates.some((url) => !url.startsWith('PENDING:'))

  const triggerPulse = () => {
    setIsTaskPulseAnimating(true)
    setTimeout(() => setIsTaskPulseAnimating(false), 600)
  }

  const renderLoadingState = (
    intent: 'generate' | 'regenerate' | 'modify' | 'process',
    backdropImageUrl: string | null = null,
  ) => {
    const state = resolveTaskPresentationState({
      phase: 'processing',
      intent,
      resource: 'image',
      hasOutput: !!backdropImageUrl,
    })

    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[var(--glass-bg-surface-modal)] backdrop-blur-md group/loading">
        {backdropImageUrl && (
          <MediaImageWithLoading
            src={backdropImageUrl}
            alt={t('image.clickToPreview')}
            containerClassName="absolute inset-0 h-full w-full"
            className="absolute inset-0 h-full w-full object-cover"
            sizes="(max-width: 768px) 100vw, 33vw"
          />
        )}
        <div className={`absolute inset-0 ${backdropImageUrl ? 'bg-black/45 backdrop-blur-[1px]' : 'bg-[var(--glass-bg-surface-modal)] backdrop-blur-md'}`} />
        <TaskStatusOverlay
          state={state}
          className={backdropImageUrl ? 'bg-black/45 backdrop-blur-[1px]' : undefined}
        />
      </div>
    )
  }

  const renderFailedState = () => (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-[var(--glass-danger-ring)] text-[var(--glass-tone-danger-fg)] p-2">
      <AppIcon name="alert" className="w-6 h-6 mb-1" />
      <span className="text-xs text-center font-medium">{t('image.failed')}</span>
      <span className="text-[10px] text-center mt-1 line-clamp-2 px-1">{failedError}</span>
      <button
        onClick={onClearError}
        className="glass-btn-base glass-btn-tone-danger mt-1 px-2 py-1 text-[10px] rounded-md"
      >
        {t('variant.close')}
      </button>
    </div>
  )

  const renderEmptyState = () => (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[var(--glass-bg-surface-strong)] text-[var(--glass-text-tertiary)] p-3">
      <AppIcon name="imagePreview" className="w-8 h-8" />
      <span className="text-xs">{t('video.toolbar.showPending')}</span>
      <GlassButton
        variant="primary"
        size="sm"
        onClick={() => {
          triggerPulse()
          onRegeneratePanelImage(panelId, candidateCount, false, panelGridSize)
        }}
      >
        {t('panel.generateImage')}
      </GlassButton>
      <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--glass-text-tertiary)]">
        <label className="flex items-center gap-1">
          <span>{t('image.panelGridSize')}</span>
          <select
            value={panelGridSize}
            onChange={(e) => setPanelGridSize(Number(e.target.value))}
            className="bg-transparent border border-[var(--glass-stroke-base)] rounded px-1 text-[10px]"
          >
            {getImageGenerationCountOptions('storyboard-grid').map((n) => (
              <option key={n} value={n} className="text-black">{n}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span>{t('image.candidateCountLabel')}</span>
          <select
            value={candidateCount}
            onChange={(e) => setCandidateCount(Number(e.target.value))}
            className="bg-transparent border border-[var(--glass-stroke-base)] rounded px-1 text-[10px]"
          >
            {getImageGenerationCountOptions('storyboard-candidates').map((n) => (
              <option key={n} value={n} className="text-black">{n}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )

  return (
    <div
      className={`relative overflow-hidden group rounded-t-2xl transition-all bg-[var(--glass-bg-muted)] ${isTaskPulseAnimating ? 'animate-brightness-boost' : ''}`}
      style={{ aspectRatio: cssAspectRatio }}
    >
      {isDeleting ? (
        renderLoadingState('process', imageUrl)
      ) : isModifying ? (
        renderLoadingState('modify', imageUrl)
      ) : isSubmittingPanelImageTask ? (
        renderLoadingState('regenerate', imageUrl)
      ) : candidateData ? (
        hasValidCandidates ? (
          <ImageSectionCandidateMode
            panelId={panelId}
            imageUrl={imageUrl}
            candidateData={candidateData}
            onSelectCandidateIndex={onSelectCandidateIndex}
            onConfirmCandidate={onConfirmCandidate}
            onCancelCandidate={onCancelCandidate}
            onPreviewImage={onPreviewImage}
          />
        ) : (
          renderLoadingState(imageUrl ? 'regenerate' : 'generate', imageUrl)
        )
      ) : failedError ? (
        renderFailedState()
      ) : imageUrl ? (
        <MediaImageWithLoading
          src={imageUrl}
          alt={t('variant.shotNum', { number: globalPanelNumber })}
          containerClassName="h-full w-full"
          className={`w-full h-full object-cover ${onPreviewImage ? 'cursor-zoom-in' : ''}`}
          onClick={onPreviewImage ? () => onPreviewImage(imageUrl) : undefined}
          title={onPreviewImage ? t('image.clickToPreview') : undefined}
          sizes="(max-width: 768px) 100vw, 33vw"
        />
      ) : (
        renderEmptyState()
      )}

      <div className="absolute top-2 left-2">
        <span className="glass-chip glass-chip-neutral px-2 py-0.5 text-xs font-medium">{globalPanelNumber}</span>
      </div>

      <div className="absolute top-2 right-2">
        <span className="glass-chip glass-chip-info px-2 py-0.5 text-xs">{shotType}</span>
      </div>

      {!candidateData && imageUrl && (
        <ImageSectionActionButtons
          panelId={panelId}
          imageUrl={imageUrl}
          previousImageUrl={previousImageUrl}
          isSubmittingPanelImageTask={isSubmittingPanelImageTask}
          isModifying={isModifying}
          onRegeneratePanelImage={onRegeneratePanelImage}
          onOpenEditModal={onOpenEditModal}
          onOpenAIDataModal={onOpenAIDataModal}
          onUndo={onUndo}
          onOpenHistory={historyCount > 0 ? () => setHistoryOpen(true) : undefined}
          historyCount={historyCount}
          triggerPulse={triggerPulse}
        />
      )}

      <PanelHistoryDrawer
        projectId={projectId}
        panelId={panelId}
        mediaType="image"
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
    </div>
  )
}
