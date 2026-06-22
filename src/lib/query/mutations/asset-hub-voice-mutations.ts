import { useMutation, useQueryClient } from '@tanstack/react-query'
import { resolveTaskResponse } from '@/lib/task/client'
import {
  requestJsonWithError,
  requestTaskResponseWithError,
  requestVoidWithError,
} from './mutation-shared'
import { invalidateGlobalVoices } from './asset-hub-mutations-shared'

export function useDeleteVoice() {
  const queryClient = useQueryClient()
  const invalidateVoices = () => invalidateGlobalVoices(queryClient)

  return useMutation({
    mutationFn: async (voiceId: string) => {
      await requestVoidWithError(
        `/api/asset-hub/voices/${voiceId}`,
        { method: 'DELETE' },
        'Failed to delete voice',
      )
    },
    onSuccess: invalidateVoices,
  })
}

export function useDesignAssetHubVoice() {
  return useMutation({
    mutationFn: async (payload: {
      voicePrompt: string
      previewText: string
      preferredName: string
      language: 'zh'
      provider?: 'bailian' | 'omnivoice'
    }) => {
      const response = await requestTaskResponseWithError(
        '/api/asset-hub/voice-design',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        'Failed to design voice',
      )
      return await resolveTaskResponse<{
        success?: boolean
        voiceId?: string
        targetModel?: string
        audioBase64?: string
        requestId?: string
      }>(response)
    },
  })
}

export function useSaveDesignedAssetHubVoice() {
  const queryClient = useQueryClient()
  const invalidateVoices = () => invalidateGlobalVoices(queryClient)

  return useMutation({
    mutationFn: async (payload: {
      voiceId: string
      voiceBase64: string
      voiceName: string
      folderId: string | null
      voicePrompt: string
      provider?: 'bailian' | 'omnivoice'
    }) => {
      const uploadData = await requestJsonWithError<{ key: string }>('/api/asset-hub/upload-temp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64: payload.voiceBase64,
          type: 'audio/wav',
          extension: 'wav',
        }),
      }, '上传音频失败')
      const voiceType = payload.provider === 'omnivoice' ? 'omnivoice-design' : 'qwen-designed'
      const res = await requestJsonWithError('/api/asset-hub/voices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: payload.voiceName,
          description: null,
          folderId: payload.folderId,
          voiceId: payload.voiceId,
          voiceType,
          customVoiceUrl: uploadData.key,
          voicePrompt: payload.voicePrompt,
          gender: null,
          language: 'zh',
        }),
      }, '保存失败')
      return res
    },
    onSuccess: invalidateVoices,
  })
}

export function useUploadAssetHubVoice() {
  const queryClient = useQueryClient()
  const invalidateVoices = () => invalidateGlobalVoices(queryClient)

  return useMutation({
    mutationFn: async (payload: {
      uploadFile: File
      voiceName: string
      folderId: string | null
    }) => {
      const formData = new FormData()
      formData.append('file', payload.uploadFile)
      formData.append('name', payload.voiceName)
      if (payload.folderId) {
        formData.append('folderId', payload.folderId)
      }
      return await requestJsonWithError('/api/asset-hub/voices/upload', {
        method: 'POST',
        body: formData,
      }, '上传失败')
    },
    onSuccess: invalidateVoices,
  })
}

/**
 * OmniVoice 声音克隆：上传参考音频 → clone → 保存为 omnivoice-clone 音色
 */
export function useCloneAssetHubVoice() {
  const queryClient = useQueryClient()
  const invalidateVoices = () => invalidateGlobalVoices(queryClient)

  return useMutation({
    mutationFn: async (payload: {
      uploadFile: File
      voiceName: string
      folderId: string | null
      language?: string
    }) => {
      const formData = new FormData()
      formData.append('file', payload.uploadFile)
      formData.append('name', payload.voiceName)
      if (payload.folderId) {
        formData.append('folderId', payload.folderId)
      }
      if (payload.language) {
        formData.append('language', payload.language)
      }
      return await requestJsonWithError<{ success: boolean; globalVoiceId: string; profileId: string; previewUrl: string }>(
        '/api/asset-hub/voice-clone-upload',
        {
          method: 'POST',
          body: formData,
        },
        '声音克隆失败',
      )
    },
    onSuccess: invalidateVoices,
  })
}
