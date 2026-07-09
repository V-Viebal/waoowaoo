/**
 * Director Desk — zustand store.
 * In-memory only: persists via save API; undo/redo capped at 50.
 */
import { create } from 'zustand'
import type { DirectorProject, DirectorObject, DirectorCamera, DirectorSceneSettings } from '@/lib/director-desk/schema'
import { createDefaultDirectorProject } from '@/lib/director-desk/schema'

interface LoadedPanel {
  directorLayout: unknown
  directorShots?: Array<{ id?: string; cameraId: string; name: string; isActive: boolean; imageUrl: string; imageMediaId?: string | null; note?: string; fov: number; pos: [number,number,number]; target: [number,number,number] }>
  characters: Array<{ imageMediaId?: string | null; imageUrl?: string | null }>
  props: Array<{ imageMediaId?: string | null; imageUrl?: string | null }>
  location?: { imageUrl?: string | null } | null
}

export interface CameraCapture {
  id: string
  dataUrl: string
  isBound: boolean
  isActiveStar: boolean
  name: string
  note?: string
  capturedAt: number
  /** Set for shots hydrated from DB so save can retain/update them without re-uploading. */
  persistedShotId?: string
  persistedImageMediaId?: string
  /** DB camera fields (fov/pos/target) at time of hydration, for save fallback if camera moved. */
  persistedFov?: number
  persistedPos?: [number, number, number]
  persistedTarget?: [number, number, number]
}

interface DirectorState {
  project: DirectorProject
  selectedId: string | null
  viewMode: 'director' | 'camera'
  transformMode: 'translate' | 'rotate' | 'scale'
  isDirty: boolean
  history: DirectorProject[]
  future: DirectorProject[]
  panelId: string
  projectId: string
  videoRatio: string
  loaded: boolean
  glCanvas: HTMLCanvasElement | null
  cameraCaptures: Record<string, CameraCapture[]>

  load: (project: DirectorProject, panelId: string, projectId: string, videoRatio: string, boundShots?: Array<{cameraId:string;name:string;isActive:boolean;imageUrl:string;note?:string;fov:number;pos:[number,number,number];target:[number,number,number]}>) => void
  reset: () => void
  select: (id: string | null) => void
  setViewMode: (m: 'director' | 'camera') => void
  /** Silent: set viewMode without pushing undo history (used for temporary capture view switches). */
  setViewModeSilent: (m: 'director' | 'camera') => void
  setTransformMode: (m: 'translate' | 'rotate' | 'scale') => void
  setSceneField: <K extends keyof DirectorSceneSettings>(k: K, v: DirectorSceneSettings[K]) => void
  setObjectField: <K extends keyof DirectorObject>(id: string, k: K, v: DirectorObject[K]) => void
  setObjectTransform: (id: string, t: DirectorObject['transform']) => void
  addObject: (partial: Partial<DirectorObject> & { kind: DirectorObject['kind']; name: string }) => string
  duplicateObject: (id: string) => string | null
  removeObject: (id: string) => void
  addCamera: (partial?: Partial<DirectorCamera>) => string
  removeCamera: (id: string) => void
  setCameraField: <K extends keyof DirectorCamera>(id: string, k: K, v: DirectorCamera[K]) => void
  setActiveCamera: (id: string) => void
  /** Silent: set active camera without pushing undo history (used for temporary capture switches). */
  setActiveCameraSilent: (id: string) => void
  addCameraCapture: (cameraId: string, dataUrl: string, name?: string) => string
  toggleCaptureBound: (cameraId: string, captureId: string) => void
  toggleCaptureActive: (cameraId: string, captureId: string) => void
  setCaptureName: (cameraId: string, captureId: string, name: string) => void
  setCaptureNote: (cameraId: string, captureId: string, note: string) => void
  removeCameraCapture: (cameraId: string, captureId: string) => void
  bindAllCaptures: () => void
  clearBoundCaptures: () => void
  hydrateBoundShots: (shots: Array<{id?:string;cameraId:string;name:string;isActive:boolean;imageUrl:string;imageMediaId?:string|null;note?:string;fov?:number;pos?:[number,number,number];target?:[number,number,number]}>) => void
  setGlCanvas: (canvas: HTMLCanvasElement | null) => void
  undo: () => void
  redo: () => void
}

