'use client'

import ConfigStage from './ConfigStage'
import ScriptStage from './ScriptStage'
import StoryboardStage from './StoryboardStage'
import { EditorStage } from './editor/EditorStage'
import VideoStageRoute from './VideoStageRoute'
import VoiceStageRoute from './VoiceStageRoute'
import { useWorkspaceProvider } from '../WorkspaceProvider'

interface WorkspaceStageContentProps {
  currentStage: string
}

export default function WorkspaceStageContent({
  currentStage,
}: WorkspaceStageContentProps) {
  const { projectId, episodeId } = useWorkspaceProvider()

  return (
    <div key={currentStage} className="animate-page-enter">
      {currentStage === 'config' && <ConfigStage />}

      {(currentStage === 'script' || currentStage === 'assets') && <ScriptStage />}

      {currentStage === 'storyboard' && <StoryboardStage />}

      {currentStage === 'videos' && <VideoStageRoute />}

      {currentStage === 'voice' && <VoiceStageRoute />}

      {currentStage === 'editor' && episodeId && <EditorStage projectId={projectId} episodeId={episodeId} />}
    </div>
  )
}
