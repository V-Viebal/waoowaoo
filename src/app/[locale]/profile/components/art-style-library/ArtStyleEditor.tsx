'use client'

import { FormEvent, useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'

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
}

type ArtStyleEditorProps = {
  initialValues?: Partial<ArtStyleEditorValues>
  labels: ArtStyleEditorLabels
  saving: boolean
  onSubmit: (values: ArtStyleEditorValues) => Promise<void>
  onCancel: () => void
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
}: ArtStyleEditorProps) {
  const [values, setValues] = useState<ArtStyleEditorValues>({
    ...DEFAULT_VALUES,
    ...initialValues,
  })

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

  return (
    <form onSubmit={handleSubmit} className="border-b border-[var(--glass-stroke-base)] p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <label className="space-y-2">
          <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{labels.name}</span>
          <input
            value={values.name}
            onChange={(event) => updateField('name', event.target.value)}
            className="w-full rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-base)] px-3 py-2 text-sm text-[var(--glass-text-primary)] outline-none transition focus:border-[var(--glass-accent-from)]"
            required
          />
        </label>

        <label className="space-y-2">
          <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{labels.previewImageUrl}</span>
          <input
            value={values.previewImageUrl}
            onChange={(event) => updateField('previewImageUrl', event.target.value)}
            className="w-full rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-base)] px-3 py-2 text-sm text-[var(--glass-text-primary)] outline-none transition focus:border-[var(--glass-accent-from)]"
          />
        </label>

        <label className="space-y-2 lg:col-span-2">
          <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{labels.description}</span>
          <input
            value={values.description}
            onChange={(event) => updateField('description', event.target.value)}
            className="w-full rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-base)] px-3 py-2 text-sm text-[var(--glass-text-primary)] outline-none transition focus:border-[var(--glass-accent-from)]"
          />
        </label>

        <label className="space-y-2 lg:col-span-2">
          <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{labels.prompt}</span>
          <textarea
            value={values.prompt}
            onChange={(event) => updateField('prompt', event.target.value)}
            className="min-h-28 w-full resize-y rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-base)] px-3 py-2 text-sm leading-6 text-[var(--glass-text-primary)] outline-none transition focus:border-[var(--glass-accent-from)]"
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
