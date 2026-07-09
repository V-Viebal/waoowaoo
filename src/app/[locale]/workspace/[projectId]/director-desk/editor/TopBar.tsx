'use client'
import { useState } from 'react'
import { useDirectorStore } from './store/directorStore'
import { collectBoundShotsForSave, getActiveCameraSnapshot } from './store/directorSelectors'
import { captureCameraScreenshot } from './io/screenshot'
import { serializeDirectorProject } from '@/lib/director-desk/schema'

export function TopBar() {
  const viewMode = useDirectorStore((s) => s.viewMode)
  const setViewMode = useDirectorStore((s) => s.setViewMode)
  const project = useDirectorStore((s) => s.project)
  const panelId = useDirectorStore((s) => s.panelId)
  const projectId = useDirectorStore((s) => s.projectId)
  const videoRatio = useDirectorStore((s) => s.videoRatio)
  const reset = useDirectorStore((s) => s.reset)
  const isDirty = useDirectorStore((s) => s.isDirty)
  const [saving, setSaving] = useState(false)

  const doSave = async (): Promise<boolean> => {
    if (!panelId || !projectId) return false
    setSaving(true)
    try {
      let shots = collectBoundShotsForSave()
      // if user hasn't captured anything, auto-capture the active camera
      if (shots.length === 0) {
        const active = getActiveCameraSnapshot()
        if (active) {
          try {
            const dataUrl = await captureCameraScreenshot(videoRatio, active.id)
            const store = useDirectorStore.getState()
            const capId = store.addCameraCapture(active.id, dataUrl, active.name)
            store.toggleCaptureBound(active.id, capId)
            store.toggleCaptureActive(active.id, capId)
            shots = collectBoundShotsForSave()
          } catch (err) {
            console.error('[TopBar] auto-capture failed', err)
          }
        }
      }
      const body = {
        panelId,
        project: JSON.parse(serializeDirectorProject(project)),
        shots,
      }
      const res = await fetch(`/api/novel-promotion/${projectId}/director-desk/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        alert(`保存失败: ${res.status} ${text}`)
        return false
      }
      const data = await res.json().catch(() => null)
      if (data?.warning) alert(data.warning)
      useDirectorStore.setState({ isDirty: false })
      return true
    } finally {
      setSaving(false)
    }
  }

  const onReset = () => {
    if (!confirm('确定要重置为上次保存的布局吗？未保存的改动将丢失。')) return
    void reset()
  }

  const onClose = () => {
    if (isDirty && !confirm('有未保存的布局，是否放弃？')) return
    window.close()
  }

  const onSaveAndClose = async () => {
    const ok = await doSave()
    if (ok) window.close()
  }

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 px-4">
      <div className="text-sm font-medium">3D 导演台</div>
      <div className="ml-4 inline-flex overflow-hidden rounded border border-white/10 text-xs">
        <button
          onClick={() => setViewMode('director')}
          className={`px-3 py-1 ${viewMode === 'director' ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5'}`}
        >
          导演视角
        </button>
        <button
          onClick={() => setViewMode('camera')}
          className={`px-3 py-1 ${viewMode === 'camera' ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5'}`}
        >
          机位视角
        </button>
      </div>
      <div className="flex-1" />
      <button
        onClick={onReset}
        disabled={saving}
        className="rounded border border-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/5 disabled:opacity-40"
      >
        重置
      </button>
      <button
        onClick={() => void doSave()}
        disabled={saving}
        className="rounded bg-blue-500/80 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {saving ? '保存中…' : '保存'}
      </button>
      <button
        onClick={() => void onSaveAndClose()}
        disabled={saving}
        className="rounded bg-emerald-500/80 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        保存并关闭
      </button>
      <button
        onClick={onClose}
        className="rounded px-2 py-1 text-lg leading-none text-white/60 hover:bg-white/5 hover:text-white"
        aria-label="关闭"
      >
        ×
      </button>
    </div>
  )
}
