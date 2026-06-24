'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
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

export function EditorStageShell({ videoWidth, videoHeight }: EditorStageShellProps) {
  const t = useTranslations('novelPromotion.editor')
  const exportT = useTranslations('novelPromotion.editor.export')
  const { projectId, episodeId, subscribeTaskEvents } = useWorkspaceProvider()
  const { editorProjectId, editorProjectRender, isLoadingData, isLoadingProject, flushProjectSave } = useEditorStageRuntime()
  const [isExportPanelOpen, setIsExportPanelOpen] = useState(false)

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
      <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-[var(--glass-border)] px-4">
        <div>
          <div className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('title')}</div>
          <div className="text-[11px] text-[var(--glass-text-tertiary)]">
            {t('subtitle', { width: videoWidth, height: videoHeight })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SaveStatusIndicator />
          <button
            type="button"
            onClick={() => setIsExportPanelOpen(true)}
            className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700"
          >
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
