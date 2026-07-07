'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { queryKeys } from '../keys'
import {
  invalidateQueryTemplates,
  requestJsonWithError,
} from '../mutations/mutation-shared'

export type HistoryItem = {
  url: string
  publicUrl: string
  timestamp: string
  mimeType: string | null
  sizeBytes: number | null
}

export type PanelHistoryMediaType = 'image' | 'video'

export function usePanelHistory(
  projectId: string,
  panelId: string,
  mediaType: PanelHistoryMediaType,
  open: boolean,
) {
  return useQuery<{ items: HistoryItem[] }>({
    queryKey: queryKeys.panelHistory.list(projectId, panelId, mediaType),
    queryFn: async () => {
      const response = await apiFetch(
        `/api/novel-promotion/${projectId}/panel/${panelId}/history?type=${mediaType}`,
      )
      if (!response.ok) {
        throw new Error(`Failed to load history: ${response.status}`)
      }
      return (await response.json()) as { items: HistoryItem[] }
    },
    enabled: open,
    staleTime: 30_000,
  })
}

export function usePanelHistoryActions(projectId: string) {
  const queryClient = useQueryClient()
  const invalidateForPanel = (panelId: string) =>
    Promise.all([
      invalidateQueryTemplates(queryClient, [
        queryKeys.projectAssets.all(projectId),
        queryKeys.projectData(projectId),
      ]),
      // Invalidate both media-type history keys for this panel
      queryClient.invalidateQueries({ queryKey: ['panel-history', projectId, panelId] }),
    ])

  const useVersion = useMutation({
    mutationFn: async ({
      panelId,
      mediaType,
      url,
    }: {
      panelId: string
      mediaType: PanelHistoryMediaType
      url: string
    }) =>
      await requestJsonWithError(
        `/api/novel-promotion/${projectId}/panel/${panelId}/history-use`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaType, url }),
        },
        'Failed to restore version',
      ),
    onSuccess: (_data, variables) => invalidateForPanel(variables.panelId),
  })

  const downloadZip = async (
    panelId: string,
    mediaType: PanelHistoryMediaType,
  ) => {
    try {
      const response = await apiFetch(
        `/api/novel-promotion/${projectId}/panel/${panelId}/history-zip?type=${mediaType}`,
      )
      if (!response.ok) {
        throw new Error(`Failed to download zip: ${response.status}`)
      }
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = `panel-${mediaType}-history.zip`
      document.body.appendChild(anchor)
      anchor.click()
      // Defer revoke to next tick so older browsers finish the download first
      setTimeout(() => {
        URL.revokeObjectURL(objectUrl)
        anchor.remove()
      }, 0)
    } catch (error) {
      // Surface failure to user via alert; matches sibling download error handling (usePanelImageDownload)
      alert(error instanceof Error ? error.message : '下载失败')
    }
  }

  return { useVersion, downloadZip }
}

// ponytail: hardcoded zh strings — formatTimeAgo is called from render, not a
// hook, so wiring next-intl through every call site is more churn than the
// three lines it saves. Upgrade path: accept a `t` translator like
// `src/app/[locale]/dev/workspace-redesign/shared.ts#formatTimeAgo` does.
export function formatTimeAgo(dateString: string): string {
  const diffMs = Date.now() - new Date(dateString).getTime()
  const minutes = Math.floor(diffMs / 60_000)
  const hours = Math.floor(diffMs / 3_600_000)
  const days = Math.floor(diffMs / 86_400_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (hours < 24) return `${hours} 小时前`
  return `${days} 天前`
}
