'use client'

import VoiceDesignDialogBase, {
  type VoiceDesignMutationPayload,
  type VoiceDesignMutationResult,
} from '@/components/voice/VoiceDesignDialogBase'
import type { VoiceDesignProvider } from '@/components/voice/voice-design-shared'
import { useDesignProjectVoice } from '@/lib/query/hooks'
import { useRecommendVoiceInstruct } from '@/lib/query/mutations/useVoiceMutations'
import { apiFetch } from '@/lib/api-fetch'

interface VoiceDesignDialogProps {
  isOpen: boolean
  speaker: string
  hasExistingVoice?: boolean
  onClose: () => void
  onSave: (voiceId: string, audioBase64: string, provider: VoiceDesignProvider) => void
  projectId: string
  characterId?: string
}

export default function VoiceDesignDialog({
  isOpen,
  speaker,
  hasExistingVoice = false,
  onClose,
  onSave,
  projectId,
  characterId,
}: VoiceDesignDialogProps) {
  const designVoiceMutation = useDesignProjectVoice(projectId)
  const recommendMutation = useRecommendVoiceInstruct(projectId, characterId ?? '')

  const handleDesignVoice = async (
    payload: VoiceDesignMutationPayload,
  ): Promise<VoiceDesignMutationResult> => {
    return await designVoiceMutation.mutateAsync(payload)
  }

  const handleRecommendInstruct = characterId
    ? async () => {
        const result = await recommendMutation.mutateAsync()
        return { instruct: result.instruct }
      }
    : undefined

  // 声音克隆：上传参考音频 → OmniVoice clone → 回填角色音色
  const handleClone = characterId
    ? async (file: File) => {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('characterId', characterId)
        formData.append('mode', 'clone')
        const res = await apiFetch(`/api/novel-promotion/${projectId}/character-voice`, {
          method: 'POST',
          body: formData,
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { error?: string }
          throw new Error(data.error || 'clone failed')
        }
      }
    : undefined

  return (
    <VoiceDesignDialogBase
      isOpen={isOpen}
      speaker={speaker}
      hasExistingVoice={hasExistingVoice}
      onClose={onClose}
      onSave={onSave}
      onDesignVoice={handleDesignVoice}
      onRecommendInstruct={handleRecommendInstruct}
      onClone={handleClone}
    />
  )
}
