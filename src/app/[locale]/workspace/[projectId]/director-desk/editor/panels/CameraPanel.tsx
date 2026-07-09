'use client'
import { useState } from 'react'
import { useDirectorStore } from '../store/directorStore'
import { useSelectedCamera, useSelectedObject } from '../store/directorSelectors'
import { captureCameraScreenshot } from '../io/screenshot'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-white/70">
      <span className="w-16 shrink-0">{label}</span>
      <div className="flex-1">{children}</div>
    </label>
  )
}

function Triplet({ value, onChange }: { value: [number, number, number]; onChange: (v: [number, number, number]) => void }) {
  const cls = 'w-full rounded border border-white/10 bg-white/5 px-1.5 py-1 text-xs outline-none focus:border-white/30'
  return (
    <div className="grid grid-cols-3 gap-1">
      {(['X', 'Y', 'Z'] as const).map((lbl, i) => (
        <label key={lbl} className="flex items-center gap-1">
          <span className="w-3 text-[10px] text-white/40">{lbl}</span>
          <input
            type="number"
            step={0.1}
            value={value[i]}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n)) return
              const next: [number, number, number] = [value[0], value[1], value[2]]
              next[i] = n
              onChange(next)
            }}
            className={cls}
          />
        </label>
      ))}
    </div>
  )
}

