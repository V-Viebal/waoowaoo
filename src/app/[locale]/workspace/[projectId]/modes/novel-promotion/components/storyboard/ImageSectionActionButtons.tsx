'use client'
import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import ImageGenerationInlineCountButton from '@/components/image-generation/ImageGenerationInlineCountButton'
import { getImageGenerationCountOptions, normalizeImageGenerationCount } from '@/lib/image-generation/count'
import { useImageGenerationCount } from '@/lib/image-generation/use-image-generation-count'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import { AI_EDIT_BUTTON_CLASS, AI_EDIT_ICON_CLASS } from '@/components/ui/ai-edit-style'
import AISparklesIcon from '@/components/ui/icons/AISparklesIcon'

interface ImageSectionActionButtonsProps {
  panelId: string
  imageUrl: string | null
  previousImageUrl?: string | null
  isSubmittingPanelImageTask: boolean
  isModifying: boolean
  onRegeneratePanelImage: (panelId: string, count?: number, force?: boolean, panelGridSize?: number) => void
  onOpenEditModal: () => void
  onOpenAIDataModal: () => void
  onUndo?: (panelId: string) => void
  onOpenHistory?: () => void
  historyCount?: number
  triggerPulse: () => void
}

export default function ImageSectionActionButtons({
  panelId,
  imageUrl,
  previousImageUrl,
  isSubmittingPanelImageTask,
  isModifying,
  onRegeneratePanelImage,
  onOpenEditModal,
  onOpenAIDataModal,
  onUndo,
  onOpenHistory,
  historyCount,
  triggerPulse,
}: ImageSectionActionButtonsProps) {
  const t = useTranslations('storyboard')
  const { count, setCount } = useImageGenerationCount('storyboard-candidates')
  // 分镜宫格数：读写项目级配置（所有镜头共享、与项目配置同源）
  const runtime = useWorkspaceStageRuntime()
  const panelGridSize = normalizeImageGenerationCount('storyboard-grid', runtime.panelGridSize)
  const setPanelGridSize = (value: number) => { void runtime.onPanelGridSizeChange(value) }

  return (
    <>
      <div className={`absolute bottom-1.5 left-1/2 -translate-x-1/2 z-20 transition-opacity ${isSubmittingPanelImageTask ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        <div className="relative glass-surface-modal border border-[var(--glass-stroke-base)] rounded-lg p-0.5">
          <div className="flex items-center gap-0.5">
            <ImageGenerationInlineCountButton
              prefix={
                <>
                  <AppIcon name="refresh" className="w-2.5 h-2.5" />
                  <span>{isSubmittingPanelImageTask ? t('image.forceRegenerate') : t('panel.regenerate')}</span>
                </>
              }
              suffix={<span>{t('image.generateCountSuffix')}</span>}
              value={count}
              options={getImageGenerationCountOptions('storyboard-candidates')}
              onValueChange={setCount}
              onClick={() => {
                _ulogInfo('[ImageSection] 🔄 左下角重新生成按钮被点击')
                _ulogInfo('[ImageSection] isSubmittingPanelImageTask:', isSubmittingPanelImageTask)
                _ulogInfo('[ImageSection] panelGridSize:', panelGridSize)
                triggerPulse()
                onRegeneratePanelImage(panelId, count, isSubmittingPanelImageTask, panelGridSize)
              }}
              disabled={false}
              ariaLabel={t('image.selectCount')}
              className={`glass-btn-base glass-btn-secondary flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] transition-all active:scale-95 ${isSubmittingPanelImageTask ? 'opacity-75' : ''}`}
              selectClassName="appearance-none bg-transparent border-0 pl-0 pr-3 text-[10px] font-semibold text-[var(--glass-text-primary)] outline-none cursor-pointer leading-none transition-colors"
              labelClassName="inline-flex items-center gap-0.5"
            />

            <div className="w-px h-3 bg-[var(--glass-stroke-base)]" />
            <label className="flex items-center gap-0.5 px-1.5 text-[10px] text-[var(--glass-text-secondary)]">
              <span>{t('image.panelGridSize')}</span>
              <select
                value={String(panelGridSize)}
                onChange={(e) => setPanelGridSize(Number(e.target.value))}
                aria-label={t('image.panelGridSize')}
                disabled={isSubmittingPanelImageTask}
                className="appearance-none bg-transparent border-0 pr-2 text-[10px] font-semibold text-[var(--glass-text-primary)] outline-none cursor-pointer"
              >
                {getImageGenerationCountOptions('storyboard-grid').map((n) => (
                  <option key={n} value={n} className="text-black">{n}</option>
                ))}
              </select>
            </label>

            <button
              onClick={onOpenAIDataModal}
              className={`glass-btn-base glass-btn-secondary flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] transition-all active:scale-95 ${isSubmittingPanelImageTask || isModifying ? 'opacity-75' : ''}`}
              title={t('aiData.viewData')}
            >
              <AppIcon name="chart" className="w-2.5 h-2.5" />
              <span>{t('aiData.viewData')}</span>
            </button>
            {imageUrl && (
              <button
                onClick={onOpenEditModal}
                className={`glass-btn-base h-6 w-6 rounded-full flex items-center justify-center transition-all active:scale-95 ${AI_EDIT_BUTTON_CLASS} ${isSubmittingPanelImageTask || isModifying ? 'opacity-75' : ''}`}
                title={t('image.editImage')}
              >
                <AISparklesIcon className={`w-2.5 h-2.5 ${AI_EDIT_ICON_CLASS}`} />
              </button>
            )}

            {previousImageUrl && onUndo && (
              <>
                <div className="w-px h-3 bg-[var(--glass-stroke-base)]" />
                <button
                  onClick={() => onUndo(panelId)}
                  disabled={isSubmittingPanelImageTask}
                  className="glass-btn-base glass-btn-secondary flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] transition-all active:scale-95 disabled:opacity-50"
                  title={t('assets.image.undo')}
                >
                  <span>{t('assets.image.undo')}</span>
                </button>
              </>
            )}

            {onOpenHistory && (
              <>
                <div className="w-px h-3 bg-[var(--glass-stroke-base)]" />
                <button
                  onClick={onOpenHistory}
                  className="glass-btn-base glass-btn-secondary relative flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] transition-all active:scale-95"
                  title="历史图片"
                >
                  <AppIcon name="clock" className="w-2.5 h-2.5" />
                  <span>历史</span>
                  {historyCount && historyCount > 0 ? (
                    <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-[var(--glass-tone-info-bg)] px-1 min-w-[14px] h-[14px] text-[9px] font-semibold text-[var(--glass-tone-info-fg)]">
                      {historyCount > 99 ? '99+' : historyCount}
                    </span>
                  ) : null}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
