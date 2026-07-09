import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getSignedUrl } from '@/lib/storage'
import {
  parsePanelCharacterReferences,
  findCharacterByName,
} from '@/lib/workers/handlers/image-task-handler-shared'
import { parseDirectorProject } from '@/lib/director-desk/schema'

function parseJsonUnknown(value: string | null | undefined): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function toSignedIfKey(keyOrUrl: string | null | undefined): string | null {
  if (!keyOrUrl) return null
  return keyOrUrl.startsWith('images/') || keyOrUrl.startsWith('voice/') || keyOrUrl.startsWith('video/')
    ? getSignedUrl(keyOrUrl, 24 * 3600)
    : keyOrUrl
}

function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

/**
 * GET /api/novel-promotion/[projectId]/director-desk/load?panelId=xxx
 * 加载 Director Desk 编辑器所需的 panel + 项目上下文数据
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const panelId = searchParams.get('panelId')
  if (!panelId) throw new ApiError('INVALID_PARAMS')

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

  const project = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      characters: { include: { appearances: { orderBy: { appearanceIndex: 'asc' } } } },
      locations: {
        where: { assetKind: 'location' },
        include: { images: { where: { isSelected: true } } },
      },
    },
  })

  if (!project) throw new ApiError('NOT_FOUND')

  const projectProps = await prisma.novelPromotionLocation.findMany({
    where: { novelPromotionProjectId: project.id, assetKind: 'prop' },
    include: { images: { where: { isSelected: true } } },
  })

  const directorShots = await prisma.novelPromotionDirectorShot.findMany({
    where: { panelId },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    include: { imageMedia: true },
  })

  // 角色资料
  const characterRefs = parsePanelCharacterReferences(panel.characters)
  const characterData = characterRefs.map((ref) => {
    const character = findCharacterByName(project.characters, ref.name)
    if (!character) {
      return {
        name: ref.name,
        appearance: ref.appearance ?? null,
        slot: ref.slot ?? null,
        imageUrl: null as string | null,
        imageMediaId: null as string | null,
      }
    }
    const appearances = character.appearances || []
    const matchedAppearance = ref.appearance
      ? appearances.find(
          (a) => (a.changeReason || '').toLowerCase() === ref.appearance!.toLowerCase(),
        )
      : undefined
    const appearance = matchedAppearance || appearances[0] || null
    let imageUrl: string | null = null
    let imageMediaId: string | null = null
    if (appearance) {
      const urls = parseJsonStringArray(appearance.imageUrls)
      const idx = typeof appearance.selectedIndex === 'number' ? appearance.selectedIndex : 0
      const rawUrl = urls[idx] || urls[0] || appearance.imageUrl || null
      imageUrl = toSignedIfKey(rawUrl)
      imageMediaId = appearance.imageMediaId ?? null
    }
    return {
      name: character.name,
      appearance: appearance?.changeReason ?? null,
      slot: ref.slot ?? null,
      imageUrl,
      imageMediaId,
    }
  })

  // 道具资料
  const propNames = parseJsonStringArray(panel.props)
  const propData = propNames.map((name) => {
    const lower = name.toLowerCase().trim()
    const prop = projectProps.find((p) => p.name.toLowerCase().trim() === lower)
    if (!prop) {
      return { name, imageUrl: null as string | null, imageMediaId: null as string | null }
    }
    const image = prop.images[0]
    return {
      name: prop.name,
      imageUrl: toSignedIfKey(image?.imageUrl ?? null),
      imageMediaId: image?.imageMediaId ?? null,
    }
  })

  // 场景
  let locationData: {
    name: string
    imageUrl: string | null
    imageMediaId: string | null
    availableSlots: unknown
  } | null = null
  if (typeof panel.location === 'string' && panel.location.trim()) {
    const lower = panel.location.toLowerCase().trim()
    const location = project.locations.find((l) => l.name.toLowerCase().trim() === lower)
    if (location) {
      const image = location.images[0]
      locationData = {
        name: location.name,
        imageUrl: toSignedIfKey(image?.imageUrl ?? null),
        imageMediaId: image?.imageMediaId ?? null,
        availableSlots: parseJsonUnknown(image?.availableSlots),
      }
    }
  }

  const directorLayout = parseDirectorProject(parseJsonUnknown(panel.directorLayout))

  const directorShotsData = directorShots.map((s) => ({
    id: s.id,
    cameraId: s.cameraId,
    name: s.name,
    isActive: s.isActive,
    fov: s.fov,
    pos: [s.posX, s.posY, s.posZ] as [number, number, number],
    target: [s.targetX, s.targetY, s.targetZ] as [number, number, number],
    imageUrl: toSignedIfKey(s.imageMedia?.storageKey ?? null),
    imageMediaId: s.imageMediaId,
    note: s.note,
    createdAt: s.createdAt.toISOString(),
  }))

  return NextResponse.json({
    panel: {
      id: panel.id,
      panelNumber: panel.panelNumber,
      shotType: panel.shotType,
      cameraMove: panel.cameraMove,
      description: panel.description,
      characters: characterData,
      props: propData,
      location: locationData,
      photographyRules: parseJsonUnknown(panel.photographyRules),
      actingNotes: parseJsonUnknown(panel.actingNotes),
      directorLayout,
      directorShots: directorShotsData,
    },
    project: { videoRatio: project.videoRatio },
  })
})
