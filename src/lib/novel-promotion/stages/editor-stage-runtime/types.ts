'use client'

import type { TwickTimelineProject } from '@/lib/twick/types'
import type { StoryboardData } from '@/lib/query/hooks/useStoryboards'
import type { MatchedVoiceLinesData } from '@/lib/query/hooks/useVoiceLines'

export interface EditorProjectState {
  id: string | null
  projectData: TwickTimelineProject | null
  version: number
  isLoading: boolean
  isSaving: boolean
  saveError: string | null
  hasConflict: boolean
  lastSavedAt: Date | null
}

export type EditorProjectStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error' | 'conflict'

export interface EditorProjectRecord {
  id: string | null
  episodeId?: string
  projectData: TwickTimelineProject | null
  version: number
  renderStatus?: string | null
  renderTaskId?: string | null
  renderOutputMediaObjectId?: string | null
  renderSettings?: Record<string, unknown> | null
  outputUrl?: string | null
  updatedAt?: string | null
}

export interface EditorProjectSaveResult {
  id: string | null
  version: number
  updatedAt?: string | null
}

export interface EditorConflictError extends Error {
  code: 'CONFLICT'
  currentVersion?: number
}

export type EditorStoryboardData = StoryboardData
export type EditorVoiceLinesData = MatchedVoiceLinesData
