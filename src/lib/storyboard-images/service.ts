import sharp from 'sharp'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ensureMediaObjectFromStorageKey, resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { generateUniqueKey, getSignedUrl, toFetchableUrl, uploadObject } from '@/lib/storage'
import {
  STORYBOARD_IMAGE_MODES,
  StoryboardGridCapacityError,
  StoryboardGridEmptyError,
  StoryboardPanelImageMissingError,
  buildStoryboardGridLayout,
  findMissingStoryboardPanelImages,
  resolveStoryboardPanelNumber,
  type StoryboardGridLayout,
  type StoryboardGridPreset,
} from './grid'

type StoryboardPanelForComposite = {
  id: string
  panelIndex: number
  panelNumber: number | null
  imageUrl: string | null
  imageMediaId: string | null
}

type StoryboardForComposite = {
  id: string
  storyboardTextJson: string | null
  panels: StoryboardPanelForComposite[]
}

type RenderedGridConfig = StoryboardGridLayout & {
  cellWidth: number
  cellHeight: number
  gap: number
  width: number
  height: number
}

export type CreateCompositedStoryboardImageInput = {
  projectId: string
  storyboardId: string
  userId: string
  gridPreset: StoryboardGridPreset
}

export type StoryboardImageCreationResult = {
  storyboardId: string
  imageUrl: string
  imageMediaId: string
  versionId: string
  mode: typeof STORYBOARD_IMAGE_MODES.COMPOSITED_STORYBOARD
  gridPreset: StoryboardGridPreset
  gridConfig: RenderedGridConfig
}

export class StoryboardImageNotFoundError extends Error {
  readonly code = 'STORYBOARD_NOT_FOUND'

  constructor(storyboardId: string) {
    super(`Storyboard not found: ${storyboardId}`)
    this.name = 'StoryboardImageNotFoundError'
  }
}

class StoryboardPanelImageDownloadError extends Error {
  readonly code = 'STORYBOARD_PANEL_IMAGE_DOWNLOAD_FAILED'
  readonly panelNumber: number

  constructor(panelNumber: number, causeMessage: string) {
    super(`Failed to download storyboard panel ${panelNumber}: ${causeMessage}`)
    this.name = 'StoryboardPanelImageDownloadError'
    this.panelNumber = panelNumber
  }
}

function resolveGap(cellWidth: number, cellHeight: number) {
  return Math.max(8, Math.round(Math.min(cellWidth, cellHeight) * 0.025))
}

async function fetchPanelImageBuffer(panel: StoryboardPanelForComposite): Promise<{ buffer: Buffer; storageKey: string }> {
  const storageKey = await resolveStorageKeyFromMediaValue(panel.imageUrl)
  if (!storageKey) {
    throw new StoryboardPanelImageMissingError([resolveStoryboardPanelNumber(panel)])
  }

  const url = toFetchableUrl(getSignedUrl(storageKey, 3600))
  const response = await fetch(url)
  if (!response.ok) {
    throw new StoryboardPanelImageDownloadError(resolveStoryboardPanelNumber(panel), `${response.status} ${response.statusText}`)
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    storageKey,
  }
}

async function resolveCellSize(buffers: Buffer[]) {
  for (const buffer of buffers) {
    const meta = await sharp(buffer).metadata()
    if (meta.width && meta.height) {
      return {
        cellWidth: meta.width,
        cellHeight: meta.height,
      }
    }
  }
  return {
    cellWidth: 1280,
    cellHeight: 720,
  }
}

async function composeGridImage(
  layout: StoryboardGridLayout,
  panelImages: Array<{ panel: StoryboardPanelForComposite; buffer: Buffer }>,
): Promise<{ buffer: Buffer; gridConfig: RenderedGridConfig }> {
  const { cellWidth, cellHeight } = await resolveCellSize(panelImages.map((item) => item.buffer))
  const gap = resolveGap(cellWidth, cellHeight)
  const width = (layout.columns * cellWidth) + ((layout.columns - 1) * gap)
  const height = (layout.rows * cellHeight) + ((layout.rows - 1) * gap)

  const composites = await Promise.all(panelImages.map(async (item, index) => {
    const row = Math.floor(index / layout.columns)
    const column = index % layout.columns
    const input = await sharp(item.buffer)
      .resize(cellWidth, cellHeight, { fit: 'cover', position: 'center' })
      .png()
      .toBuffer()

    return {
      input,
      left: column * (cellWidth + gap),
      top: row * (cellHeight + gap),
    }
  }))

  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 245, g: 245, b: 245, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer()

  return {
    buffer,
    gridConfig: {
      ...layout,
      cellWidth,
      cellHeight,
      gap,
      width,
      height,
    },
  }
}

