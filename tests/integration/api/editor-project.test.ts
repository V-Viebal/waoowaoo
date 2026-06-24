import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'

const runId = randomUUID()

describe('NovelPromotionEditorProject model', () => {
  let userId: string
  let projectId: string
  let novelPromotionProjectId: string
  let firstEpisodeId: string
  let secondEpisodeId: string

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `test-editor-${runId}@example.com`,
        name: `test-editor-${runId}`,
      },
    })
    userId = user.id

    const project = await prisma.project.create({
      data: {
        userId,
        name: 'Test Editor Project',
      },
    })
    projectId = project.id

    const novelPromotionProject = await prisma.novelPromotionProject.create({
      data: {
        projectId,
      },
    })
    novelPromotionProjectId = novelPromotionProject.id

    const firstEpisode = await prisma.novelPromotionEpisode.create({
      data: {
        novelPromotionProjectId,
        episodeNumber: 1,
        name: 'Test Episode 1',
      },
    })
    firstEpisodeId = firstEpisode.id

    const secondEpisode = await prisma.novelPromotionEpisode.create({
      data: {
        novelPromotionProjectId,
        episodeNumber: 2,
        name: 'Test Episode 2',
      },
    })
    secondEpisodeId = secondEpisode.id
  })

  afterAll(async () => {
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
    }
    await prisma.$disconnect()
  })

  it('creates an editor project linked to an episode', async () => {
    const editorProject = await prisma.novelPromotionEditorProject.create({
      data: {
        episodeId: firstEpisodeId,
        projectData: { tracks: [] },
      },
    })

    expect(editorProject.id).toBeDefined()
    expect(editorProject.episodeId).toBe(firstEpisodeId)
    expect(editorProject.version).toBe(0)
    expect(editorProject.renderStatus).toBe('IDLE')
  })

  it('increments version on update', async () => {
    const created = await prisma.novelPromotionEditorProject.create({
      data: {
        episodeId: secondEpisodeId,
        projectData: { tracks: [] },
      },
    })

    const updated = await prisma.novelPromotionEditorProject.update({
      where: { id: created.id },
      data: {
        projectData: { tracks: [{ id: '1' }] },
        version: { increment: 1 },
      },
    })

    expect(updated.version).toBe(1)
  })

  it('creates editor assets backed by media objects', async () => {
    const episode = await prisma.novelPromotionEpisode.create({
      data: {
        novelPromotionProjectId,
        episodeNumber: 3,
        name: 'Test Episode 3',
      },
    })
    const editorProject = await prisma.novelPromotionEditorProject.create({
      data: {
        episodeId: episode.id,
        projectData: { tracks: [] },
      },
    })
    const mediaObject = await prisma.mediaObject.create({
      data: {
        publicId: `editor-asset-${runId}`,
        storageKey: `tests/editor-asset-${runId}.mp4`,
        mimeType: 'video/mp4',
      },
    })

    const asset = await prisma.novelPromotionEditorAsset.create({
      data: {
        editorProjectId: editorProject.id,
        mediaObjectId: mediaObject.id,
        type: 'VIDEO',
        sourceType: 'GENERATED',
        metadata: { label: 'generated clip' },
      },
      include: {
        mediaObject: true,
      },
    })

    expect(asset.mediaObject.publicId).toBe(`editor-asset-${runId}`)
    expect(asset.type).toBe('VIDEO')
    expect(asset.sourceType).toBe('GENERATED')
  })
})
