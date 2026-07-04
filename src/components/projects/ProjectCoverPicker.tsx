'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import TaskStatusOverlay from '@/components/task/TaskStatusOverlay'
import type { MediaRef } from '@/lib/media/types'
import type { TaskPresentationState } from '@/lib/task/presentation'

type CoverRatio = '1:1' | '16:9' | '9:16'

export interface ProjectCoverPickerProps {
  projectId?: string
  coverMedia?: MediaRef | null
  ratio: CoverRatio
  disabled?: boolean
  canGenerate?: boolean
  canEdit: boolean
  onPickUpload: (file: File) => Promise<void> | void
  onTriggerGenerate: () => void
  onRemove: () => void
  onRatioChange: (r: CoverRatio) => void
  taskPresentation?: TaskPresentationState | null
}

const RATIO_CLASS: Record<CoverRatio, string> = {
  '1:1': 'aspect-square',
  '16:9': 'aspect-video',
  '9:16': 'aspect-[9/16] max-w-[200px] mx-auto',
}

const RATIO_OPTIONS: Array<{ value: CoverRatio; labelKey: string }> = [
  { value: '1:1', labelKey: 'cover.ratio1to1' },
  { value: '16:9', labelKey: 'cover.ratio16to9' },
  { value: '9:16', labelKey: 'cover.ratio9to16' },
]

export default function ProjectCoverPicker({
  coverMedia,
  ratio,
  disabled = false,
  canGenerate = true,
  canEdit,
  onPickUpload,
  onTriggerGenerate,
  onRemove,
  onRatioChange,
  taskPresentation,
}: ProjectCoverPickerProps) {
  const t = useTranslations('workspace')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const phase = taskPresentation?.phase
  const isTaskRunning = phase === 'queued' || phase === 'processing'
  const isBusy = disabled || uploading || isTaskRunning
  const aspectClass = RATIO_CLASS[ratio]

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await onPickUpload(file)
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="glass-field-label">{t('cover.title')}</label>
        {canEdit && coverMedia && !isBusy && (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-[var(--glass-text-secondary)] hover:text-[var(--glass-tone-danger-fg)]"
          >
            {t('cover.remove')}
          </button>
        )}
      </div>

      <div
        className={`relative overflow-hidden rounded-lg border-2 border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] ${aspectClass}`}
      >
        {coverMedia?.url ? (
          <MediaImageWithLoading
            src={coverMedia.url}
            alt={t('cover.title')}
            fill
            sizes="280px"
            className="object-cover"
          />
        ) : uploading ? (
          <div className="flex h-full w-full items-center justify-center text-[var(--glass-text-secondary)]">
            <AppIcon name="loader" className="w-6 h-6 animate-spin mr-2" />
            <span className="text-xs">{t('cover.uploading')}</span>
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-[var(--glass-text-tertiary)]">
            <AppIcon name="image" className="w-10 h-10" />
            <span className="text-xs">{t('cover.addCover')}</span>
          </div>
        )}

        {taskPresentation && isTaskRunning && (
          <TaskStatusOverlay state={taskPresentation} />
        )}

        {taskPresentation?.phase === 'failed' && (
          <div className="absolute inset-x-2 bottom-2 rounded-md bg-red-500/90 px-2 py-1 text-white text-xs flex items-center justify-between">
            <span>{t('cover.generateFailed')}</span>
            <button
              type="button"
              onClick={onTriggerGenerate}
              className="underline ml-2"
            >
              {t('cover.retry')}
            </button>
          </div>
        )}
      </div>

      {canEdit && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--glass-text-secondary)]">{t('cover.ratio')}:</span>
          {RATIO_OPTIONS.map((option) => {
            const isSelected = option.value === ratio
            return (
              <button
                key={option.value}
                type="button"
                disabled={isBusy}
                onClick={() => onRatioChange(option.value)}
                className={`px-2 py-1 rounded text-xs transition-colors disabled:opacity-50 ${
                  isSelected
                    ? 'bg-[var(--glass-accent-from)] text-white'
                    : 'bg-[var(--glass-bg-surface)] text-[var(--glass-text-secondary)] hover:text-white'
                }`}
              >
                {t(option.labelKey)}
              </button>
            )
          })}
        </div>
      )}

      {canEdit && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={isBusy || !canGenerate}
            onClick={onTriggerGenerate}
            title={!canGenerate ? t('cover.descriptionEmpty') : undefined}
            className="glass-btn-base glass-btn-primary px-3 py-1.5 text-xs flex-1 disabled:opacity-50"
          >
            <AppIcon name="sparkles" className="w-3.5 h-3.5 inline mr-1" />
            {t('cover.aiGenerate')}
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => fileInputRef.current?.click()}
            className="glass-btn-base glass-btn-secondary px-3 py-1.5 text-xs flex-1 disabled:opacity-50"
          >
            <AppIcon name="upload" className="w-3.5 h-3.5 inline mr-1" />
            {t('cover.upload')}
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {canEdit && canGenerate && (
        <p className="text-[11px] text-[var(--glass-text-tertiary)] leading-relaxed">
          {t('cover.generatingHint')}
        </p>
      )}
    </div>
  )
}
