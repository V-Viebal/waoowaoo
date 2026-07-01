'use client'

import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import VideoEditor, {
  DEFAULT_ELEMENT_COLORS,
  DEFAULT_TIMELINE_TICK_CONFIGS,
  DEFAULT_TIMELINE_ZOOM_CONFIG,
} from '@twick/video-editor'
import '@twick/video-editor/dist/video-editor.css'
import { LivePlayerProvider, PLAYER_STATE, useLivePlayerContext } from '@twick/live-player'
import { TimelineProvider, useTimelineContext } from '@twick/timeline'
import { useTranslations } from 'next-intl'
import { useEditorStageRuntime } from '@/lib/novel-promotion/stages/editor-stage-runtime-core'
import type { TwickTimelineProject } from '@/lib/twick/types'
import { AssetPanel } from './left-panel/AssetPanel'
import { RightPanel } from './right-panel/RightPanel'

/**
 * 捕获 Twick 编辑器内部的运行时错误，避免整个页面白屏
 */
class TwickErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('[TwickEditor] Caught error:', error.message, info.componentStack)
  }

  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

interface TwickEditorProps {
  videoWidth: number
  videoHeight: number
}

interface TimelineRuntimeSyncProps {
  onProjectChange: (data: TwickTimelineProject) => void
}

function TimelineRuntimeSync({ onProjectChange }: TimelineRuntimeSyncProps) {
  const { present } = useTimelineContext()
  const { playerState } = useLivePlayerContext()
  // ponytail: seed the diff key from Twick's first hydrated `present`, not from the
  // upstream projectData serialization. Twick normalizes key ordering / injects defaults,
  // so a plain JSON.stringify of the upstream data never matches the first present and
  // triggered a spurious autosave PUT on every load → version churn → full editor remount.
  const lastSyncedRef = useRef<string | null>(null)
  const pendingWhilePlayingRef = useRef<TwickTimelineProject | null>(null)

  useEffect(() => {
    if (!present) return

    const nextSerialized = JSON.stringify(present)
    if (lastSyncedRef.current === null) {
      lastSyncedRef.current = nextSerialized
      return
    }
    if (nextSerialized === lastSyncedRef.current) return

    // ponytail: during playback Twick pushes a fresh `present` on every animation tick.
    // Feeding those back up as project edits caused React re-renders per frame → the
    // <video> element was thrashed and playback flickered / went black. Defer sync while
    // playing; flush the latest snapshot when playback stops.
    if (playerState === PLAYER_STATE.PLAYING) {
      pendingWhilePlayingRef.current = present as TwickTimelineProject
      return
    }

    lastSyncedRef.current = nextSerialized
    pendingWhilePlayingRef.current = null
    onProjectChange(present as TwickTimelineProject)
  }, [onProjectChange, playerState, present])

  useEffect(() => {
    if (playerState === PLAYER_STATE.PLAYING) return
    const pending = pendingWhilePlayingRef.current
    if (!pending) return
    pendingWhilePlayingRef.current = null
    lastSyncedRef.current = JSON.stringify(pending)
    onProjectChange(pending)
  }, [onProjectChange, playerState])

  return null
}

