'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { GlassButton } from '@/components/ui/primitives'
import { AppIcon } from '@/components/ui/icons'
import { STORYBOARD_GRID_PRESETS, type StoryboardGridPreset } from '@/lib/storyboard-images/grid'

interface StoryboardGroupActionsProps {
  hasAnyImage: boolean
  isSubmittingStoryboardTask: boolean
  isSubmittingStoryboardTextTask: boolean
  currentRunningCount: number
  pendingCount: number
  panelCount: number
  gridPreset: StoryboardGridPreset
  isCompositingStoryboardImage: boolean
  canCompositeStoryboardImage: boolean
  onRegenerateText: () => void
  onGenerateAllIndividually: () => void
  onGridPresetChange: (preset: StoryboardGridPreset) => void
  onCreateAiStoryboardImage: () => void
  onCreateCompositedStoryboardImage: () => void
  onAddPanel: () => void
  onDeleteStoryboard: () => void
}

const GRID_OPTIONS: Array<{ value: StoryboardGridPreset; capacity: number | null; labelKey: string }> = [
  { value: STORYBOARD_GRID_PRESETS.GRID_3, capacity: 3, labelKey: 'storyboardImage.grid3' },
  { value: STORYBOARD_GRID_PRESETS.GRID_6, capacity: 6, labelKey: 'storyboardImage.grid6' },
  { value: STORYBOARD_GRID_PRESETS.GRID_9, capacity: 9, labelKey: 'storyboardImage.grid9' },
  { value: STORYBOARD_GRID_PRESETS.GRID_AUTO, capacity: null, labelKey: 'storyboardImage.gridAuto' },
]

export default function StoryboardGroupActions({
  hasAnyImage,
  isSubmittingStoryboardTask,
  isSubmittingStoryboardTextTask,
  currentRunningCount,
  pendingCount,
  panelCount,
  gridPreset,
  isCompositingStoryboardImage,
  canCompositeStoryboardImage,
  onRegenerateText,
  onGenerateAllIndividually,
  onGridPresetChange,
  onCreateAiStoryboardImage,
  onCreateCompositedStoryboardImage,
  onAddPanel,
  onDeleteStoryboard,
}: StoryboardGroupActionsProps) {
  const t = useTranslations('storyboard')

  const textTaskRunningState = useMemo(() => {
    if (!isSubmittingStoryboardTextTask) return null
    return resolveTaskPresentationState({
      phase: 'processing',
      intent: 'regenerate',
      resource: 'text',
      hasOutput: true,
    })
  }, [isSubmittingStoryboardTextTask])

  const panelTaskRunningState = useMemo(() => {
    if (currentRunningCount <= 0) return null
    return resolveTaskPresentationState({
      phase: 'processing',
      intent: hasAnyImage ? 'regenerate' : 'generate',
      resource: 'image',
      hasOutput: hasAnyImage,
    })
  }, [currentRunningCount, hasAnyImage])

  const compositingState = useMemo(() => {
    if (!isCompositingStoryboardImage) return null
    return resolveTaskPresentationState({
      phase: 'processing',
      intent: hasAnyImage ? 'regenerate' : 'generate',
      resource: 'image',
      hasOutput: hasAnyImage,
    })
  }, [hasAnyImage, isCompositingStoryboardImage])

  const storyboardImageTaskState = useMemo(() => {
    if (!isSubmittingStoryboardTask || isSubmittingStoryboardTextTask) return null
    return resolveTaskPresentationState({
      phase: 'processing',
      intent: hasAnyImage ? 'regenerate' : 'generate',
      resource: 'image',
      hasOutput: hasAnyImage,
    })
  }, [hasAnyImage, isSubmittingStoryboardTask, isSubmittingStoryboardTextTask])

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <GlassButton
        variant="secondary"
        size="sm"
        onClick={onRegenerateText}
        disabled={isSubmittingStoryboardTextTask}
      >
        {isSubmittingStoryboardTextTask ? (
          <TaskStatusInline state={textTaskRunningState} />
        ) : (
          <>
            <AppIcon name="refresh" className="h-3 w-3" />
            <span>{t('group.regenerateText')}</span>
          </>
        )}
      </GlassButton>

      {pendingCount > 0 && (
        <GlassButton
          variant="primary"
          size="sm"
          onClick={onGenerateAllIndividually}
          disabled={currentRunningCount > 0}
          title={t('group.generateMissingImages')}
        >
          {currentRunningCount > 0 ? (
            <TaskStatusInline state={panelTaskRunningState} />
          ) : (
            <>
              <AppIcon name="plus" className="h-3 w-3" />
              <span>{t('group.generateAll')}</span>
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-white/25 text-white">{pendingCount}</span>
            </>
          )}
        </GlassButton>
      )}

      <div className="flex items-center gap-1">
        <select
          value={gridPreset}
          onChange={(event) => onGridPresetChange(event.target.value as StoryboardGridPreset)}
          className="h-8 rounded-lg border border-[var(--glass-border-subtle)] bg-[var(--glass-bg-surface)] px-2 text-xs text-[var(--glass-text-primary)] outline-none"
          disabled={isCompositingStoryboardImage}
          aria-label={t('storyboardImage.gridPreset')}
          title={t('storyboardImage.gridPreset')}
        >
          {GRID_OPTIONS.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.capacity !== null && panelCount > option.capacity}
            >
              {t(option.labelKey)}
            </option>
          ))}
        </select>
        <GlassButton
          variant="primary"
          size="sm"
          onClick={onCreateAiStoryboardImage}
          disabled={panelCount <= 0 || isSubmittingStoryboardTask || isCompositingStoryboardImage}
          title={t('storyboardImage.aiGenerate')}
        >
          {storyboardImageTaskState ? (
            <TaskStatusInline state={storyboardImageTaskState} />
          ) : (
            <>
              <AppIcon name="sparkles" className="h-3.5 w-3.5" />
              <span>{t('storyboardImage.aiGenerate')}</span>
            </>
          )}
        </GlassButton>
        <GlassButton
          variant="secondary"
          size="sm"
          onClick={onCreateCompositedStoryboardImage}
          disabled={!canCompositeStoryboardImage || isCompositingStoryboardImage || isSubmittingStoryboardTextTask || isSubmittingStoryboardTask}
          title={canCompositeStoryboardImage ? t('storyboardImage.compose') : t('storyboardImage.missingPanelImages')}
        >
          {isCompositingStoryboardImage ? (
            <TaskStatusInline state={compositingState} />
          ) : (
            <>
              <AppIcon name="image" className="h-3.5 w-3.5" />
              <span>{t('storyboardImage.compose')}</span>
            </>
          )}
        </GlassButton>
      </div>

      <GlassButton
        variant="secondary"
        size="sm"
        onClick={onAddPanel}
      >
        <AppIcon name="plusMd" className="h-3.5 w-3.5" />
        <span>{t('group.addPanel')}</span>
      </GlassButton>

      <GlassButton
        variant="danger"
        size="sm"
        onClick={onDeleteStoryboard}
        disabled={isSubmittingStoryboardTask}
        title={t('common.delete')}
      >
        <AppIcon name="trashAlt" className="h-3.5 w-3.5" />
        <span>{t('common.delete')}</span>
      </GlassButton>
    </div>
  )
}
