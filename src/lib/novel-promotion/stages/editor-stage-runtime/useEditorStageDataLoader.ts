'use client'

import { useMemo } from 'react'
import { useStoryboards } from '@/lib/query/hooks/useStoryboards'
import { useMatchedVoiceLines } from '@/lib/query/hooks/useVoiceLines'
import type { PanelVideoSource, VoiceLineSource } from '@/lib/twick/types'
import type { EditorStoryboardData } from './types'

const DEFAULT_PANEL_DURATION_SECONDS = 3
const DEFAULT_VOICE_DURATION_SECONDS = 2

interface EditorVoiceLineMediaRef {
  id?: string | null
  durationMs?: number | null
}

interface EditorVoiceLineSourceRecord {
  id: string
  speaker: string
  content: string
  audioUrl: string | null
  audioDuration?: number | null
  audioMedia?: EditorVoiceLineMediaRef | null
  media?: EditorVoiceLineMediaRef | null
  [key: string]: unknown
}

interface EditorVoiceLinesPayload {
  voiceLines?: EditorVoiceLineSourceRecord[]
}

function durationMsToSeconds(durationMs: number | null | undefined, fallbackSeconds: number): number {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    return fallbackSeconds
  }
  return durationMs / 1000
}

export function mapStoryboardsToPanelVideos(
  storyboards: EditorStoryboardData | null | undefined,
): PanelVideoSource[] {
  if (!storyboards?.groups) return []

  const panelVideos: PanelVideoSource[] = []
  for (const group of storyboards.groups) {
    for (const panel of group.panels ?? []) {
      const videoMediaObjectId = panel.videoMedia?.id
      if (!videoMediaObjectId) continue

      panelVideos.push({
        panelId: panel.id,
        storyboardId: group.id,
        videoMediaObjectId,
        duration: durationMsToSeconds(panel.videoMedia?.durationMs, DEFAULT_PANEL_DURATION_SECONDS),
        description: panel.motionPrompt || panel.voiceText || undefined,
      })
    }
  }

  return panelVideos
}

export function mapVoiceLinesToSources(
  voiceLines: EditorVoiceLinesPayload | null | undefined,
): VoiceLineSource[] {
  if (!voiceLines?.voiceLines) return []

  const sources: VoiceLineSource[] = []
  for (const line of voiceLines.voiceLines) {
    const audioMediaObjectId = line.audioMedia?.id || line.media?.id
    if (!audioMediaObjectId) continue

    sources.push({
      voiceLineId: line.id,
      audioMediaObjectId,
      duration: durationMsToSeconds(
        line.audioDuration,
        durationMsToSeconds(line.audioMedia?.durationMs || line.media?.durationMs, DEFAULT_VOICE_DURATION_SECONDS),
      ),
      text: line.content || '',
      speaker: line.speaker || undefined,
    })
  }

  return sources
}

/**
 * Load generated storyboard videos and matched voice lines, then project them into
 * flat source arrays consumed by the Twick project builder.
 */
export function useEditorStageDataLoader(projectId: string | null, episodeId: string | null) {
  const storyboardsQuery = useStoryboards(episodeId)
  const matchedVoiceLinesQuery = useMatchedVoiceLines(projectId, episodeId)

  const panelVideos = useMemo(
    () => mapStoryboardsToPanelVideos(storyboardsQuery.data),
    [storyboardsQuery.data],
  )

  const voiceLineSources = useMemo(
    () => mapVoiceLinesToSources(matchedVoiceLinesQuery.data as EditorVoiceLinesPayload | undefined),
    [matchedVoiceLinesQuery.data],
  )

  const isLoading = storyboardsQuery.isLoading || matchedVoiceLinesQuery.isLoading

  return {
    panelVideos,
    voiceLineSources,
    isLoading,
    isLoaded: !isLoading,
    isFetching: storyboardsQuery.isFetching || matchedVoiceLinesQuery.isFetching,
    error: storyboardsQuery.error || matchedVoiceLinesQuery.error,
    hasVideoPanels: panelVideos.length > 0,
    refetch: async () => {
      await Promise.all([
        storyboardsQuery.refetch(),
        matchedVoiceLinesQuery.refetch(),
      ])
    },
  }
}
