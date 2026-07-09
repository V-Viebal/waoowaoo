import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { uploadObject, generateUniqueKey } from '@/lib/storage'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import {
  parseDirectorProject,
  serializeDirectorProject,
  validateDirectorProjectSize,
  type DirectorProject,
} from '@/lib/director-desk/schema'
import { computePhotographyRulesPatch } from '@/lib/director-desk/photography-rules'

interface IncomingShot {
  clientId?: string
  cameraId: string
  name: string
  isActive: boolean
  fov: number
  position: [number, number, number]
  target: [number, number, number]
  note?: string
  snapshotDataUrl: string
  /** When set, update the existing DB shot row (metadata only, no re-upload). */
  existingShotId?: string
}

const MAX_SHOTS = 8
const MAX_DATAURL_BYTES = 5 * 1024 * 1024

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  if (typeof dataUrl !== 'string') return null
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl)
  if (!match) return null
  try {
    return { mime: match[1], buffer: Buffer.from(match[2], 'base64') }
  } catch {
    return null
  }
}

function isTriplet(v: unknown): v is [number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number' &&
    typeof v[2] === 'number'
  )
}

function validateShot(raw: unknown): IncomingShot | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (typeof s.cameraId !== 'string' || !s.cameraId) return null
  if (typeof s.name !== 'string') return null
  if (typeof s.isActive !== 'boolean') return null
  if (typeof s.fov !== 'number' || !Number.isFinite(s.fov)) return null
  if (!isTriplet(s.position)) return null
  if (!isTriplet(s.target)) return null
  const hasExisting = typeof s.existingShotId === 'string' && s.existingShotId.length > 0
  if (!hasExisting && typeof s.snapshotDataUrl !== 'string') return null
  return {
    clientId: typeof s.clientId === 'string' ? s.clientId : undefined,
    cameraId: s.cameraId,
    name: s.name,
    isActive: s.isActive,
    fov: s.fov,
    position: s.position,
    target: s.target,
    note: typeof s.note === 'string' ? s.note : undefined,
    snapshotDataUrl: typeof s.snapshotDataUrl === 'string' ? s.snapshotDataUrl : '',
    existingShotId: hasExisting ? (s.existingShotId as string) : undefined,
  }
}

