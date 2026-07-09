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

export function CrowdPanel({ object }: { object: DirectorObject }) {
  const setObjectField = useDirectorStore((s) => s.setObjectField)
  const removeObject = useDirectorStore((s) => s.removeObject)
  const cols = object.crowdCount?.[0] ?? 2
  const rows = object.crowdCount?.[1] ?? 3
  const sx = object.crowdSpacing?.[0] ?? 0.8
  const sz = object.crowdSpacing?.[1] ?? 0.8

  return (
    <div className="flex flex-col gap-3 text-xs text-white/80">
      <div className="text-sm font-medium">群演 · {object.name}</div>
      <Row label="名称">
        <input
          value={object.name}
          onChange={(e) => setObjectField(object.id, 'name', e.target.value)}
          className="w-full rounded border border-white/10 bg-white/5 px-1.5 py-1 text-xs outline-none focus:border-white/30"
        />
      </Row>
      <Row label="列数">
        <input
          type="number"
          min={1}
          max={10}
          value={cols}
          onChange={(e) => setObjectField(object.id, 'crowdCount', [Math.max(1, Number(e.target.value) || 1), rows])}
          className="w-full rounded border border-white/10 bg-white/5 px-1.5 py-1 text-xs outline-none focus:border-white/30"
        />
      </Row>
      <Row label="行数">
        <input
          type="number"
          min={1}
          max={10}
          value={rows}
          onChange={(e) => setObjectField(object.id, 'crowdCount', [cols, Math.max(1, Number(e.target.value) || 1)])}
          className="w-full rounded border border-white/10 bg-white/5 px-1.5 py-1 text-xs outline-none focus:border-white/30"
        />
      </Row>
      <Row label="X 间距">
        <input
          type="range"
          min={0.3}
          max={3}
          step={0.05}
          value={sx}
          onChange={(e) => setObjectField(object.id, 'crowdSpacing', [Number(e.target.value), sz])}
          className="w-full"
        />
      </Row>
      <Row label="Z 间距">
        <input
          type="range"
          min={0.3}
          max={3}
          step={0.05}
          value={sz}
          onChange={(e) => setObjectField(object.id, 'crowdSpacing', [sx, Number(e.target.value)])}
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
