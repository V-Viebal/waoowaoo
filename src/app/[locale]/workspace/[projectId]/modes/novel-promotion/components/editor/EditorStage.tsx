'use client'

import { EditorStageRuntimeProvider } from '@/lib/novel-promotion/stages/editor-stage-runtime-core'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import { EditorStageShell } from './EditorStageShell'

interface EditorStageProps {
  projectId: string
  episodeId: string
}

const DEFAULT_VIDEO_SIZE = { width: 720, height: 1280 }

function resolveVideoSize(videoRatio: string | undefined): { width: number; height: number } {
  if (!videoRatio) return DEFAULT_VIDEO_SIZE

  const [rawWidth, rawHeight] = videoRatio.split(':').map((part) => Number(part))
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth <= 0 || rawHeight <= 0) {
    return DEFAULT_VIDEO_SIZE
  }

  const longSide = 1280
  const shortSide = Math.round((longSide * Math.min(rawWidth, rawHeight)) / Math.max(rawWidth, rawHeight))

  if (rawWidth >= rawHeight) {
    return { width: longSide, height: shortSide }
  }

  return { width: shortSide, height: longSide }
}

export function EditorStage({ projectId, episodeId }: EditorStageProps) {
  const { videoRatio } = useWorkspaceStageRuntime()
  const { width: videoWidth, height: videoHeight } = resolveVideoSize(videoRatio ?? undefined)

  return (
    <EditorStageRuntimeProvider
      projectId={projectId}
      episodeId={episodeId}
      videoWidth={videoWidth}
      videoHeight={videoHeight}
    >
      <EditorStageShell videoWidth={videoWidth} videoHeight={videoHeight} />
    </EditorStageRuntimeProvider>
  )
}
