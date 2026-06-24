'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useEditorStageDataLoader } from './editor-stage-runtime/useEditorStageDataLoader'
import { useEditorProjectSync } from './editor-stage-runtime/useEditorProjectSync'
import type { PanelVideoSource, TwickTimelineProject, VoiceLineSource } from '@/lib/twick/types'
import type { EditorProjectRecord, EditorProjectStatus } from './editor-stage-runtime/types'

interface EditorStageRuntimeContextValue {
  panelVideos: PanelVideoSource[]
  voiceLineSources: VoiceLineSource[]
  isLoadingData: boolean
  isFetchingData: boolean
  dataError: Error | null
  hasVideoPanels: boolean

  editorProjectId: string | null
  editorProjectRender: Pick<EditorProjectRecord, 'renderStatus' | 'renderTaskId' | 'renderOutputMediaObjectId' | 'renderSettings'> | null
  projectData: TwickTimelineProject | null
  projectVersion: number
  projectReloadRevision: number
  projectStatus: EditorProjectStatus
  isLoadingProject: boolean
  isSaving: boolean
  saveError: string | null
  hasConflict: boolean
  lastSavedAt: Date | null

  updateProjectData: (data: TwickTimelineProject) => void
  saveProject: () => void
  flushProjectSave: () => Promise<void>
  forceSave: () => void
  reloadProject: () => Promise<void>
  reloadAssets: () => Promise<void>
}

const EditorStageRuntimeContext = createContext<EditorStageRuntimeContextValue | null>(null)

export function useEditorStageRuntime() {
  const context = useContext(EditorStageRuntimeContext)
  if (!context) {
    throw new Error('useEditorStageRuntime must be used within EditorStageRuntimeProvider')
  }
  return context
}

interface EditorStageRuntimeProviderProps {
  projectId: string
  episodeId: string
  videoWidth: number
  videoHeight: number
  children: ReactNode
}

export function EditorStageRuntimeProvider({
  projectId,
  episodeId,
  videoWidth,
  videoHeight,
  children,
}: EditorStageRuntimeProviderProps) {
  const {
    panelVideos,
    voiceLineSources,
    isLoading: isLoadingData,
    isLoaded: isAssetDataLoaded,
    isFetching: isFetchingData,
    error: dataError,
    hasVideoPanels,
    refetch: reloadAssets,
  } = useEditorStageDataLoader(projectId, episodeId)

  const {
    id: editorProjectId,
    renderState: editorProjectRender,
    projectData,
    version: projectVersion,
    reloadRevision: projectReloadRevision,
    status: projectStatus,
    isLoading: isLoadingProject,
    isSaving,
    saveError,
    hasConflict,
    lastSavedAt,
    updateProjectData,
    saveNow: saveProject,
    flushProjectSave,
    forceSave,
    reloadFromServer: reloadProject,
  } = useEditorProjectSync({
    projectId,
    episodeId,
    panelVideos,
    voiceLineSources,
    isAssetDataLoaded,
    videoWidth,
    videoHeight,
  })

  const value = useMemo<EditorStageRuntimeContextValue>(() => ({
    panelVideos,
    voiceLineSources,
    isLoadingData,
    isFetchingData,
    dataError: dataError instanceof Error ? dataError : null,
    hasVideoPanels,
    editorProjectId,
    editorProjectRender,
    projectData,
    projectVersion,
    projectReloadRevision,
    projectStatus,
    isLoadingProject,
    isSaving,
    saveError,
    hasConflict,
    lastSavedAt,
    updateProjectData,
    saveProject,
    flushProjectSave,
    forceSave,
    reloadProject,
    reloadAssets,
  }), [
    dataError,
    editorProjectId,
    editorProjectRender,
    flushProjectSave,
    forceSave,
    hasConflict,
    hasVideoPanels,
    isFetchingData,
    isLoadingData,
    isLoadingProject,
    isSaving,
    lastSavedAt,
    panelVideos,
    projectData,
    projectReloadRevision,
    projectStatus,
    projectVersion,
    reloadAssets,
    reloadProject,
    saveError,
    saveProject,
    updateProjectData,
    voiceLineSources,
  ])

  return (
    <EditorStageRuntimeContext.Provider value={value}>
      {children}
    </EditorStageRuntimeContext.Provider>
  )
}
