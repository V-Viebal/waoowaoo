'use client'
import { useDirectorStore } from './directorStore'

export const useSelectedObject = () =>
  useDirectorStore(s => {
    if (!s.selectedId) return null
    return s.project.objects.find(o => o.id === s.selectedId) ?? null
  })

export const useActiveCamera = () =>
  useDirectorStore(s => s.project.cameras.find(c => c.id === s.project.activeCameraId) ?? s.project.cameras[0] ?? null)

export const useSelectedCamera = () =>
  useDirectorStore(s => {
    if (!s.selectedId) return null
    return s.project.cameras.find(c => c.id === s.selectedId) ?? null
  })

export function getActiveCameraSnapshot() {
  const s = useDirectorStore.getState()
  return s.project.cameras.find(c => c.id === s.project.activeCameraId) ?? s.project.cameras[0] ?? null
}

export interface SaveShot {
  cameraId: string
  name: string
  isActive: boolean
  fov: number
  position: [number, number, number]
  target: [number, number, number]
  note?: string
  /** New captures: dataURL to upload. Empty for persisted shots (existingImageMediaId used). */
  snapshotDataUrl: string
  /** Set for shots previously saved to DB so server can update instead of recreate. */
  existingShotId?: string
}

/**
 * Collect all currently-bound captures for save.
 * - New captures (data: URLs) will be JPEG-uploaded.
 * - Persisted captures (signed https URLs from load) reuse their existingImageMediaId.
 * The server does deleteMany+createMany so unbound/removed captures are dropped.
 */
export function collectBoundShotsForSave(): SaveShot[] {
  const s = useDirectorStore.getState()
  const shots: SaveShot[] = []
  for (const [cameraId, caps] of Object.entries(s.cameraCaptures)) {
    for (const cap of caps) {
      if (!cap.isBound) continue
      const cam = s.project.cameras.find(c => c.id === cameraId)
      // Fall back to persisted camera pose if the camera was deleted from project
      const fov = cam?.fov ?? cap.persistedFov ?? 50
      const position = (cam?.position ?? cap.persistedPos ?? [0, 1.55, 5.4]) as [number, number, number]
      const target = (cam?.target ?? cap.persistedTarget ?? [0, 1.05, 0]) as [number, number, number]
      if (cap.persistedShotId) {
        shots.push({
          cameraId,
          name: cap.name || (cam?.name ?? '机位'),
          isActive: cap.isActiveStar,
          fov, position, target,
          note: cap.note,
          snapshotDataUrl: '',
          existingShotId: cap.persistedShotId,
        })
      } else if (cap.dataUrl.startsWith('data:')) {
        shots.push({
          cameraId,
          name: cap.name || (cam?.name ?? '机位'),
          isActive: cap.isActiveStar,
          fov, position, target,
          note: cap.note,
          snapshotDataUrl: cap.dataUrl,
        })
      }
      // Signed https URLs from load that somehow lost persistedImageMediaId: skip
    }
  }
  // Normalize: exactly one active (first encountered wins); default first if none.
  if (shots.length > 0 && !shots.some(x => x.isActive)) shots[0].isActive = true
  let seenActive = false
  for (const x of shots) {
    if (x.isActive) {
      if (seenActive) x.isActive = false
      else seenActive = true
    }
  }
  return shots
}
