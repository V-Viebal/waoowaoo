'use client'

import VoiceDesignDialogBase, {
  type VoiceDesignMutationPayload,
  type VoiceDesignMutationResult,
} from '@/components/voice/VoiceDesignDialogBase'
import type { VoiceDesignEngine, VoiceDesignProvider } from '@/components/voice/voice-design-shared'
import type { CosyVoiceLanguageHint, CosyVoiceTargetModel } from '@/components/voice/voice-design-shared'
import { useDesignProjectVoice, useRefreshProjectAssets } from '@/lib/query/hooks'
import { useRecommendVoiceInstruct } from '@/lib/query/mutations/useVoiceMutations'
import { apiFetch } from '@/lib/api-fetch'

interface VoiceDesignDialogProps {
  isOpen: boolean
  speaker: string
  hasExistingVoice?: boolean
  onClose: () => void
  onSave: (voiceId: string, audioBase64: string | undefined, provider: VoiceDesignProvider) => void
  projectId: string
  characterId?: string
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('read file failed'))
        return
      }
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('read file failed'))
    reader.readAsDataURL(file)
  })
}

function guessExtension(file: File): string {
  const match = file.name.toLowerCase().match(/\.(mp3|wav|ogg|m4a|aac)$/i)
  return match?.[1] ?? 'mp3'
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
  const refreshAssets = useRefreshProjectAssets(projectId)

  const handleDesignVoice = async (
    payload: VoiceDesignMutationPayload,
  ): Promise<VoiceDesignMutationResult> => {
    return await designVoiceMutation.mutateAsync(payload)
  }

  const handleRecommendInstruct = characterId
    ? async (engine: VoiceDesignEngine) => {
        const result = await recommendMutation.mutateAsync({ engine })
        return { instruct: result.instruct }
      }
    : undefined

  // 声音克隆（OmniVoice 旧路径）：直接走 character-voice multipart 接口
  const handleOmniClone = characterId
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
        // ponytail: OmniVoice clone 直接写了角色行,这里必须刷新资产缓存,
        // 否则角色卡片继续显示"未绑定音色"。
        refreshAssets()
      }
    : undefined

  // 声音克隆（CosyVoice）：上传音频到 upload-temp → 调 voice-design flavour:cosyvoice-clone
  const handleCosyClone = characterId
    ? async (params: {
        file: File
        prefix: string
        targetModel: CosyVoiceTargetModel
        languageHint: CosyVoiceLanguageHint
        maxPromptAudioLength: number
        enablePreprocess: boolean
      }) => {
        if (!params.file.size || params.file.size > 25 * 1024 * 1024) {
          throw new Error('请选择小于 25MB 的音频文件')
        }
        const base64 = await readFileAsBase64(params.file)
        if (!base64) {
          throw new Error('音频文件为空或读取失败')
        }
        const extension = guessExtension(params.file)
        const up = await apiFetch('/api/asset-hub/upload-temp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64, extension, type: params.file.type || 'audio/mpeg' }),
        })
        if (!up.ok) {
          const data = await up.json().catch(() => ({})) as { error?: string }
          throw new Error(data.error || 'upload failed')
        }
        const uploaded = await up.json() as { key: string }
        const cloneResult = await designVoiceMutation.mutateAsync({
          voicePrompt: '',
          previewText: '',
          preferredName: 'clone',
          language: 'zh',
          provider: 'bailian',
          flavor: 'cosyvoice-clone',
          prefix: params.prefix,
          targetModel: params.targetModel,
          languageHints: [params.languageHint],
          audioStorageKey: uploaded.key,
          maxPromptAudioLength: params.maxPromptAudioLength,
          enablePreprocess: params.enablePreprocess,
        })
        if (!cloneResult.voiceId) {
          throw new Error('clone failed: no voiceId returned')
        }
        return { voiceId: cloneResult.voiceId, audioBase64: cloneResult.audioBase64 }
      }
    : undefined

  const cloneEngines: ('omnivoice' | 'cosyvoice')[] = []
  if (handleOmniClone) cloneEngines.push('omnivoice')
  if (handleCosyClone) cloneEngines.push('cosyvoice')

  return (
    <VoiceDesignDialogBase
      isOpen={isOpen}
      speaker={speaker}
      hasExistingVoice={hasExistingVoice}
      onClose={onClose}
      onSave={onSave}
      onDesignVoice={handleDesignVoice}
      onRecommendInstruct={handleRecommendInstruct}
      cloneEngines={cloneEngines.length ? cloneEngines : undefined}
      onOmniClone={handleOmniClone}
      onCosyClone={handleCosyClone}
    />
  )
}
