'use client'
import { useEffect } from 'react'
import { useDirectorStore } from './store/directorStore'
import { TopBar } from './TopBar'
import { DirectorCanvas } from './canvas/DirectorCanvas'
import { ObjectTreePanel } from './panels/ObjectTreePanel'
import { RightPanel } from './panels/RightPanel'

export function DirectorDeskShell() {
  const undo = useDirectorStore((s) => s.undo)
  const redo = useDirectorStore((s) => s.redo)
  const selectedId = useDirectorStore((s) => s.selectedId)
  const removeObject = useDirectorStore((s) => s.removeObject)
  const setTransformMode = useDirectorStore((s) => s.setTransformMode)
  const duplicateObject = useDirectorStore((s) => s.duplicateObject)
  const isDirty = useDirectorStore((s) => s.isDirty)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
        return
      }
      if ((ctrl && e.key.toLowerCase() === 'y') || (ctrl && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault()
        redo()
        return
      }
      if (ctrl && e.key.toLowerCase() === 'c' && selectedId) {
        // simple copy = immediate duplicate (we don't have a paste buffer)
        return
      }
      if (ctrl && e.key.toLowerCase() === 'v' && selectedId) {
        e.preventDefault()
        duplicateObject(selectedId)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        removeObject(selectedId)
        return
      }
      if (e.key === 'q' || e.key === 'Q' || e.key === 'w' || e.key === 'W') {
        setTransformMode('translate')
      } else if (e.key === 'e' || e.key === 'E') {
        setTransformMode('rotate')
      } else if (e.key === 'r' || e.key === 'R') {
        setTransformMode('scale')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo, selectedId, removeObject, setTransformMode, duplicateObject])

  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  return (
    <div className="flex h-screen w-screen flex-col bg-[#0f1216] text-gray-100">
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <aside className="w-[220px] shrink-0 overflow-auto border-r border-white/10 p-2">
          <ObjectTreePanel />
        </aside>
        <main className="relative flex-1 min-w-0">
          <DirectorCanvas />
        </main>
        <aside className="w-[300px] shrink-0 overflow-auto border-l border-white/10 p-2">
          <RightPanel />
        </aside>
      </div>
    </div>
  )
}