export function CameraPanel() {
  const cam = useSelectedCamera()
  const cameras = useDirectorStore((s) => s.project.cameras)
  const activeId = useDirectorStore((s) => s.project.activeCameraId)
  const select = useDirectorStore((s) => s.select)
  const addCamera = useDirectorStore((s) => s.addCamera)
  const removeCamera = useDirectorStore((s) => s.removeCamera)
  const setCameraField = useDirectorStore((s) => s.setCameraField)
  const setActiveCamera = useDirectorStore((s) => s.setActiveCamera)
  const cameraCaptures = useDirectorStore((s) => s.cameraCaptures)
  const addCameraCapture = useDirectorStore((s) => s.addCameraCapture)
  const toggleCaptureBound = useDirectorStore((s) => s.toggleCaptureBound)
  const toggleCaptureActive = useDirectorStore((s) => s.toggleCaptureActive)
  const setCaptureName = useDirectorStore((s) => s.setCaptureName)
  const setCaptureNote = useDirectorStore((s) => s.setCaptureNote)
  const removeCameraCapture = useDirectorStore((s) => s.removeCameraCapture)
  const bindAllCaptures = useDirectorStore((s) => s.bindAllCaptures)
  const videoRatio = useDirectorStore((s) => s.videoRatio)
  const selectedObject = useSelectedObject()
  const [tab, setTab] = useState<'props' | 'shots'>('props')
  const [capturing, setCapturing] = useState(false)

  if (!cam) return null
  const captures = cameraCaptures[cam.id] ?? []

  const doCapture = async () => {
    if (capturing) return
    setCapturing(true)
    try {
      const dataUrl = await captureCameraScreenshot(videoRatio, cam.id)
      addCameraCapture(cam.id, dataUrl, cam.name)
    } catch (err) {
      alert(`截图失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCapturing(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 text-xs text-white/80">
      <div className="text-sm font-medium">机位 · {cam.name}</div>
      <div className="inline-flex overflow-hidden rounded border border-white/10 text-xs">
        <button
          onClick={() => setTab('props')}
          className={`flex-1 px-3 py-1 ${tab === 'props' ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5'}`}
        >
          属性
        </button>
        <button
          onClick={() => setTab('shots')}
          className={`flex-1 px-3 py-1 ${tab === 'shots' ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5'}`}
        >
          截图
        </button>
      </div>

      {tab === 'props' && (
        <div className="flex flex-col gap-3">
          <Row label="切换">
            <select
              value={cam.id}
              onChange={(e) => select(e.target.value)}
              className="w-full rounded border border-white/10 bg-white/5 px-1.5 py-1 text-xs outline-none focus:border-white/30"
            >
              {cameras.map((c) => (
                <option key={c.id} value={c.id} className="text-black">
                  {c.name}
                  {c.id === activeId ? ' ★' : ''}
                </option>
              ))}
            </select>
          </Row>
          <Row label="名称">
            <input
              value={cam.name}
              onChange={(e) => setCameraField(cam.id, 'name', e.target.value)}
              className="w-full rounded border border-white/10 bg-white/5 px-1.5 py-1 text-xs outline-none focus:border-white/30"
            />
          </Row>
          <Row label="焦距">
            <input
              type="range"
              min={10}
              max={120}
              step={1}
              value={cam.fov}
              onChange={(e) => setCameraField(cam.id, 'fov', Number(e.target.value))}
              className="w-full"
            />
            <div className="text-[10px] text-white/40">{cam.fov}°</div>
          </Row>
          <Row label="位置">
            <Triplet value={cam.position} onChange={(v) => setCameraField(cam.id, 'position', v)} />
          </Row>
          <Row label="目标">
            <Triplet value={cam.target} onChange={(v) => setCameraField(cam.id, 'target', v)} />
          </Row>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                if (selectedObject) setCameraField(cam.id, 'target', selectedObject.transform.position)
              }}
              disabled={!selectedObject}
              className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-40"
            >
              看向选中对象
            </button>
            <button
              onClick={() => addCamera()}
              className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs hover:bg-white/10"
            >
              添加机位
            </button>
            <button
              onClick={() => removeCamera(cam.id)}
              disabled={cameras.length <= 1}
              className="rounded border border-red-400/30 bg-red-500/15 px-2 py-1 text-xs text-red-300 hover:bg-red-500/25 disabled:opacity-40"
            >
              删除机位
            </button>
            <button
              onClick={() => setActiveCamera(cam.id)}
              disabled={cam.id === activeId}
              className="rounded border border-amber-400/40 bg-amber-500/20 px-2 py-1 text-xs text-amber-200 hover:bg-amber-500/30 disabled:opacity-40"
            >
              设为激活
            </button>
          </div>
        </div>
      )}

      {tab === 'shots' && (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <button
              onClick={() => void doCapture()}
              disabled={capturing}
              className="flex-1 rounded bg-blue-500/80 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {capturing ? '截取中…' : '截取当前机位'}
            </button>
            <button
              onClick={bindAllCaptures}
              disabled={captures.length === 0}
              className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10 disabled:opacity-40"
            >
              📌 全部绑定
            </button>
          </div>
          {captures.length === 0 ? (
            <div className="text-xs text-white/40">暂无截图，点击上方按钮截取当前机位</div>
          ) : (
            <div className="flex flex-col gap-2">
              {captures.map((cap) => (
                <div key={cap.id} className={`rounded border bg-white/5 p-2 ${cap.isBound ? 'border-emerald-400/30' : 'border-white/10'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cap.dataUrl} alt={cap.name} className="mb-1 max-h-32 w-full rounded object-contain" />
                  <input
                    value={cap.name}
                    onChange={(e) => setCaptureName(cam.id, cap.id, e.target.value)}
                    className="mb-1 w-full rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-[11px] outline-none focus:border-white/30"
                  />
                  <input
                    placeholder="备注"
                    value={cap.note ?? ''}
                    onChange={(e) => setCaptureNote(cam.id, cap.id, e.target.value)}
                    className="mb-1 w-full rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-[11px] outline-none focus:border-white/30"
                  />
                  <div className="flex flex-wrap gap-1">
                    <button
                      onClick={() => toggleCaptureBound(cam.id, cap.id)}
                      className={`rounded border px-1.5 py-0.5 text-[10px] ${cap.isBound ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-200' : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'}`}
                    >
                      {cap.isBound ? '📌 已绑定' : '绑定'}
                    </button>
                    <button
                      onClick={() => toggleCaptureActive(cam.id, cap.id)}
                      className={`rounded border px-1.5 py-0.5 text-[10px] ${cap.isActiveStar ? 'border-amber-400/50 bg-amber-500/25 text-amber-200' : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'}`}
                    >
                      {cap.isActiveStar ? '★ 主机位' : '☆ 设为主机位'}
                    </button>
                    <a
                      href={cap.dataUrl}
                      download={`${cap.name || 'shot'}.jpg`}
                      className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/60 hover:bg-white/10"
                    >
                      下载
                    </a>
                    <button
                      onClick={() => removeCameraCapture(cam.id, cap.id)}
                      className="rounded border border-red-400/30 bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-500/25"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] leading-relaxed text-white/40">
            提示：绑定（📌）的截图会随保存发送到 AI 出图，设为主机位（★）的作为构图最优先参考。每个机位可绑定多张不同角度的截图。
          </p>
        </div>
      )}
    </div>
  )
}
