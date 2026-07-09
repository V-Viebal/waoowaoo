'use client'
import { useMemo, useState } from 'react'
import { useDirectorStore } from '../store/directorStore'
import type { DirectorObject } from '@/lib/director-desk/schema'

interface RowProps {
  id: string
  name: string
  color: string
  visible: boolean
  locked?: boolean
  selected: boolean
  showLock?: boolean
  onSelect: () => void
  onToggleVisible: () => void
  onToggleLock?: () => void
  onRename: (v: string) => void
}

function Row({ id, name, color, visible, locked, selected, showLock, onSelect, onToggleVisible, onToggleLock, onRename }: RowProps) {
  return (
    <div
      onClick={onSelect}
      onDoubleClick={(e) => {
        e.stopPropagation()
        const next = window.prompt('重命名', name)
        if (next && next.trim()) onRename(next.trim())
      }}
      className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs cursor-pointer ${selected ? 'bg-white/10' : 'hover:bg-white/5'}`}
      title={id}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className={`flex-1 truncate ${visible ? '' : 'text-white/40'}`}>{name}</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onToggleVisible()
        }}
        className="text-white/50 hover:text-white"
        title={visible ? '隐藏' : '显示'}
      >
        {visible ? '👁' : '⃠'}
      </button>
      {showLock && onToggleLock && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleLock()
          }}
          className="text-white/50 hover:text-white"
          title={locked ? '解锁' : '锁定'}
        >
          {locked ? '🔒' : '🔓'}
        </button>
      )}
    </div>
  )
}

export function ObjectTreePanel() {
  const objects = useDirectorStore((s) => s.project.objects)
  const cameras = useDirectorStore((s) => s.project.cameras)
  const selectedId = useDirectorStore((s) => s.selectedId)
  const select = useDirectorStore((s) => s.select)
  const setObjectField = useDirectorStore((s) => s.setObjectField)
  const setCameraField = useDirectorStore((s) => s.setCameraField)
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    const match = (name: string) => !term || name.toLowerCase().includes(term)
    const characters = objects.filter((o) => o.kind === 'character' && match(o.name))
    const crowds = objects.filter((o) => o.kind === 'crowd' && match(o.name))
    const props = objects.filter((o) => o.kind === 'prop' && match(o.name))
    const cams = cameras.filter((c) => match(c.name))
    return { characters, crowds, props, cams }
  }, [objects, cameras, q])

  const renderGroup = (title: string, list: DirectorObject[]) => (
    <div className="mb-2">
      <div className="mb-1 px-1 text-[10px] uppercase tracking-wider text-white/40">{title}</div>
      {list.length === 0 ? (
        <div className="px-1.5 text-[10px] text-white/30">空</div>
      ) : (
        list.map((o) => (
          <Row
            key={o.id}
            id={o.id}
            name={o.name}
            color={o.color}
            visible={o.visible}
            locked={o.locked}
            selected={selectedId === o.id}
            showLock
            onSelect={() => select(o.id)}
            onToggleVisible={() => setObjectField(o.id, 'visible', !o.visible)}
            onToggleLock={() => setObjectField(o.id, 'locked', !o.locked)}
            onRename={(v) => setObjectField(o.id, 'name', v)}
          />
        ))
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-2 text-white/80">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索..."
        className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs outline-none focus:border-white/30"
      />
      {renderGroup('角色', filtered.characters)}
      {renderGroup('群演', filtered.crowds)}
      {renderGroup('道具', filtered.props)}
      <div className="mb-2">
        <div className="mb-1 px-1 text-[10px] uppercase tracking-wider text-white/40">机位</div>
        {filtered.cams.length === 0 ? (
          <div className="px-1.5 text-[10px] text-white/30">空</div>
        ) : (
          filtered.cams.map((c) => (
            <Row
              key={c.id}
              id={c.id}
              name={c.name}
              color="#A9D8FF"
              visible={c.visible !== false}
              selected={selectedId === c.id}
              onSelect={() => select(c.id)}
              onToggleVisible={() => setCameraField(c.id, 'visible', !(c.visible !== false))}
              onRename={(v) => setCameraField(c.id, 'name', v)}
            />
          ))
        )}
      </div>
      <div className="mt-2 border-t border-white/10 pt-2 text-[10px] leading-relaxed text-white/40">
        Q/W 平移 · E 旋转 · R 缩放
        <br />
        Del 删除 · Ctrl+Z 撤销
      </div>
    </div>
  )
}
