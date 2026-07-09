'use client'
import { useDirectorStore } from '../store/directorStore'

async function nextFrames(n = 2) {
  for (let i = 0; i < n; i++) {
    await new Promise((r) => requestAnimationFrame(r))
  }
}

function getTargetAspect(ratio: string): number {
  // width / height
  switch (ratio) {
    case '9:16':
      return 9 / 16
    case '16:9':
      return 16 / 9
    case '1:1':
      return 1
    case '4:3':
      return 4 / 3
    case '3:4':
      return 3 / 4
    default: {
      const m = /^(\d+):(\d+)$/.exec(ratio)
      if (m) return Number(m[1]) / Number(m[2])
      return 9 / 16
    }
  }
}

function cropAndResize(canvas: HTMLCanvasElement, aspect: number, shortEdge = 1024): string {
  const srcW = canvas.width
  const srcH = canvas.height
  let cropW: number
  let cropH: number
  if (srcW / srcH > aspect) {
    // source is wider than target -> crop horizontally
    cropH = srcH
    cropW = Math.round(cropH * aspect)
  } else {
    cropW = srcW
    cropH = Math.round(cropW / aspect)
  }
  const cropX = Math.floor((srcW - cropW) / 2)
  const cropY = Math.floor((srcH - cropH) / 2)

  let outW: number
  let outH: number
  if (aspect >= 1) {
    outH = shortEdge
    outW = Math.round(shortEdge * aspect)
  } else {
    outW = shortEdge
    outH = Math.round(shortEdge / aspect)
  }
  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, outW, outH)
  return out.toDataURL('image/jpeg', 0.88)
}

/**
 * Capture the current camera. Assumes caller has already switched view/active
 * camera and waited for a render, OR is happy with whatever is currently on
 * screen. For a full round-trip, use captureCameraScreenshot.
 */
export async function captureActiveCameraScreenshot(videoRatio: string): Promise<string> {
  await nextFrames(2)
  const canvas = useDirectorStore.getState().glCanvas ?? (document.querySelector('canvas') as HTMLCanvasElement | null)
  if (!canvas) throw new Error('canvas not available')
  return cropAndResize(canvas, getTargetAspect(videoRatio))
}

/**
 * Switch to camera view + target camera, wait for render, capture, restore view mode.
 */
export async function captureCameraScreenshot(videoRatio: string, cameraId?: string): Promise<string> {
  const s = useDirectorStore.getState()
  const prevView = s.viewMode
  const prevActive = s.project.activeCameraId
  const target = cameraId ?? prevActive
  // Use silent setters — temporary view/camera switches must not land in undo history.
  if (target !== prevActive) s.setActiveCameraSilent(target)
  if (prevView !== 'camera') s.setViewModeSilent('camera')
  await nextFrames(3)
  try {
    return await captureActiveCameraScreenshot(videoRatio)
  } finally {
    if (prevView !== 'camera') useDirectorStore.getState().setViewModeSilent(prevView)
    if (target !== prevActive) useDirectorStore.getState().setActiveCameraSilent(prevActive)
  }
}
