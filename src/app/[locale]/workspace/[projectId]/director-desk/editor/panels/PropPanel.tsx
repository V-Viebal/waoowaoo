'use client'
import { useDirectorStore } from '../store/directorStore'
import type { DirectorObject } from '@/lib/director-desk/schema'

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

export function PropPanel({ object }: { object: DirectorObject }) {
  const setObjectField = useDirectorStore((s) => s.setObjectField)
  const setObjectTransform = useDirectorStore((s) => s.setObjectTransform)
  const removeObject = useDirectorStore((s) => s.removeObject)

  return (
    <div className="flex flex-col gap-3 text-xs text-white/80">
      <div className="text-sm font-medium">道具 · {object.name}</div>
      <Row label="名称">
        <input
          value={object.name}
          onChange={(e) => setObjectField(object.id, 'name', e.target.value)}
          className="w-full rounded border border-white/10 bg-white/5 px-1.5 py-1 text-xs outline-none focus:border-white/30"
        />
      </Row>
      <Row label="位置">
        <Triplet value={object.transform.position} onChange={(v) => setObjectTransform(object.id, { ...object.transform, position: v })} />
      </Row>
      <Row label="缩放">
        <input
          type="range"
          min={0.2}
          max={3}
          step={0.1}
          value={object.transform.scale[0]}
          onChange={(e) => {
            const s = Number(e.target.value)
            setObjectTransform(object.id, { ...object.transform, scale: [s, s, s] })
          }}
          className="w-full"
        />
      </Row>
      <Row label="颜色">
        <input
          type="color"
          value={object.color}
          onChange={(e) => setObjectField(object.id, 'color', e.target.value)}
          className="h-6 w-full cursor-pointer rounded border border-white/10 bg-transparent"
        />
      </Row>
      <button
        onClick={() => removeObject(object.id)}
        className="mt-2 rounded border border-red-400/30 bg-red-500/15 px-2 py-1 text-xs text-red-300 hover:bg-red-500/25"
      >
        删除
      </button>
    </div>
  )
}