export function TwickEditor({ videoWidth, videoHeight }: TwickEditorProps) {
  const t = useTranslations('novelPromotion.editor')
  const {
    editorProjectId,
    projectData,
    projectReloadRevision,
    isLoadingData,
    isLoadingProject,
    dataError,
    saveError,
    updateProjectData,
  } = useEditorStageRuntime()

  // ponytail: key on the reload revision (increments only on explicit reloadFromServer),
  // NOT on projectVersion — the latter bumps on every save and would unmount everything.
  const timelineKey = `${editorProjectId ?? 'new'}-${projectReloadRevision}-${videoWidth}x${videoHeight}`

  // ponytail: TimelineProvider's `initialData` is only meaningful at mount / key change.
  // Passing a new projectData reference on every edit made Twick re-hydrate its internal
  // state → the video element re-mounts → black frame / flicker. Snapshot the current
  // projectData for the lifetime of this timelineKey.
  const [initialDataSnapshot, setInitialDataSnapshot] = useState<TwickTimelineProject | null>(projectData ?? null)
  const currentKeyRef = useRef(timelineKey)
  if (currentKeyRef.current !== timelineKey) {
    currentKeyRef.current = timelineKey
    setInitialDataSnapshot(projectData ?? null)
  }
  useEffect(() => {
    if (initialDataSnapshot === null && projectData) {
      setInitialDataSnapshot(projectData)
    }
  }, [initialDataSnapshot, projectData])

  // ponytail: memoize the config trees so VideoEditor sees stable references. Without
  // this, every TwickEditor re-render (status flip / autosave / present sync) produced
  // fresh objects and VideoEditor's internal player treated it as a config change → the
  // <video> element remounted mid-playback → black frame / flicker.
  const backgroundColor = initialDataSnapshot?.backgroundColor || projectData?.backgroundColor || '#ffffff'
  const videoProps = useMemo(() => ({
    width: videoWidth,
    height: videoHeight,
    backgroundColor,
  }), [backgroundColor, videoHeight, videoWidth])
  const playerProps = useMemo(() => ({ maxWidth: 480, maxHeight: 620 }), [])
  const editorConfig = useMemo(() => ({
    videoProps,
    canvasMode: true,
    playerProps,
    timelineTickConfigs: DEFAULT_TIMELINE_TICK_CONFIGS,
    timelineZoomConfig: DEFAULT_TIMELINE_ZOOM_CONFIG,
    elementColors: DEFAULT_ELEMENT_COLORS,
  }), [playerProps, videoProps])

  // ponytail: same reason — inline React elements are new every render.
  const leftPanel = useMemo(() => <AssetPanel />, [])
  const rightPanel = useMemo(() => <RightPanel />, [])

  // ponytail: Chrome blocks autoplay without a user gesture — Twick tries to .play() the
  // <video> on mount so the first frame paints, and the block leaves a black canvas.
  // Force-mute every <video> in the editor subtree until the user interacts (any
  // pointerdown/keydown counts as a gesture), which satisfies the autoplay policy.
  // After the first gesture we clear the mute so audio plays normally.
  const editorHostRef = useRef<HTMLDivElement | null>(null)
  const [hasUserGesture, setHasUserGesture] = useState(false)
  useEffect(() => {
    if (hasUserGesture) return
    const host = editorHostRef.current
    if (!host) return

    const forceMute = () => {
      host.querySelectorAll('video').forEach((video) => {
        if (!video.muted) video.muted = true
      })
    }
    forceMute()
    const observer = new MutationObserver(forceMute)
    observer.observe(host, { childList: true, subtree: true })

    const markGesture = () => setHasUserGesture(true)
    window.addEventListener('pointerdown', markGesture, { once: true, capture: true })
    window.addEventListener('keydown', markGesture, { once: true, capture: true })

    return () => {
      observer.disconnect()
      window.removeEventListener('pointerdown', markGesture, { capture: true } as AddEventListenerOptions)
      window.removeEventListener('keydown', markGesture, { capture: true } as AddEventListenerOptions)
    }
  }, [hasUserGesture])

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
    <TwickErrorBoundary
      fallback={
        <div className="flex h-full w-full items-center justify-center bg-slate-950/5 p-6 text-center text-sm text-[var(--glass-text-secondary)]">
          <div>
            <div className="font-medium text-[var(--glass-text-primary)]">{t('errorBoundaryTitle')}</div>
            <div className="mt-2 max-w-md text-xs leading-5">
              {t('errorBoundaryDescription')}
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-xl bg-[var(--glass-accent-from)] px-4 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--glass-accent-to)]"
            >
              {t('errorBoundaryReload')}
            </button>
          </div>
        </div>
      }
    >
      <div ref={editorHostRef} className="flex h-full w-full flex-col">
      <LivePlayerProvider>
        <TimelineProvider
          key={timelineKey}
          contextId={`editor-stage-${timelineKey}`}
          initialData={initialDataSnapshot ?? projectData}
          resolution={{ width: videoWidth, height: videoHeight }}
          analytics={{ enabled: false }}
        >
          <TimelineRuntimeSync onProjectChange={updateProjectData} />
          <VideoEditor
            leftPanel={leftPanel}
            rightPanel={rightPanel}
            defaultPlayControls
            editorConfig={editorConfig}
          />
          {saveError ? <span className="sr-only">{saveError}</span> : null}
        </TimelineProvider>
      </LivePlayerProvider>
      </div>
    </TwickErrorBoundary>
  )
}