function buildSourcePanelsSnapshot(
  panels: StoryboardPanelForComposite[],
  storageKeys: Map<string, string>,
) {
  return panels.map((panel) => ({
    id: panel.id,
    panelIndex: panel.panelIndex,
    panelNumber: resolveStoryboardPanelNumber(panel),
    imageUrl: panel.imageUrl,
    imageMediaId: panel.imageMediaId,
    storageKey: storageKeys.get(panel.id) || null,
  }))
}

async function findStoryboardForProject(projectId: string, storyboardId: string): Promise<StoryboardForComposite | null> {
  return await prisma.novelPromotionStoryboard.findFirst({
    where: {
      id: storyboardId,
      episode: {
        novelPromotionProject: {
          projectId,
        },
      },
    },
    select: {
      id: true,
      storyboardTextJson: true,
      panels: {
        orderBy: { panelIndex: 'asc' },
        select: {
          id: true,
          panelIndex: true,
          panelNumber: true,
          imageUrl: true,
          imageMediaId: true,
        },
      },
    },
  })
}

async function persistStoryboardImageVersion(input: {
  tx: Prisma.TransactionClient
  storyboardId: string
  storageKey: string
  imageUrl: string
  imageMediaId: string
  userId: string
  gridPreset: StoryboardGridPreset
  gridConfig: RenderedGridConfig
  sourcePanelsSnapshot: Prisma.InputJsonValue
  inputSnapshot: Prisma.InputJsonValue
}) {
  await input.tx.novelPromotionStoryboard.update({
    where: { id: input.storyboardId },
    data: { storyboardImageUrl: input.storageKey },
  })

  return await input.tx.storyboardImageVersion.create({
    data: {
      storyboardId: input.storyboardId,
      mode: STORYBOARD_IMAGE_MODES.COMPOSITED_STORYBOARD,
      imageUrl: input.imageUrl,
      imageMediaId: input.imageMediaId,
      gridPreset: input.gridPreset,
      gridConfig: input.gridConfig,
      promptSnapshot: null,
      sourcePanelsSnapshot: input.sourcePanelsSnapshot,
      inputSnapshot: input.inputSnapshot,
      createdByUserId: input.userId,
    },
  })
}

export async function createCompositedStoryboardImage(
  input: CreateCompositedStoryboardImageInput,
): Promise<StoryboardImageCreationResult> {
  const storyboard = await findStoryboardForProject(input.projectId, input.storyboardId)
  if (!storyboard) {
    throw new StoryboardImageNotFoundError(input.storyboardId)
  }

  const layout = buildStoryboardGridLayout(input.gridPreset, storyboard.panels.length)
  const missingPanelNumbers = findMissingStoryboardPanelImages(storyboard.panels)
  if (missingPanelNumbers.length > 0) {
    throw new StoryboardPanelImageMissingError(missingPanelNumbers)
  }

  const panelImages: Array<{ panel: StoryboardPanelForComposite; buffer: Buffer }> = []
  const storageKeys = new Map<string, string>()
  for (const panel of storyboard.panels) {
    const image = await fetchPanelImageBuffer(panel)
    panelImages.push({ panel, buffer: image.buffer })
    storageKeys.set(panel.id, image.storageKey)
  }

  const { buffer, gridConfig } = await composeGridImage(layout, panelImages)
  const outputStorageKey = generateUniqueKey(`storyboard-${input.storyboardId}-composite`, 'png')
  const savedStorageKey = await uploadObject(buffer, outputStorageKey, 1, 'image/png')
  const media = await ensureMediaObjectFromStorageKey(savedStorageKey, {
    mimeType: 'image/png',
    sizeBytes: buffer.length,
    width: gridConfig.width,
    height: gridConfig.height,
  })

  const sourcePanelsSnapshot = buildSourcePanelsSnapshot(storyboard.panels, storageKeys)
  const inputSnapshot = {
    mode: STORYBOARD_IMAGE_MODES.COMPOSITED_STORYBOARD,
    gridPreset: input.gridPreset,
    panelCount: storyboard.panels.length,
    storyboardTextJson: storyboard.storyboardTextJson,
  }

  const version = await prisma.$transaction(async (tx) => await persistStoryboardImageVersion({
    tx,
    storyboardId: storyboard.id,
    storageKey: savedStorageKey,
    imageUrl: media.url,
    imageMediaId: media.id,
    userId: input.userId,
    gridPreset: input.gridPreset,
    gridConfig,
    sourcePanelsSnapshot,
    inputSnapshot,
  }))

  return {
    storyboardId: storyboard.id,
    imageUrl: media.url,
    imageMediaId: media.id,
    versionId: version.id,
    mode: STORYBOARD_IMAGE_MODES.COMPOSITED_STORYBOARD,
    gridPreset: input.gridPreset,
    gridConfig,
  }
}

export function isStoryboardGridRuleError(error: unknown): error is StoryboardGridCapacityError | StoryboardGridEmptyError | StoryboardPanelImageMissingError {
  return error instanceof StoryboardGridCapacityError
    || error instanceof StoryboardGridEmptyError
    || error instanceof StoryboardPanelImageMissingError
}
