'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useTimelineContext, type TrackElement } from '@twick/timeline'

interface ElementLike {
  getId: () => string
  getType?: () => string
  getStartTime?: () => number
  getEndTime?: () => number
  getProps?: () => Record<string, unknown>
  getName?: () => string
}

/**
 * 通用片段属性编辑面板
 * 支持编辑：起始时间、时长、音量（音频）、字幕内容和样式（字幕）
 */
export function ClipPropertiesPanel({ selectedId }: { selectedId: string | null }) {
  const t = useTranslations('novelPromotion.editor.rightPanel.properties')
  const { editor, present, selectedItem } = useTimelineContext()

  const [start, setStart] = useState<number>(0)
  const [end, setEnd] = useState<number>(0)
  const [volume, setVolume] = useState<number>(1)
  const [text, setText] = useState<string>('')
  const [fontSize, setFontSize] = useState<number>(32)
  const [fill, setFill] = useState<string>('#ffffff')
  const [stroke, setStroke] = useState<string>('#000000')

  // 从 present 中查找选中的元素
  const selectedElement = (() => {
    if (!selectedId || !present?.tracks) return null
    for (const track of present.tracks) {
      const element = (track.elements ?? []).find((el) => (el as { id?: string }).id === selectedId)
      if (element) return element
    }
    return null
  })()

  const elementType = selectedElement?.type ?? null

  // 同步选中元素的属性到本地状态
  useEffect(() => {
    if (!selectedElement) return
    const el = selectedElement as {
      s?: number
      e?: number
      t?: string
      props?: Record<string, unknown>
    }
    setStart(el.s ?? 0)
    setEnd(el.e ?? 0)
    if (el.props) {
      setVolume(typeof el.props.volume === 'number' ? el.props.volume : 1)
      setFontSize(typeof el.props.fontSize === 'number' ? el.props.fontSize : 32)
      setFill(typeof el.props.fill === 'string' ? el.props.fill : '#ffffff')
      setStroke(typeof el.props.stroke === 'string' ? el.props.stroke : '#000000')
    }
    if (typeof el.t === 'string') {
      setText(el.t)
    }
  }, [selectedElement])

  const applyChanges = (patch: Record<string, unknown>) => {
    if (!selectedItem || !editor) return
    try {
      const item = selectedItem as unknown as ElementLike & Record<string, unknown>
      const currentProps = item.getProps ? item.getProps() : {}
      const merged = { ...currentProps, ...patch }
      const setProps = (item as unknown as { setProps?: (p: Record<string, unknown>) => void }).setProps
      if (typeof setProps === 'function') {
        setProps.call(item, merged)
      }
      editor.updateElement(selectedItem as TrackElement)
    } catch (error) {
      console.warn('[ClipProperties] Failed to apply changes:', error)
    }
  }

  const applyTimeChanges = (nextStart: number, nextEnd: number) => {
    if (!selectedItem || !editor) return
    try {
      const item = selectedItem as unknown as ElementLike & Record<string, unknown>
      const setStartTime = (item as unknown as { setStartTime?: (v: number) => void }).setStartTime
      const setEndTime = (item as unknown as { setEndTime?: (v: number) => void }).setEndTime
      if (typeof setStartTime === 'function') setStartTime.call(item, nextStart)
      if (typeof setEndTime === 'function') setEndTime.call(item, nextEnd)
      editor.updateElement(selectedItem as TrackElement)
    } catch (error) {
      console.warn('[ClipProperties] Failed to apply time changes:', error)
    }
  }

  const applyTextChanges = (nextText: string) => {
    if (!selectedItem || !editor) return
    try {
      const item = selectedItem as unknown as ElementLike & Record<string, unknown>
      const setText = (item as unknown as { setText?: (v: string) => void }).setText
      if (typeof setText === 'function') setText.call(item, nextText)
      editor.updateElement(selectedItem as TrackElement)
    } catch (error) {
      console.warn('[ClipProperties] Failed to apply text changes:', error)
    }
  }

  const handleDelete = () => {
    if (!selectedItem || !editor) return
    try {
      editor.removeElement(selectedItem as TrackElement)
    } catch (error) {
      console.warn('[ClipProperties] Failed to remove element:', error)
    }
  }

  if (!selectedId || !selectedElement) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 text-center text-xs text-[var(--glass-text-secondary)]">
        {t('noneSelected')}
      </div>
    )
  }

  const duration = end - start

  return (
    <div className="space-y-3">
      {/* 基本信息 */}
      <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium text-[var(--glass-text-primary)]">
            {t('selection')}
          </div>
          <span className="rounded-full bg-[var(--glass-bg-muted)] px-2 py-0.5 text-[10px] text-[var(--glass-text-secondary)]">
            {elementType}
          </span>
        </div>
        <div className="break-all font-mono text-[10px] text-[var(--glass-text-tertiary)]">
          {selectedId.slice(0, 20)}...
        </div>
      </div>

      {/* 时间编辑 */}
      <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
        <div className="mb-2 text-xs font-medium text-[var(--glass-text-primary)]">{t('clip.time')}</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] text-[var(--glass-text-tertiary)]">{t('clip.startSeconds')}</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={start.toFixed(2)}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (Number.isFinite(v) && v >= 0) {
                  setStart(v)
                }
              }}
              onBlur={() => applyTimeChanges(start, end)}
              className="mt-1 w-full rounded-lg border border-[var(--glass-stroke-soft)] bg-white px-2 py-1 text-xs"
            />
          </label>
          <label className="block">
            <span className="text-[10px] text-[var(--glass-text-tertiary)]">{t('clip.durationSeconds')}</span>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={duration.toFixed(2)}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (Number.isFinite(v) && v > 0) {
                  setEnd(start + v)
                }
              }}
              onBlur={() => applyTimeChanges(start, end)}
              className="mt-1 w-full rounded-lg border border-[var(--glass-stroke-soft)] bg-white px-2 py-1 text-xs"
            />
          </label>
        </div>
      </div>

      {/* 音量控制（视频/音频） */}
      {(elementType === 'audio' || elementType === 'video') && (
        <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--glass-text-primary)]">{t('clip.volume')}</span>
            <span className="text-[10px] text-[var(--glass-text-tertiary)]">
              {Math.round(volume * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={volume}
            onChange={(e) => {
              const v = Number(e.target.value)
              setVolume(v)
              applyChanges({ volume: v })
            }}
            className="w-full"
          />
        </div>
      )}

      {/* 字幕编辑 */}
      {elementType === 'caption' && (
        <>
          <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
            <div className="mb-2 text-xs font-medium text-[var(--glass-text-primary)]">
              {t('clip.captionText')}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => applyTextChanges(text)}
              rows={3}
              className="w-full resize-none rounded-lg border border-[var(--glass-stroke-soft)] bg-white px-2 py-1.5 text-xs"
              placeholder={t('clip.captionPlaceholder')}
            />
          </div>
          <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">
            <div className="mb-2 text-xs font-medium text-[var(--glass-text-primary)]">
              {t('clip.captionStyle')}
            </div>
            <div className="space-y-2">
              <label className="block">
                <span className="text-[10px] text-[var(--glass-text-tertiary)]">{t('clip.fontSize')}</span>
                <input
                  type="number"
                  min="12"
                  max="120"
                  value={fontSize}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v)) {
                      setFontSize(v)
                      applyChanges({ fontSize: v })
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-[var(--glass-stroke-soft)] bg-white px-2 py-1 text-xs"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] text-[var(--glass-text-tertiary)]">{t('clip.fillColor')}</span>
                  <input
                    type="color"
                    value={fill}
                    onChange={(e) => {
                      setFill(e.target.value)
                      applyChanges({ fill: e.target.value })
                    }}
                    className="mt-1 h-8 w-full cursor-pointer rounded-lg border border-[var(--glass-stroke-soft)]"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-[var(--glass-text-tertiary)]">{t('clip.strokeColor')}</span>
                  <input
                    type="color"
                    value={stroke}
                    onChange={(e) => {
                      setStroke(e.target.value)
                      applyChanges({ stroke: e.target.value })
                    }}
                    className="mt-1 h-8 w-full cursor-pointer rounded-lg border border-[var(--glass-stroke-soft)]"
                  />
                </label>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 删除按钮 */}
      <button
        type="button"
        onClick={handleDelete}
        className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600 transition hover:border-red-400 hover:bg-red-100"
      >
        {t('clip.deleteClip')}
      </button>
    </div>
  )
}
