'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  DEFAULT_EDITOR_EXPORT_SETTINGS,
  type EditorExportFormat,
  type EditorExportSettings,
  type useEditorExport,
} from '@/lib/novel-promotion/stages/editor-stage-runtime/useEditorExport'

type EditorExportRuntime = ReturnType<typeof useEditorExport>

interface ExportPanelProps {
  exportRuntime: EditorExportRuntime
  disabledReason: string | null
  onClose: () => void
}

type ResolutionPreset = {
  key: string
  width: number
  height: number
}

const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { key: '720p', width: 720, height: 1280 },
  { key: '1080p', width: 1080, height: 1920 },
]

const FPS_OPTIONS = [24, 30, 60]
const FORMAT_OPTIONS: EditorExportFormat[] = ['mp4', 'webm']

function settingsFromPreset(preset: ResolutionPreset): EditorExportSettings {
  return {
    ...DEFAULT_EDITOR_EXPORT_SETTINGS,
    width: preset.width,
    height: preset.height,
  }
}

export function ExportPanel({ exportRuntime, disabledReason, onClose }: ExportPanelProps) {
  const t = useTranslations('novelPromotion.editor.export')
  const [selectedPresetKey, setSelectedPresetKey] = useState('1080p')
  const [settings, setSettings] = useState<EditorExportSettings>(() => settingsFromPreset(RESOLUTION_PRESETS[1]))

  const canStart = exportRuntime.canStart && !disabledReason && !!settings.bitrate.trim()
  const status = exportRuntime.state
  const progress = status.progress
  const showProgress = status.phase === 'starting' || status.phase === 'processing'
  const showDownload = status.phase === 'done' && !!status.downloadUrl
  const statusText = (() => {
    if (status.phase === 'starting') return t('starting')
    if (status.phase === 'processing') return t('processing', { progress })
    if (status.phase === 'done') return t('done')
    if (status.phase === 'cancelled') return t('cancelled')
    if (status.error) return status.isConcurrencyConflict ? t('conflict') : status.error
    if (disabledReason) return disabledReason
    if (!settings.bitrate.trim()) return t('bitrateRequired')
    return t('ready')
  })()

  const updatePreset = (presetKey: string) => {
    const preset = RESOLUTION_PRESETS.find((item) => item.key === presetKey)
    if (!preset) return
    setSelectedPresetKey(preset.key)
    setSettings((previous) => ({
      ...previous,
      width: preset.width,
      height: preset.height,
    }))
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
      <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-5 text-slate-950 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">{t('title')}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">{t('description')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-2 py-1 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
            aria-label={t('close')}
          >
            ×
          </button>
        </div>

        <div className="mt-5 space-y-4 text-xs">
          <div>
            <label className="block font-medium text-slate-700">{t('resolution')}</label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {RESOLUTION_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  disabled={exportRuntime.isRunning}
                  onClick={() => updatePreset(preset.key)}
                  className={`rounded-xl border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    selectedPresetKey === preset.key
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-400'
                  }`}
                >
                  <div className="font-medium">{t(`presets.${preset.key}` as never)}</div>
                  <div className={`mt-1 text-[10px] ${selectedPresetKey === preset.key ? 'text-slate-300' : 'text-slate-400'}`}>
                    {preset.width}×{preset.height}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block font-medium text-slate-700">
              {t('fps')}
              <select
                value={settings.fps}
                disabled={exportRuntime.isRunning}
                onChange={(event) => setSettings((previous) => ({ ...previous, fps: Number(event.target.value) }))}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-slate-500 disabled:bg-slate-100"
              >
                {FPS_OPTIONS.map((fps) => <option key={fps} value={fps}>{fps}</option>)}
              </select>
            </label>

            <label className="block font-medium text-slate-700">
              {t('format')}
              <select
                value={settings.format}
                disabled={exportRuntime.isRunning}
                onChange={(event) => setSettings((previous) => ({ ...previous, format: event.target.value as EditorExportFormat }))}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-slate-500 disabled:bg-slate-100"
              >
                {FORMAT_OPTIONS.map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}
              </select>
            </label>
          </div>

          <label className="block font-medium text-slate-700">
            {t('bitrate')}
            <input
              value={settings.bitrate}
              disabled={exportRuntime.isRunning}
              onChange={(event) => setSettings((previous) => ({ ...previous, bitrate: event.target.value }))}
              placeholder="8M"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-slate-500 disabled:bg-slate-100"
            />
          </label>

          <div className={`rounded-2xl border p-3 ${status.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
            <div className="flex items-center justify-between gap-3">
              <span>{statusText}</span>
              {status.outputMediaObjectId ? (
                <span className="max-w-[160px] truncate text-[10px] text-slate-400">
                  {t('mediaObjectId', { id: status.outputMediaObjectId })}
                </span>
              ) : null}
            </div>
            {showProgress ? (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-slate-900 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {exportRuntime.isRunning ? (
            <button
              type="button"
              onClick={() => { void exportRuntime.cancelExport() }}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
            >
              {t('cancel')}
            </button>
          ) : null}
          {status.phase === 'failed' || status.phase === 'cancelled' ? (
            <button
              type="button"
              disabled={exportRuntime.isRunning || !exportRuntime.state.settings}
              onClick={() => { void exportRuntime.retryExport() }}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('retry')}
            </button>
          ) : null}
          {showDownload ? (
            <button
              type="button"
              disabled={!status.downloadUrl}
              onClick={() => { exportRuntime.download() }}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('download')}
            </button>
          ) : null}
          <button
            type="button"
            disabled={!canStart}
            onClick={() => { void exportRuntime.startExport(settings) }}
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exportRuntime.isRunning ? t('runningButton') : t('start')}
          </button>
        </div>
      </section>
    </div>
  )
}
