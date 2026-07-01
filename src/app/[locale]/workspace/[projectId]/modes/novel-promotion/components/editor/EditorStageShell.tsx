'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useEditorStageRuntime } from '@/lib/novel-promotion/stages/editor-stage-runtime-core'
import { useEditorExport } from '@/lib/novel-promotion/stages/editor-stage-runtime/useEditorExport'
import { AssetPanel } from './left-panel/AssetPanel'
import { ExportPanel } from './ExportPanel'
import { RightPanel } from './right-panel/RightPanel'
import { SaveStatusIndicator } from './SaveStatusIndicator'
import { TwickEditor } from './TwickEditor'
import { useWorkspaceProvider } from '../../WorkspaceProvider'

interface EditorStageShellProps {
  videoWidth: number
  videoHeight: number
}

/**
 * 抑制来自 Twick 编辑器内部的可预期错误(如元素在挂载/卸载时的 null 引用)
 * 只做 console 静音,不阻止事件传播 —— 否则会屏蔽全站的真实错误监控。
 */
function useSuppressTwickErrors() {
  useEffect(() => {
    const suppressedPatterns = [
      'Cannot read properties of null',
      'Cannot read properties of undefined',
      'ELEMENT_NOT_ADDED',
      'getBoundingClientRect',
    ]

    const suppress = (event: PromiseRejectionEvent | ErrorEvent) => {
      const message = 'reason' in event
        ? (event.reason?.message || event.reason?.toString() || '')
        : (event.error?.message || event.message || '')

      if (suppressedPatterns.some(pattern => String(message).includes(pattern))) {
        // ponytail: don't preventDefault — that hides everything from Sentry / DevTools
        // globally, not just Twick. Stop propagation only.
        event.stopImmediatePropagation?.()
      }
    }

    window.addEventListener('unhandledrejection', suppress)
    window.addEventListener('error', suppress)
    return () => {
      window.removeEventListener('unhandledrejection', suppress)
      window.removeEventListener('error', suppress)
    }
  }, [])
}

export function EditorStageShell({ videoWidth, videoHeight }: EditorStageShellProps) {
  const t = useTranslations('novelPromotion.editor')
  const exportT = useTranslations('novelPromotion.editor.export')
  const { projectId, episodeId, subscribeTaskEvents } = useWorkspaceProvider()
  const { editorProjectId, editorProjectRender, isLoadingData, isLoadingProject, flushProjectSave } = useEditorStageRuntime()
  const [isExportPanelOpen, setIsExportPanelOpen] = useState(false)

  useSuppressTwickErrors()

  const exportRuntime = useEditorExport({
    projectId,
    episodeId: episodeId || null,
    editorProjectId,
    flushProjectSave,
    subscribeTaskEvents,
    initialRenderState: editorProjectRender,
    t: (key) => exportT(key as never),
  })

  const exportDisabledReason = useMemo(() => {
    if (!episodeId || !editorProjectId) return exportT('missingContext')
    if (isLoadingData || isLoadingProject) return exportT('loading')
    return null
  }, [editorProjectId, episodeId, exportT, isLoadingData, isLoadingProject])

  return (
    <div className="relative flex h-[calc(100vh-220px)] min-h-[720px] w-full flex-col overflow-hidden rounded-3xl border border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-xl backdrop-blur-xl">
      <div className="flex h-14 flex-shrink-0 items-center justify-between gap-3 border-b border-[var(--glass-border)] bg-gradient-to-r from-white/60 via-white/40 to-white/60 px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--glass-accent-from)] to-[var(--glass-accent-to)] text-white shadow-md">
            <AppIcon name="clapperboard" className="h-4 w-4" strokeWidth={2.2} aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[var(--glass-text-primary)]">{t('title')}</div>
            <div className="truncate text-[11px] text-[var(--glass-text-tertiary)]">
              {t('subtitle', { width: videoWidth, height: videoHeight })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <SaveStatusIndicator />
          <button
            type="button"
            onClick={() => setIsExportPanelOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[var(--glass-accent-from)] to-[var(--glass-accent-to)] px-4 py-2 text-xs font-medium text-white shadow-md transition hover:shadow-lg hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent-from)]/60"
          >
            <AppIcon name="download" className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden />
            {t('export.openButton')}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <TwickEditor videoWidth={videoWidth} videoHeight={videoHeight} />
      </div>

      {isExportPanelOpen ? (
        <ExportPanel
          exportRuntime={exportRuntime}
          disabledReason={exportDisabledReason}
          onClose={() => setIsExportPanelOpen(false)}
        />
      ) : null}
    </div>
  )
}

export function EditorLeftPanel() {
  return <AssetPanel />
}

export function EditorRightPanel() {
  return <RightPanel />
}
