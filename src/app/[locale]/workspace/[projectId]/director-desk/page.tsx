'use client'
import { useParams, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { DirectorDeskShell } from './editor/DirectorDeskShell'
import { useDirectorStore } from './editor/store/directorStore'
import { initDirectorProjectFromPanel } from '@/lib/director-desk/init'
import type { DirectorProject } from '@/lib/director-desk/schema'

interface LoadResponse {
  panel: {
    id: string
    characters: Array<{ imageMediaId: string | null; imageUrl: string | null; name: string; appearance: string | null; slot: string | null }>
    props: Array<{ imageMediaId: string | null; imageUrl: string | null; name: string }>
    location: { imageUrl: string | null; imageMediaId: string | null; name: string; availableSlots: unknown } | null
    directorLayout: DirectorProject | null
    directorShots: Array<{ id: string; cameraId: string; name: string; isActive: boolean; imageUrl: string | null; imageMediaId: string | null; note: string | null; fov: number; pos: [number, number, number]; target: [number, number, number] }>
    photographyRules?: unknown
    shotType?: string
    cameraMove?: string
    description?: string
  }
  project: { videoRatio: string }
}

export default function DirectorDeskPage() {
  const params = useParams<{ projectId?: string; locale?: string }>()
  const searchParams = useSearchParams()
  const t = useTranslations('storyboard.directorDesk')
  const load = useDirectorStore((s) => s.load)
  const loaded = useDirectorStore((s) => s.loaded)
  const [error, setError] = useState<string | null>(null)
  const projectId = params?.projectId
  const panelId = searchParams?.get('panelId')

  useEffect(() => {
    if (!projectId || !panelId) {
      setError('missingPanelId')
      return
    }
    let aborted = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/novel-promotion/${projectId}/director-desk/load?panelId=${encodeURIComponent(panelId)}`,
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: LoadResponse = await res.json()
        if (aborted) return
        const proj: DirectorProject =
          data.panel.directorLayout ??
          initDirectorProjectFromPanel({
            panel: data.panel as unknown as Parameters<typeof initDirectorProjectFromPanel>[0]['panel'],
            project: data.project,
          })
        for (const o of proj.objects) {
          const ch = data.panel.characters.find((c) => c.imageMediaId === o.refId)
          const pr = data.panel.props.find((p) => p.imageMediaId === o.refId)
          const url = ch?.imageUrl ?? pr?.imageUrl ?? null
          if (url) o.imageUrl = url
        }
        if (data.panel.location?.imageUrl) {
          proj.scene.backdropImageUrl = data.panel.location.imageUrl
        }
        // Keep all shots returned by server: shots with imageUrl render in UI;
        // shots with only imageMediaId (signed URL generation failed) are still
        // tracked by persistedShotId so save retains them (see #1 data-loss risk).
        const boundShots = data.panel.directorShots
          .filter((s) => s.imageUrl || s.imageMediaId)
          .map((s) => ({
            id: s.id,
            cameraId: s.cameraId,
            name: s.name,
            isActive: s.isActive,
            imageUrl: s.imageUrl ?? '',
            imageMediaId: s.imageMediaId,
            note: s.note ?? undefined,
            fov: s.fov,
            pos: s.pos,
            target: s.target,
          }))
        load(proj, panelId, projectId, data.project.videoRatio, boundShots)
      } catch (e) {
        if (!aborted) setError(String(e))
      }
    })()
    return () => {
      aborted = true
    }
  }, [projectId, panelId, load])

  if (error) {
    let text: string = error
    try {
      const msg = t(error as Parameters<typeof t>[0])
      if (msg) text = msg
    } catch {
      /* not a known key */
    }
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0f1216] text-red-400">
        {text}
      </div>
    )
  }
  if (!loaded) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0f1216] text-gray-400">
        {t('loading')}
      </div>
    )
  }
  return <DirectorDeskShell />
}
