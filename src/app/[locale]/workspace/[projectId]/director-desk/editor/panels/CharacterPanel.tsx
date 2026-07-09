'use client'
import { useState } from 'react'
import { useDirectorStore } from '../store/directorStore'
import { BODY_TYPE_IDS, POSE_PRESET_IDS, POSE_ZH } from '@/lib/director-desk/schema'
import type { DirectorObject } from '@/lib/director-desk/schema'

const BODY_LABEL: Record<string, string> = {
  mannequin: '男性',
  female: '女性',
  broad: '宽厚',
  muscular: '健壮',
  slim: '纤细',
  teen: '少年',
  child: '儿童',
  chibi: '二头身',
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-white/70">
      <span className="w-16 shrink-0">{label}</span>
      <div className="flex-1">{children}</div>
    </label>
  )
}

function TripletInput({
  value,
  onChange,
  step = 0.1,
}: {
  value: [number, number, number]
  onChange: (v: [number, number, number]) => void
  step?: number
}) {
  const inputCls = 'w-full rounded border border-white/10 bg-white/5 px-1.5 py-1 text-xs outline-none focus:border-white/30'
  return (
    <div className="grid grid-cols-3 gap-1">
      {(['X', 'Y', 'Z'] as const).map((lbl, i) => (
        <label key={lbl} className="flex items-center gap-1">
          <span className="w-3 text-[10px] text-white/40">{lbl}</span>
          <input
            type="number"
            step={step}
            value={value[i]}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n)) return
              const next: [number, number, number] = [value[0], value[1], value[2]]
              next[i] = n
              onChange(next)
            }}
            className={inputCls}
          />
        </label>
      ))}
    </div>
  )
}

export function CharacterPanel({ object }: { object: DirectorObject }) {
  const setObjectField = useDirectorStore((s) => s.setObjectField)
  const setObjectTransform = useDirectorStore((s) => s.setObjectTransform)
  const removeObject = useDirectorStore((s) => s.removeObject)
  const duplicateObject = useDirectorStore((s) => s.duplicateObject)
  const [tab, setTab] = useState<'props' | 'pose'>('props')

  return (
    <div className="flex flex-col gap-3 text-xs text-white/80">
      <div className="text-sm font-medium">角色 · {object.name}</div>
      <div className="inline-flex overflow-hidden rounded border border-white/10 text-xs">
        <button
          onClick={() => setTab('props')}
          className={`flex-1 px-3 py-1 ${tab === 'props' ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5'}`}
        >
          属性
        </button>
        {object.mode === 'mannequin' && (
          <button
            onClick={() => setTab('pose')}
            className={`flex-1 px-3 py-1 ${tab === 'pose' ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5'}`}
          >
            姿势
          </button>
        )}
      </div>

      {tab === 'props' && (
        <div className="flex flex-col gap-3">
          <Row label="名称">
            <input
              value={object.name}
              onChange={(e) => setObjectField(object.id, 'name', e.target.value)}
              className="w-full rounded border border-white/10 bg-white/5 px-1.5 py-1 text-xs outline-none focus:border-white/30"
            />
          </Row>
          <Row label="位置">
            <TripletInput
              value={object.transform.position}
              onChange={(pos) => setObjectTransform(object.id, { ...object.transform, position: pos })}
            />
          </Row>
          <Row label="朝向">
            <input
              type="range"
              min={-Math.PI}
              max={Math.PI}
              step={0.05}
              value={object.facing ?? object.transform.rotation[1]}
              onChange={(e) => setObjectField(object.id, 'facing', Number(e.target.value))}
              className="w-full"
            />
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
          <Row label="渲染">
            <div className="inline-flex overflow-hidden rounded border border-white/10">
              <button
                onClick={() => setObjectField(object.id, 'mode', 'billboard')}
                className={`px-3 py-1 ${object.mode === 'billboard' ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5'}`}
              >
                立牌
              </button>
              <button
                onClick={() => setObjectField(object.id, 'mode', 'mannequin')}
                className={`px-3 py-1 ${object.mode === 'mannequin' ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5'}`}
              >
                假人
              </button>
            </div>
          </Row>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => duplicateObject(object.id)}
              className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs hover:bg-white/10"
            >
              复制
            </button>
            <button
              onClick={() => removeObject(object.id)}
              className="rounded border border-red-400/30 bg-red-500/15 px-2 py-1 text-xs text-red-300 hover:bg-red-500/25"
            >
              删除
            </button>
          </div>
        </div>
      )}

      {tab === 'pose' && object.mode === 'mannequin' && (
        <div className="flex flex-col gap-3">
          <div className="text-[11px] text-white/50">体型</div>
          <div className="grid grid-cols-4 gap-1">
            {BODY_TYPE_IDS.map((id) => (
              <button
                key={id}
                onClick={() => setObjectField(object.id, 'bodyType', id)}
                className={`rounded border px-1 py-1 text-[11px] ${
                  (object.bodyType ?? 'mannequin') === id
                    ? 'border-white/40 bg-white/10 text-white'
                    : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
                }`}
              >
                {BODY_LABEL[id]}
              </button>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-white/50">姿势预设</div>
          <div className="grid grid-cols-3 gap-1">
            {POSE_PRESET_IDS.map((id) => (
              <button
                key={id}
                onClick={() => setObjectField(object.id, 'posePresetId', id)}
                className={`rounded border px-1 py-1 text-[11px] ${
                  object.posePresetId === id
                    ? 'border-white/40 bg-white/10 text-white'
                    : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
                }`}
              >
                {POSE_ZH[id] ?? id}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
