'use client'

import VoiceDesignDialogBase, {
  type VoiceDesignMutationPayload,
  type VoiceDesignMutationResult,
} from '@/components/voice/VoiceDesignDialogBase'
import type { VoiceDesignProvider } from '@/components/voice/voice-design-shared'
import { useDesignAssetHubVoice } from '@/lib/query/hooks'

interface VoiceDesignDialogProps {
  isOpen: boolean
  speaker: string
  hasExistingVoice?: boolean
  onClose: () => void
  onSave: (voiceId: string, audioBase64: string, provider: VoiceDesignProvider) => void
  onClone?: (file: File) => Promise<void>
}

export default function VoiceDesignDialog({
  isOpen,
  speaker,
  hasExistingVoice = false,
  onClose,
  onSave,
  onClone,
}: VoiceDesignDialogProps) {
  const designVoiceMutation = useDesignAssetHubVoice()

  const handleDesignVoice = async (
    payload: VoiceDesignMutationPayload,
  ): Promise<VoiceDesignMutationResult> => {
    return await designVoiceMutation.mutateAsync(payload)
  }

  return (
    <VoiceDesignDialogBase
      isOpen={isOpen}
      speaker={speaker}
      hasExistingVoice={hasExistingVoice}
      onClose={onClose}
      onSave={onSave}
      onDesignVoice={handleDesignVoice}
      onClone={onClone}
    />
  )
}
