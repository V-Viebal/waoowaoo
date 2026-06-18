'use client'

import { FormEvent, useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { useToast } from '@/contexts/ToastContext'

export type ArtStyleEditorValues = {
  name: string
  description: string
  prompt: string
  previewImageUrl: string
  sortOrder: number
}

type ArtStyleEditorLabels = {
  name: string
  description: string
  prompt: string
  previewImageUrl: string
  sortOrder: string
  save: string
  cancel: string
  generate: string
  generating: string
  selectModel: string
  generatePreview: string
  generatingPreview: string
  selectImageModel: string
}

type ArtStyleEditorProps = {
  initialValues?: Partial<ArtStyleEditorValues>
  labels: ArtStyleEditorLabels
  saving: boolean
  onSubmit: (values: ArtStyleEditorValues) => Promise<void>
  onCancel: () => void
  /** 画风 ID（管理员模式下用于生成预览图） */
  styleId?: string | null
  /** 预览图生成 API 路径，不传则使用用户侧默认 API */
  generatePreviewApiPath?: string
}

type ModelOption = {
  value: string
  label: string
}

const DEFAULT_VALUES: ArtStyleEditorValues = {
  name: '',
  description: '',
  prompt: '',
  previewImageUrl: '',
  sortOrder: 0,
}

export function ArtStyleEditor({
  initialValues,
  labels,
  saving,
  onSubmit,
  onCancel,
  styleId,
  generatePreviewApiPath,
}: ArtStyleEditorProps) {
  const { showToast, showError: showToastError } = useToast()
  const [values, setValues] = useState<ArtStyleEditorValues>({
    ...DEFAULT_VALUES,
    ...initialValues,
  })
  const [llmModels, setLlmModels] = useState<ModelOption[]>([])
  const [imageModels, setImageModels] = useState<ModelOption[]>([])
  const [selectedLlmModel, setSelectedLlmModel] = useState('')
  const [selectedImageModel, setSelectedImageModel] = useState('')
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false)
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [isLoadingModels, setIsLoadingModels] = useState(true)

  // 加载可用模型列表
  useEffect(() => {
    const loadModels = async () => {
      try {
        const response = await apiFetch('/api/user/models')
        if (response.ok) {
          const data = await response.json() as { llm?: ModelOption[]; image?: ModelOption[] }
          const llmOptions = data.llm?.map(m => ({
            value: m.value,
            label: m.label || m.value,
          })) || []
          const imageOptions = data.image?.map(m => ({
            value: m.value,
            label: m.label || m.value,
          })) || []

          setLlmModels(llmOptions)
          setImageModels(imageOptions)
          if (llmOptions.length > 0) {
            setSelectedLlmModel(llmOptions[0].value)
          }
          if (imageOptions.length > 0) {
            setSelectedImageModel(imageOptions[0].value)
          }
        }
      } catch (err) {
        console.error('Failed to load models:', err)
      } finally {
        setIsLoadingModels(false)
      }
    }

    void loadModels()
  }, [])

  useEffect(() => {
    setValues({
      ...DEFAULT_VALUES,
      ...initialValues,
    })
  }, [initialValues])

  const updateField = <K extends keyof ArtStyleEditorValues>(field: K, value: ArtStyleEditorValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await onSubmit({
      ...values,
      name: values.name.trim(),
      description: values.description.trim(),
      prompt: values.prompt.trim(),
      previewImageUrl: values.previewImageUrl.trim(),
      sortOrder: Number.isFinite(values.sortOrder) ? values.sortOrder : 0,
    })
  }

  const handleGeneratePrompt = async () => {
    if (!values.name.trim()) {
      setGenerateError('请先输入画风名称')
      return
    }

    setIsGeneratingPrompt(true)
    setGenerateError(null)

    try {
      const response = await apiFetch('/api/art-styles/generate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name.trim(),
          description: values.description.trim(),
          model: selectedLlmModel,
        }),
      })

      if (!response.ok) {
        const error = await response.json() as { error?: string }
        throw new Error(error.error || '生成失败，请重试')
      }

      const data = await response.json() as { prompt: string; description: string }
      updateField('prompt', data.prompt)
      if (data.description && !values.description) {
        updateField('description', data.description)
      }
      showToast(labels.generating?.replace('...', '') || 'Prompt generated', 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : '生成失败，请重试'
      setGenerateError(message)
      showToastError(message)
    } finally {
      setIsGeneratingPrompt(false)
    }
  }

  const handleGeneratePreview = async () => {
    if (generatePreviewApiPath && styleId) {
      // 管理员模式：更新数据库中的预览图
      setIsGeneratingPreview(true)
      setGenerateError(null)

      try {
        const response = await apiFetch(generatePreviewApiPath, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: selectedImageModel,
          }),
        })

        if (!response.ok) {
          const error = await response.json() as { error?: string }
          throw new Error(error.error || '生成失败，请重试')
        }

        const data = await response.json() as { previewImageUrl: string }
        updateField('previewImageUrl', data.previewImageUrl)
        showToast(labels.generatingPreview?.replace('...', '') || 'Preview generated', 'success')
      } catch (err) {
        const message = err instanceof Error ? err.message : '生成失败，请重试'
        setGenerateError(message)
        showToastError(message)
      } finally {
        setIsGeneratingPreview(false)
      }
    } else {
      // 用户模式：仅生成预览图 URL，不更新数据库
      if (!values.prompt.trim()) {
        const errorMsg = '请先生成或输入画风提示词'
        setGenerateError(errorMsg)
        showToastError(errorMsg)
        return
      }

      setIsGeneratingPreview(true)
      setGenerateError(null)

      try {
        const response = await apiFetch('/api/art-styles/generate-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: values.prompt.trim(),
            model: selectedImageModel,
            styleName: values.name.trim(),
          }),
        })

        if (!response.ok) {
          const error = await response.json() as { error?: string }
          throw new Error(error.error || '生成失败，请重试')
        }

        const data = await response.json() as { previewImageUrl: string }
        updateField('previewImageUrl', data.previewImageUrl)
        showToast(labels.generatingPreview?.replace('...', '') || 'Preview generated', 'success')
      } catch (err) {
        const message = err instanceof Error ? err.message : '生成失败，请重试'
        setGenerateError(message)
        showToastError(message)
      } finally {
        setIsGeneratingPreview(false)
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{labels.name}</span>
          </div>
          <input
            value={values.name}
            onChange={(event) => updateField('name', event.target.value)}
            className="w-full rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-base)] px-3 py-2 text-sm text-[var(--glass-text-primary)] outline-none transition focus:border-[var(--glass-accent-from)]"
            placeholder="例如：赛博朋克风、水彩手绘、像素艺术..."
            required
          />
        </div>

        <div className="space-y-2">
          <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{labels.selectModel}</span>
          <div className="flex gap-2">
            <select
              value={selectedLlmModel}
              onChange={(event) => setSelectedLlmModel(event.target.value)}
              className="flex-1 rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-base)] px-3 py-2 text-sm text-[var(--glass-text-primary)] outline-none transition focus:border-[var(--glass-accent-from)]"
              disabled={isLoadingModels}
            >
              {isLoadingModels ? (
                <option value="">加载中...</option>
              ) : llmModels.length === 0 ? (
                <option value="">暂无可用模型</option>
              ) : (
                llmModels.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              onClick={handleGeneratePrompt}
              disabled={isGeneratingPrompt || !values.name.trim() || isLoadingModels}
              className="glass-btn-base glass-btn-tone-success flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm"
            >
              <AppIcon name={isGeneratingPrompt ? 'loader' : 'sparkles'} className={`h-4 w-4 ${isGeneratingPrompt ? 'animate-spin' : ''}`} />
              {isGeneratingPrompt ? labels.generating : labels.generate}
            </button>
          </div>
        </div>

        <label className="space-y-2">
          <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{labels.previewImageUrl}</span>
          <div className="flex gap-2">
            <input
              value={values.previewImageUrl}
              onChange={(event) => updateField('previewImageUrl', event.target.value)}
              className="flex-1 rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-base)] px-3 py-2 text-sm text-[var(--glass-text-primary)] outline-none transition focus:border-[var(--glass-accent-from)]"
              placeholder="https://..."
            />
          </div>
          <div className="flex gap-2">
            <select
              value={selectedImageModel}
              onChange={(event) => setSelectedImageModel(event.target.value)}
              className="flex-1 rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-base)] px-3 py-2 text-sm text-[var(--glass-text-primary)] outline-none transition focus:border-[var(--glass-accent-from)]"
              disabled={isLoadingModels}
            >
              {isLoadingModels ? (
                <option value="">加载中...</option>
              ) : imageModels.length === 0 ? (
                <option value="">暂无可用模型</option>
              ) : (
                imageModels.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              onClick={handleGeneratePreview}
              disabled={isGeneratingPreview || !values.prompt.trim() || isLoadingModels}
              className="glass-btn-base glass-btn-tone-primary flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm"
            >
              <AppIcon name={isGeneratingPreview ? 'loader' : 'image'} className={`h-4 w-4 ${isGeneratingPreview ? 'animate-spin' : ''}`} />
              {isGeneratingPreview ? labels.generatingPreview : labels.generatePreview}
            </button>
          </div>
          {values.previewImageUrl && (
            <div className="mt-2 overflow-hidden rounded-xl border border-[var(--glass-stroke-base)]">
              <img
                src={values.previewImageUrl}
                alt="预览图"
                className="h-40 w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            </div>
          )}
        </label>

        <label className="space-y-2 lg:col-span-2">
          <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{labels.description}</span>
          <input
            value={values.description}
            onChange={(event) => updateField('description', event.target.value)}
            className="w-full rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-base)] px-3 py-2 text-sm text-[var(--glass-text-primary)] outline-none transition focus:border-[var(--glass-accent-from)]"
            placeholder="简要描述这个画风的特点和适用场景..."
          />
        </label>

        <label className="space-y-2 lg:col-span-2">
          <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{labels.prompt}</span>
          <textarea
            value={values.prompt}
            onChange={(event) => updateField('prompt', event.target.value)}
            className="min-h-28 w-full resize-y rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-base)] px-3 py-2 text-sm leading-6 text-[var(--glass-text-primary)] outline-none transition focus:border-[var(--glass-accent-from)]"
            placeholder="AI 生成的详细画风提示词将显示在这里..."
            required
          />
        </label>

        <label className="space-y-2">
          <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{labels.sortOrder}</span>
          <input
            type="number"
            value={values.sortOrder}
            onChange={(event) => updateField('sortOrder', Number.parseInt(event.target.value, 10) || 0)}
            className="w-full rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-base)] px-3 py-2 text-sm text-[var(--glass-text-primary)] outline-none transition focus:border-[var(--glass-accent-from)]"
          />
        </label>
      </div>

      {generateError && (
        <div className="mt-4 rounded-xl bg-[var(--glass-tone-danger-bg)] px-4 py-3 text-xs text-[var(--glass-tone-danger-fg)]">
          {generateError}
        </div>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="glass-btn-base flex items-center gap-2 rounded-xl px-4 py-2 text-sm"
          disabled={saving}
        >
          <AppIcon name="close" className="h-4 w-4" />
          {labels.cancel}
        </button>
        <button
          type="submit"
          className="glass-btn-base glass-btn-tone-info flex items-center gap-2 rounded-xl px-4 py-2 text-sm"
          disabled={saving}
        >
          <AppIcon name={saving ? 'loader' : 'check'} className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} />
          {labels.save}
        </button>
      </div>
    </form>
  )
}