function uid(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

function pushHistory(state: DirectorState, next: DirectorProject): Partial<DirectorState> {
  const history = [...state.history, clone(state.project)].slice(-50)
  return { project: next, history, future: [], isDirty: true }
}

export const useDirectorStore = create<DirectorState>((set, get) => ({
  project: createDefaultDirectorProject(),
  selectedId: null,
  viewMode: 'director',
  transformMode: 'translate',
  isDirty: false,
  history: [],
  future: [],
  panelId: '',
  projectId: '',
  videoRatio: '9:16',
  loaded: false,
  glCanvas: null,
  cameraCaptures: {},

  load(project, panelId, projectId, videoRatio, boundShots) {
    const cameraCaptures: Record<string, CameraCapture[]> = {}
    if (boundShots) {
      for (const s of boundShots) {
        const cap: CameraCapture = {
          id: uid('cap'),
          dataUrl: s.imageUrl,
          isBound: true,
          isActiveStar: !!s.isActive,
          name: s.name || '机位',
          note: s.note,
          capturedAt: Date.now(),
          persistedShotId: (s as { id?: string }).id,
          persistedImageMediaId: (s as { imageMediaId?: string | null }).imageMediaId ?? undefined,
          persistedFov: s.fov,
          persistedPos: s.pos,
          persistedTarget: s.target,
        }
        if (!cameraCaptures[s.cameraId]) cameraCaptures[s.cameraId] = []
        cameraCaptures[s.cameraId].push(cap)
      }
    }
    set({
      project: clone(project),
      panelId,
      projectId,
      videoRatio,
      loaded: true,
      isDirty: false,
      history: [],
      future: [],
      selectedId: null,
      viewMode: 'director',
      cameraCaptures,
    })
  },

  async reset() {
    // Caller reloads from API; for now just mark not dirty and clear history (actual reload is page-level)
    const { panelId, projectId } = get()
    try {
      const res = await fetch(`/api/novel-promotion/${projectId}/director-desk/load?panelId=${encodeURIComponent(panelId)}`)
      if (!res.ok) return
      const data = await res.json() as {
        panel: LoadedPanel
        project: { videoRatio: string }
      }
      const { initDirectorProjectFromPanel } = await import('@/lib/director-desk/init')
      const { parseDirectorProject } = await import('@/lib/director-desk/schema')
      const parsed = data.panel.directorLayout ? parseDirectorProject(data.panel.directorLayout) : null
      const proj: DirectorProject = parsed
        ?? initDirectorProjectFromPanel({ panel: data.panel as unknown as Parameters<typeof initDirectorProjectFromPanel>[0]['panel'], project: data.project })
      // Re-inject signed imageUrls onto objects (not persisted)
      for (const o of proj.objects) {
        const ch = data.panel.characters.find((c) => c.imageMediaId === o.refId)
        const pr = data.panel.props.find((p) => p.imageMediaId === o.refId)
        const url = ch?.imageUrl ?? pr?.imageUrl ?? null
        if (url) o.imageUrl = url
      }
      // Set backdrop signed url
      if (data.panel.location?.imageUrl) {
        proj.scene.backdropImageUrl = data.panel.location.imageUrl
      }
      set({
        project: proj, history: [], future: [], isDirty: false, selectedId: null, viewMode: 'director',
        cameraCaptures: buildCapturesFromShots(data.panel.directorShots ?? []),
      })
    } catch (e) {
      console.error('reset failed', e)
    }
  },

  select(id) { set({ selectedId: id }) },
  setViewMode(m) { set({ viewMode: m }) },
  setViewModeSilent(m) { set({ viewMode: m }) },
  setTransformMode(m) { set({ transformMode: m }) },
  setGlCanvas(canvas) { set({ glCanvas: canvas }) },

  setSceneField(k, v) {
    const { project } = get()
    const next = clone(project)
    next.scene[k] = v
    set(pushHistory(get(), next))
  },

  setObjectField(id, k, v) {
    const { project } = get()
    const next = clone(project)
    const o = next.objects.find(x => x.id === id)
    if (!o) return
    ;(o as Record<keyof DirectorObject, unknown>)[k] = v
    set(pushHistory(get(), next))
  },

  setObjectTransform(id, t) {
    const { project } = get()
    const next = clone(project)
    const o = next.objects.find(x => x.id === id)
    if (!o) return
    o.transform = t
    set(pushHistory(get(), next))
  },

  addObject(partial) {
    const { project } = get()
    const next = clone(project)
    const id = uid(partial.kind)
    // omit caller-provided id (we generate our own); build rest without it
    const { id: _unusedId, ...partialRest } = partial as Partial<DirectorObject> & { id?: string }
    void _unusedId
    const newObj: DirectorObject = {
      kind: partial.kind,
      name: partial.name,
      refId: partial.refId ?? null,
      visible: partial.visible ?? true,
      locked: partial.locked ?? false,
      color: partial.color ?? '#7AA7FF',
      mode: partial.mode ?? 'billboard',
      transform: partial.transform ?? { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      ...partialRest,
      id,
    }
    next.objects.push(newObj)
    set(pushHistory(get(), next))
    set({ selectedId: id })
    return id
  },

  duplicateObject(id) {
    const { project } = get()
    const src = project.objects.find(o => o.id === id)
    if (!src) return null
    const next = clone(project)
    const newId = uid(src.kind)
    const copy: DirectorObject = {
      ...clone(src),
      id: newId,
      name: src.name + ' 副本',
      transform: {
        ...src.transform,
        position: [src.transform.position[0] + 1, src.transform.position[1], src.transform.position[2]],
      },
    }
    next.objects.push(copy)
    set(pushHistory(get(), next))
    set({ selectedId: newId })
    return newId
  },

  removeObject(id) {
    const { project, selectedId } = get()
    const next = clone(project)
    next.objects = next.objects.filter(o => o.id !== id)
    set({ ...pushHistory(get(), next), selectedId: selectedId === id ? null : selectedId })
  },

  addCamera(partial) {
    const { project } = get()
    const next = clone(project)
    const id = uid('cam')
    const newCam: DirectorCamera = {
      id,
      name: partial?.name ?? `机位 ${next.cameras.length + 1}`,
      fov: partial?.fov ?? 50,
      position: partial?.position ?? [0, 1.55, 5.4],
      target: partial?.target ?? [0, 1.05, 0],
      visible: true,
    }
    next.cameras.push(newCam)
    set(pushHistory(get(), next))
    set({ selectedId: id })
    return id
  },

  removeCamera(id) {
    const { project } = get()
    if (project.cameras.length <= 1) return
    const next = clone(project)
    next.cameras = next.cameras.filter(c => c.id !== id)
    if (next.activeCameraId === id) next.activeCameraId = next.cameras[0].id
    set(pushHistory(get(), next))
  },

  setCameraField(id, k, v) {
    const { project } = get()
    const next = clone(project)
    const c = next.cameras.find(x => x.id === id)
    if (!c) return
    ;(c as Record<keyof DirectorCamera, unknown>)[k] = v
    set(pushHistory(get(), next))
  },

  setActiveCamera(id) {
    const { project } = get()
    if (!project.cameras.find(c => c.id === id)) return
    const next = clone(project)
    next.activeCameraId = id
    set(pushHistory(get(), next))
  },

  setActiveCameraSilent(id) {
    const { project } = get()
    if (!project.cameras.find(c => c.id === id)) return
    set({ project: { ...project, activeCameraId: id } })
  },

  addCameraCapture(cameraId, dataUrl, name) {
    const { cameraCaptures } = get()
    const capId = uid('cap')
    const list = [...(cameraCaptures[cameraId] ?? [])]
    list.push({ id: capId, dataUrl, isBound: false, isActiveStar: list.length === 0, name: name ?? `截图 ${list.length + 1}`, capturedAt: Date.now() })
    set({ cameraCaptures: { ...cameraCaptures, [cameraId]: list }, isDirty: true })
    return capId
  },

  toggleCaptureBound(cameraId, captureId) {
    const { cameraCaptures } = get()
    const list = [...(cameraCaptures[cameraId] ?? [])]
    const cap = list.find(c => c.id === captureId)
    if (!cap) return
    cap.isBound = !cap.isBound
    set({ cameraCaptures: { ...cameraCaptures, [cameraId]: list }, isDirty: true })
  },

  toggleCaptureActive(cameraId, captureId) {
    const { cameraCaptures } = get()
    const next: Record<string, CameraCapture[]> = {}
    for (const [cId, caps] of Object.entries(cameraCaptures)) {
      next[cId] = caps.map(c => ({ ...c, isActiveStar: c.id === captureId && cId === cameraId }))
    }
    set({ cameraCaptures: next, isDirty: true })
  },

  setCaptureName(cameraId, captureId, name) {
    const { cameraCaptures } = get()
    const list = [...(cameraCaptures[cameraId] ?? [])]
    const cap = list.find(c => c.id === captureId)
    if (!cap) return
    cap.name = name
    set({ cameraCaptures: { ...cameraCaptures, [cameraId]: list }, isDirty: true })
  },

  setCaptureNote(cameraId, captureId, note) {
    const { cameraCaptures } = get()
    const list = [...(cameraCaptures[cameraId] ?? [])]
    const cap = list.find(c => c.id === captureId)
    if (!cap) return
    cap.note = note
    set({ cameraCaptures: { ...cameraCaptures, [cameraId]: list }, isDirty: true })
  },

  removeCameraCapture(cameraId, captureId) {
    const { cameraCaptures } = get()
    // Drop from store entirely. Save uses deleteMany+createMany so only the
    // currently-bound list (which excludes removed entries) is recreated.
    const list = (cameraCaptures[cameraId] ?? []).filter(c => c.id !== captureId)
    set({ cameraCaptures: { ...cameraCaptures, [cameraId]: list }, isDirty: true })
  },

  bindAllCaptures() {
    const { cameraCaptures } = get()
    const next: Record<string, CameraCapture[]> = {}
    for (const [cId, caps] of Object.entries(cameraCaptures)) {
      next[cId] = caps.map(c => ({ ...c, isBound: true }))
    }
    set({ cameraCaptures: next, isDirty: true })
  },

  clearBoundCaptures() {
    const { cameraCaptures } = get()
    const next: Record<string, CameraCapture[]> = {}
    for (const [cId, caps] of Object.entries(cameraCaptures)) {
      next[cId] = caps.filter(c => !!c.persistedShotId).map(c => ({ ...c, isBound: false }))
    }
    set({ cameraCaptures: next })
  },

  hydrateBoundShots(shots) {
    set({ cameraCaptures: buildCapturesFromShots(shots) })
  },

  undo() {
    const { history, future, project } = get()
    if (history.length === 0) return
    const prev = history[history.length - 1]
    set({
      project: clone(prev),
      history: history.slice(0, -1),
      future: [clone(project), ...future],
      isDirty: true,
    })
  },

  redo() {
    const { history, future, project } = get()
    if (future.length === 0) return
    const next = future[0]
    set({
      project: clone(next),
      history: [...history, clone(project)],
      future: future.slice(1),
      isDirty: true,
    })
  },
}))

function buildCapturesFromShots(shots: Array<{id?:string;cameraId:string;name:string;isActive:boolean;imageUrl:string;imageMediaId?:string|null;note?:string;fov?:number;pos?:[number,number,number];target?:[number,number,number]}>): Record<string, CameraCapture[]> {
  const out: Record<string, CameraCapture[]> = {}
  for (const s of shots) {
    if (!out[s.cameraId]) out[s.cameraId] = []
    out[s.cameraId].push({
      id: uid('cap'),
      dataUrl: s.imageUrl,
      isBound: true,
      isActiveStar: !!s.isActive,
      name: s.name || '机位',
      note: s.note,
      capturedAt: Date.now(),
      persistedShotId: s.id,
      persistedImageMediaId: s.imageMediaId ?? undefined,
      persistedFov: s.fov,
      persistedPos: s.pos,
      persistedTarget: s.target,
    })
  }
  return out
}