/**
 * POST /api/novel-promotion/[projectId]/director-desk/save
 * 保存 Director Desk 编辑器的 layout + 快照，并反向同步 photographyRules
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => null) as {
    panelId?: unknown
    project?: unknown
    shots?: unknown
  } | null

  if (!body || typeof body.panelId !== 'string' || !body.panelId) {
    throw new ApiError('INVALID_PARAMS')
  }
  const panelId = body.panelId

  const parsedProject = parseDirectorProject(body.project)
  if (!parsedProject) throw new ApiError('INVALID_PARAMS')

  if (!Array.isArray(body.shots)) throw new ApiError('INVALID_PARAMS')
  if (body.shots.length > MAX_SHOTS) throw new ApiError('INVALID_PARAMS')

  const shots: IncomingShot[] = []
  for (const raw of body.shots) {
    const s = validateShot(raw)
    if (!s) throw new ApiError('INVALID_PARAMS')
    shots.push(s)
  }

  // 归一化 isActive：仅允许一个 active（先到先得），若无则默认第一个
  let sawActive = false
  for (const s of shots) {
    if (s.isActive) {
      if (sawActive) s.isActive = false
      else sawActive = true
    }
  }
  if (!sawActive && shots.length > 0) shots[0].isActive = true

  // 校验 panel 归属
  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
    include: {
      storyboard: {
        include: {
          episode: { include: { novelPromotionProject: true } },
        },
      },
    },
  })
  if (!panel || panel.storyboard.episode.novelPromotionProject.projectId !== projectId) {
    throw new ApiError('NOT_FOUND')
  }
  const videoRatio = panel.storyboard.episode.novelPromotionProject.videoRatio ?? '9:16'

  const serializedLayout = serializeDirectorProject(parsedProject)
  if (!validateDirectorProjectSize(serializedLayout)) {
    throw new ApiError('INVALID_PARAMS', { message: 'director project too large' })
  }

  // Upload new captures and build rows to create + list of existing shot IDs to retain.
  const toCreate: Array<{
    panelId: string
    cameraId: string
    name: string
    isActive: boolean
    fov: number
    posX: number
    posY: number
    posZ: number
    targetX: number
    targetY: number
    targetZ: number
    imageMediaId: string
    note: string | null
  }> = []
  const existingUpdates: Array<{
    id: string
    cameraId: string
    name: string
    isActive: boolean
    fov: number
    posX: number
    posY: number
    posZ: number
    targetX: number
    targetY: number
    targetZ: number
    note: string | null
  }> = []
  const retainIds = new Set<string>()
  let newSucceeded = 0
  let newFailed = 0

  for (const s of shots) {
    const fov = Number.isFinite(Number(s.fov)) ? Number(s.fov) : 50
    const posX = Number.isFinite(Number(s.position?.[0])) ? Number(s.position[0]) : 0
    const posY = Number.isFinite(Number(s.position?.[1])) ? Number(s.position[1]) : 1.55
    const posZ = Number.isFinite(Number(s.position?.[2])) ? Number(s.position[2]) : 5.4
    const targetX = Number.isFinite(Number(s.target?.[0])) ? Number(s.target[0]) : 0
    const targetY = Number.isFinite(Number(s.target?.[1])) ? Number(s.target[1]) : 1.05
    const targetZ = Number.isFinite(Number(s.target?.[2])) ? Number(s.target[2]) : 0
    const note = typeof s.note === 'string' ? s.note : null
    const name = s.name || '机位'

    if (s.existingShotId) {
      // Verify ownership: belongs to this panel.
      const existing = await prisma.novelPromotionDirectorShot.findFirst({
        where: { id: s.existingShotId, panelId },
        select: { id: true },
      })
      if (existing) {
        retainIds.add(s.existingShotId)
        existingUpdates.push({ id: s.existingShotId, cameraId: s.cameraId, name, isActive: !!s.isActive, fov, posX, posY, posZ, targetX, targetY, targetZ, note })
        continue
      }
      // existingShotId not found → fall through to treat as new shot (needs snapshotDataUrl)
    }

    try {
      const parsed = parseDataUrl(s.snapshotDataUrl)
      if (!parsed || parsed.buffer.length > MAX_DATAURL_BYTES) {
        console.error('[director-desk] bad shot dataUrl', s.cameraId)
        newFailed++
        continue
      }
      const jpeg = await sharp(parsed.buffer).jpeg({ quality: 88, mozjpeg: true }).toBuffer()
      const key = generateUniqueKey(`director-shot-${panelId}`, 'jpg')
      await uploadObject(jpeg, key, undefined, 'image/jpeg')
      const mediaRef = await ensureMediaObjectFromStorageKey(key, {
        mimeType: 'image/jpeg',
        sizeBytes: jpeg.length,
      })
      toCreate.push({ panelId, cameraId: s.cameraId, name, isActive: !!s.isActive, fov, posX, posY, posZ, targetX, targetY, targetZ, imageMediaId: mediaRef.id, note })
      newSucceeded++
    } catch (err) {
      console.error('[director-desk] shot upload failed:', err)
      newFailed++
    }
  }

  // Compute photographyRules patch using the effective active camera (prefer DB shot).
  let projectForPatch: DirectorProject = parsedProject
  const activeUpdate = existingUpdates.find(u => u.isActive)
  const activeCreate = toCreate.find(c => c.isActive)
  const active = activeUpdate ?? activeCreate ?? existingUpdates[0] ?? toCreate[0] ?? null
  if (active) {
    const patchedCameras = parsedProject.cameras.map((cam) => {
      if (cam.id !== (active as { cameraId?: string }).cameraId) return cam
      return {
        ...cam,
        fov: active.fov,
        position: [active.posX, active.posY, active.posZ] as [number, number, number],
        target: [active.targetX, active.targetY, active.targetZ] as [number, number, number],
      }
    })
    const camId = (active as { cameraId?: string; id?: string }).cameraId
    if (camId && !parsedProject.cameras.some(c => c.id === camId)) {
      patchedCameras.push({ id: camId, name: active.name, fov: active.fov, position: [active.posX, active.posY, active.posZ], target: [active.targetX, active.targetY, active.targetZ], visible: true })
    }
    projectForPatch = { ...parsedProject, cameras: patchedCameras, activeCameraId: camId ?? parsedProject.activeCameraId }
  }

  const patch = computePhotographyRulesPatch({ project: projectForPatch, videoRatio })

  // 合并到现有 panel.photographyRules（保留除 characters 的其它字段）
  let existingRules: Record<string, unknown> = {}
  if (panel.photographyRules) {
    try {
      const parsed = JSON.parse(panel.photographyRules)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existingRules = parsed as Record<string, unknown>
      }
    } catch { /* ignore corrupt */ }
  }
  const existingCharacters: Array<Record<string, unknown>> = Array.isArray(existingRules.characters)
    ? (existingRules.characters as Array<Record<string, unknown>>)
    : []
  const byName = new Map<string, Record<string, unknown>>()
  for (const c of existingCharacters) {
    if (c && typeof c.name === 'string') byName.set(c.name, { ...c })
  }
  for (const p of patch.characters) {
    const existing = byName.get(p.name)
    if (existing) {
      existing.screen_position = p.screen_position
      existing.posture = p.posture
      existing.facing = p.facing
      byName.set(p.name, existing)
    } else {
      byName.set(p.name, {
        name: p.name,
        screen_position: p.screen_position,
        posture: p.posture,
        facing: p.facing,
      })
    }
  }
  const mergedRules = {
    ...existingRules,
    characters: Array.from(byName.values()),
  }

  await prisma.$transaction(async (tx) => {
    // Delete shots that are no longer bound (cascade will clean up their MediaObjects).
    if (retainIds.size > 0) {
      await tx.novelPromotionDirectorShot.deleteMany({ where: { panelId, id: { notIn: Array.from(retainIds) } } })
    } else {
      await tx.novelPromotionDirectorShot.deleteMany({ where: { panelId } })
    }
    // Update metadata on retained shots.
    for (const u of existingUpdates) {
      await tx.novelPromotionDirectorShot.update({
        where: { id: u.id },
        data: {
          name: u.name, isActive: u.isActive, fov: u.fov,
          posX: u.posX, posY: u.posY, posZ: u.posZ,
          targetX: u.targetX, targetY: u.targetY, targetZ: u.targetZ,
          note: u.note,
        },
      })
    }
    // Create new shots.
    if (toCreate.length > 0) {
      await tx.novelPromotionDirectorShot.createMany({ data: toCreate })
    }
    // Persist layout + patch photographyRules.
    await tx.novelPromotionPanel.update({
      where: { id: panelId },
      data: {
        directorLayout: serializedLayout,
        photographyRules: JSON.stringify(mergedRules),
      },
    })
  }, { maxWait: 15000, timeout: 30000 })

  let warning: string | undefined
  const totalNew = shots.filter(s => !s.existingShotId).length
  if (totalNew > 0 && newSucceeded === 0) warning = 'all_screenshots_failed'
  else if (newFailed > 0) warning = 'some_screenshots_failed'

  return NextResponse.json({
    success: true,
    ...(warning ? { warning } : {}),
  })
})
