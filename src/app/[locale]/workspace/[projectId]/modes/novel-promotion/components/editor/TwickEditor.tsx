'use client'

import { useEffect, useMemo, useRef } from 'react'
import VideoEditor, {
  DEFAULT_ELEMENT_COLORS,
  DEFAULT_TIMELINE_TICK_CONFIGS,
  DEFAULT_TIMELINE_ZOOM_CONFIG,
} from '@twick/video-editor'
import '@twick/video-editor/dist/video-editor.css'
import '@twick/timeline/dist/timeline.css'
import { LivePlayerProvider } from '@twick/live-player'
import { TimelineProvider, useTimelineContext } from '@twick/timeline'
import { useTranslations } from 'next-intl'
import { useEditorStageRuntime } from '@/lib/novel-promotion/stages/editor-stage-runtime-core'
import type { TwickTimelineProject } from '@/lib/twick/types'
import { AssetPanel } from './left-panel/AssetPanel'
import { RightPanel } from './right-panel/RightPanel'

interface TwickEditorProps {
  videoWidth: number
  videoHeight: number
}

interface TimelineRuntimeSyncProps {
  initialSerialized: string
  onProjectChange: (data: TwickTimelineProject) => void
}

function TimelineRuntimeSync({ initialSerialized, onProjectChange }: TimelineRuntimeSyncProps) {
  const { present } = useTimelineContext()
  const lastSyncedRef = useRef(initialSerialized)

  useEffect(() => {
    lastSyncedRef.current = initialSerialized
  }, [initialSerialized])

  useEffect(() => {
    if (!present) return

    const nextSerialized = JSON.stringify(present)
    if (nextSerialized === lastSyncedRef.current) return

    lastSyncedRef.current = nextSerialized
    onProjectChange(present as TwickTimelineProject)
  }, [onProjectChange, present])

  return null
}

export function TwickEditor({ videoWidth, videoHeight }: TwickEditorProps) {
  const t = useTranslations('novelPromotion.editor')
  const {
    editorProjectId,
    projectData,
    projectVersion,
    projectReloadRevision,
    isLoadingData,
    isLoadingProject,
    dataError,
    saveError,
    updateProjectData,
  } = useEditorStageRuntime()

  const initialSerialized = useMemo(() => JSON.stringify(projectData), [projectData])
  const timelineKey = `${editorProjectId ?? 'new'}-${projectVersion}-${projectReloadRevision}-${videoWidth}x${videoHeight}`

  if (isLoadingData || isLoadingProject) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-950/5 text-sm text-[var(--glass-text-secondary)]">
        {t('loading')}
      </div>
    )
  }

  if (dataError || !projectData) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-950/5 p-6 text-center text-sm text-[var(--glass-text-secondary)]">
        <div>
          <div className="font-medium text-[var(--glass-text-primary)]">{t('emptyTitle')}</div>
          <div className="mt-2 max-w-md text-xs leading-5">
            {dataError ? dataError.message : t('emptyDescription')}
          </div>
        </div>
      </div>
    )
  }

  return (
    <LivePlayerProvider>
      <TimelineProvider
        key={timelineKey}
        contextId={`editor-stage-${timelineKey}`}
        initialData={projectData}
        resolution={{ width: videoWidth, height: videoHeight }}
        analytics={{ enabled: false }}
      >
        <TimelineRuntimeSync initialSerialized={initialSerialized} onProjectChange={updateProjectData} />
        <VideoEditor
          leftPanel={<AssetPanel />}
          rightPanel={<RightPanel />}
          defaultPlayControls
          editorConfig={{
            videoProps: {
              width: videoWidth,
              height: videoHeight,
              backgroundColor: projectData.backgroundColor || '#ffffff',
            },
            canvasMode: true,
            playerProps: {
              maxWidth: 480,
              maxHeight: 620,
            },
            timelineTickConfigs: DEFAULT_TIMELINE_TICK_CONFIGS,
            timelineZoomConfig: DEFAULT_TIMELINE_ZOOM_CONFIG,
            elementColors: DEFAULT_ELEMENT_COLORS,
          }}
        />
        {saveError ? <span className="sr-only">{saveError}</span> : null}
      </TimelineProvider>
    </LivePlayerProvider>
  )
}
