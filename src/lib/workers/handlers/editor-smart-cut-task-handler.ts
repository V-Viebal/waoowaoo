import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { buildInitialProject, type BuildProjectOptions } from '@/lib/twick/project-builder'
import type { PanelVideoSource, VoiceLineSource, TwickTimelineProject } from '@/lib/twick/types'

const DEFAULT_PANEL_DURATION_SECONDS = 3
const DEFAULT_VOICE_DURATION_SECONDS = 2
const DEFAULT_PROJECT_WIDTH = 720
const DEFAULT_PROJECT_HEIGHT = 1280
const MAX_SMART_CUT_MERGE_RETRIES = 3

export const SMART_CUT_NO_VIDEO_PANELS_ERROR = 'SMART_CUT_NO_VIDEO_PANELS'

type JsonRecord = Record<string, unknown>

type StoryboardWithPanels = Awaited<ReturnType<typeof loadEpisodeStoryboards>>[number]
type VoiceLineRecord = Awaited<ReturnType<typeof loadEpisodeVoiceLines>>[number]

function asJsonRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const ids = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
  return ids.length > 0 ? ids : []
}

function readPositiveNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function durationMsToSeconds(value: number | null | undefined, fallbackSeconds: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallbackSeconds
  return value / 1000
}

function durationSeconds(value: number | null | undefined, fallbackSeconds: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallbackSeconds
  return value
}

function parseSmartCutPayload(job: Job<TaskJobData>) {
  const payload = asJsonRecord(job.data.payload) || {}
  const episodeId = readString(payload.episodeId) || readString(job.data.episodeId) || null
  const editorProjectId = readString(payload.editorProjectId)
    || (job.data.targetType === 'NovelPromotionEditorProject' ? readString(job.data.targetId) : null)
  const panelIds = readStringArray(payload.panelIds)

  if (!episodeId) throw new Error('episodeId is required')
  if (!editorProjectId) throw new Error('editorProjectId is required')

  return { episodeId, editorProjectId, panelIds }
}

async function loadEditorProject(editorProjectId: string, episodeId: string) {
  return await prisma.novelPromotionEditorProject.findFirst({
    where: {
      id: editorProjectId,
      episodeId,
    },
    select: {
      id: true,
      projectData: true,
      version: true,
    },
  })
}

async function loadEpisodeStoryboards(episodeId: string) {
  return await prisma.novelPromotionStoryboard.findMany({
    where: { episodeId },
    select: {
      id: true,
      clip: {
        select: {
          id: true,
          start: true,
        },
      },
      panels: {
        select: {
          id: true,
          panelIndex: true,
          description: true,
          videoPrompt: true,
          duration: true,
          videoMediaId: true,
          videoMedia: {
            select: {
              id: true,
              durationMs: true,
            },
          },
        },
        orderBy: { panelIndex: 'asc' },
      },
    },
    orderBy: [
      { clip: { start: 'asc' } },
      { createdAt: 'asc' },
    ],
  })
}

async function loadEpisodeVoiceLines(episodeId: string) {
  return await prisma.novelPromotionVoiceLine.findMany({
    where: { episodeId },
    select: {
      id: true,
      lineIndex: true,
      speaker: true,
      content: true,
      audioDuration: true,
      audioMediaId: true,
      audioMedia: {
        select: {
          id: true,
          durationMs: true,
        },
      },
      matchedPanelId: true,
      matchedStoryboardId: true,
      matchedPanelIndex: true,
    },
    orderBy: { lineIndex: 'asc' },
  })
}

type PanelVideoWithMatchKey = PanelVideoSource & {
  panelIndex: number
}

function mapStoryboardsToPanelVideos(
  storyboards: StoryboardWithPanels[],
  panelIds: string[] | null,
): PanelVideoWithMatchKey[] {
  const allowList = panelIds ? new Set(panelIds) : null
  const panelVideos: PanelVideoWithMatchKey[] = []

  for (const storyboard of storyboards) {
    for (const panel of storyboard.panels) {
      if (allowList && !allowList.has(panel.id)) continue

      const mediaObjectId = panel.videoMediaId || panel.videoMedia?.id
      if (!mediaObjectId) continue

      panelVideos.push({
        panelId: panel.id,
        storyboardId: storyboard.id,
        panelIndex: panel.panelIndex,
        videoMediaObjectId: mediaObjectId,
        duration: durationMsToSeconds(panel.videoMedia?.durationMs, durationSeconds(panel.duration, DEFAULT_PANEL_DURATION_SECONDS)),
        description: panel.videoPrompt || panel.description || undefined,
      })
    }
  }

  return panelVideos
}

function mapVoiceLinesToSources(voiceLines: VoiceLineRecord[]): VoiceLineSource[] {
  return voiceLines
    .filter((line) => !!(line.audioMediaId || line.audioMedia?.id))
    .map((line) => ({
      voiceLineId: line.id,
      audioMediaObjectId: line.audioMediaId || line.audioMedia!.id,
      duration: durationMsToSeconds(
        line.audioDuration,
        durationMsToSeconds(line.audioMedia?.durationMs, DEFAULT_VOICE_DURATION_SECONDS),
      ),
      text: line.content || '',
      speaker: line.speaker || undefined,
    }))
}

function buildPanelVoiceLineLookup(voiceLines: VoiceLineRecord[]) {
  const byPanelId = new Map<string, VoiceLineSource>()
  const byStoryboardPanel = new Map<string, VoiceLineSource>()
  const sourceByVoiceLineId = new Map(mapVoiceLinesToSources(voiceLines).map((source) => [source.voiceLineId, source]))
  const ordered: VoiceLineSource[] = []

  for (const line of voiceLines) {
    const source = sourceByVoiceLineId.get(line.id)
    if (!source) continue
    ordered.push(source)
    if (line.matchedPanelId) byPanelId.set(line.matchedPanelId, source)
    if (line.matchedStoryboardId && typeof line.matchedPanelIndex === 'number') {
      byStoryboardPanel.set(`${line.matchedStoryboardId}:${line.matchedPanelIndex}`, source)
    }
  }

  return { byPanelId, byStoryboardPanel, ordered }
}

function alignVoiceLinesToPanels(
  panels: PanelVideoWithMatchKey[],
  voiceLines: VoiceLineRecord[],
): VoiceLineSource[] {
  const lookup = buildPanelVoiceLineLookup(voiceLines)
  const usedVoiceLineIds = new Set<string>()
  let orderedIndex = 0

  return panels.map((panel) => {
    const matched = lookup.byPanelId.get(panel.panelId)
      || lookup.byStoryboardPanel.get(`${panel.storyboardId}:${panel.panelIndex}`)
    if (matched) {
      usedVoiceLineIds.add(matched.voiceLineId)
      return matched
    }

    while (orderedIndex < lookup.ordered.length && usedVoiceLineIds.has(lookup.ordered[orderedIndex]!.voiceLineId)) {
      orderedIndex += 1
    }
    const fallback = lookup.ordered[orderedIndex]
    if (fallback) usedVoiceLineIds.add(fallback.voiceLineId)
    orderedIndex += 1
    return fallback
  }).filter((line): line is VoiceLineSource => !!line)
}

function readProjectOptions(projectData: unknown): Pick<BuildProjectOptions, 'width' | 'height' | 'fps' | 'backgroundColor' | 'title'> {
  const record = asJsonRecord(projectData)
  const metadata = asJsonRecord(record?.metadata)
  const custom = asJsonRecord(metadata?.custom)

  return {
    width: readPositiveNumber(custom?.width ?? record?.width, DEFAULT_PROJECT_WIDTH),
    height: readPositiveNumber(custom?.height ?? record?.height, DEFAULT_PROJECT_HEIGHT),
    fps: readPositiveNumber(custom?.fps ?? record?.fps, 30),
    backgroundColor: readString(record?.backgroundColor) || undefined,
    title: readString(metadata?.title) || undefined,
  }
}

function cloneTimelineTrack(track: TwickTimelineProject['tracks'][number]) {
  return {
    ...track,
    elements: Array.isArray(track.elements)
      ? track.elements.map((element) => {
        const elementRecord = element as unknown as Record<string, unknown>
        const props = asJsonRecord(elementRecord.props)
        const metadata = asJsonRecord(elementRecord.metadata)
        return {
          ...elementRecord,
          ...(props ? { props: { ...props } } : {}),
          ...(metadata ? { metadata: { ...metadata } } : {}),
        }
      }) as typeof track.elements
      : [],
  }
}

function mergeSmartCutTracksIntoProject(
  currentProjectData: unknown,
  generatedProject: TwickTimelineProject,
): TwickTimelineProject {
  const currentRecord = asJsonRecord(currentProjectData)
  if (!currentRecord) return generatedProject

  const currentTracks = Array.isArray(currentRecord.tracks)
    ? currentRecord.tracks.filter((track): track is TwickTimelineProject['tracks'][number] => !!asJsonRecord(track))
    : []
  const generatedTracks = Array.isArray(generatedProject.tracks) ? generatedProject.tracks : []
  const generatedTrackIds = new Set(generatedTracks.map((track) => track.id).filter(Boolean))
  const preservedTracks = currentTracks
    .filter((track) => !generatedTrackIds.has(track.id))
    .map(cloneTimelineTrack)

  const currentMetadata = asJsonRecord(currentRecord.metadata) || {}
  const currentCustom = asJsonRecord(currentMetadata.custom) || {}
  const generatedMetadata = asJsonRecord(generatedProject.metadata) || {}
  const generatedCustom = asJsonRecord(generatedMetadata.custom) || {}

  return {
    ...(currentRecord as unknown as TwickTimelineProject),
    ...generatedProject,
    metadata: {
      ...currentMetadata,
      ...generatedMetadata,
      custom: {
        ...currentCustom,
        ...generatedCustom,
      },
    },
    tracks: [
      ...generatedTracks.map(cloneTimelineTrack),
      ...preservedTracks,
    ],
  }
}

export async function buildSmartCutProject(params: {
  currentProjectData: unknown
  storyboards: StoryboardWithPanels[]
  voiceLines: VoiceLineRecord[]
  panelIds?: string[] | null
}): Promise<{
  projectData: TwickTimelineProject
  panelCount: number
  voiceLineCount: number
}> {
  const panelVideos = mapStoryboardsToPanelVideos(params.storyboards, params.panelIds || null)
  const voiceSources = alignVoiceLinesToPanels(panelVideos, params.voiceLines)
  const options = readProjectOptions(params.currentProjectData)

  const generatedProject = buildInitialProject(panelVideos, voiceSources, {
    ...options,
    includeAudio: true,
    includeCaptions: false,
  })
  const projectData = mergeSmartCutTracksIntoProject(params.currentProjectData, generatedProject)

  return {
    projectData,
    panelCount: panelVideos.length,
    voiceLineCount: voiceSources.length,
  }
}

async function persistSmartCutProjectWithVersionRetry(params: {
  job: Job<TaskJobData>
  episodeId: string
  editorProjectId: string
  initialVersion: number
  initialProjectData: unknown
  storyboards: StoryboardWithPanels[]
  voiceLines: VoiceLineRecord[]
  panelIds?: string[] | null
}) {
  let expectedVersion = params.initialVersion
  let currentProjectData = params.initialProjectData

  for (let attempt = 1; attempt <= MAX_SMART_CUT_MERGE_RETRIES; attempt += 1) {
    const buildResult = await buildSmartCutProject({
      currentProjectData,
      storyboards: params.storyboards,
      voiceLines: params.voiceLines,
      panelIds: params.panelIds,
    })

    if (buildResult.panelCount === 0) {
      throw new Error(SMART_CUT_NO_VIDEO_PANELS_ERROR)
    }

    await assertTaskActive(params.job, 'smart_cut_persist_editor_project')
    const updateResult = await prisma.novelPromotionEditorProject.updateMany({
      where: {
        id: params.editorProjectId,
        version: expectedVersion,
      },
      data: {
        projectData: buildResult.projectData as unknown as object,
        version: { increment: 1 },
      },
    })

    if (updateResult.count === 1) {
      return buildResult
    }

    const latestProject = await loadEditorProject(params.editorProjectId, params.episodeId)
    if (!latestProject) throw new Error('EDITOR_PROJECT_NOT_FOUND')
    expectedVersion = latestProject.version
    currentProjectData = latestProject.projectData
  }

  throw new Error(`SMART_CUT_PROJECT_VERSION_CONFLICT: failed after ${MAX_SMART_CUT_MERGE_RETRIES} retries`)
}

export async function handleEditorSmartCutTask(job: Job<TaskJobData>) {
  const { episodeId, editorProjectId, panelIds } = parseSmartCutPayload(job)

  await reportTaskProgress(job, 15, { stage: 'smart_cut_load_assets' })

  const editorProject = await loadEditorProject(editorProjectId, episodeId)
  if (!editorProject) throw new Error('EDITOR_PROJECT_NOT_FOUND')

  const [storyboards, voiceLines] = await Promise.all([
    loadEpisodeStoryboards(episodeId),
    loadEpisodeVoiceLines(episodeId),
  ])

  await reportTaskProgress(job, 55, {
    stage: 'smart_cut_build_timeline',
    storyboardCount: storyboards.length,
  })

  const { panelCount, voiceLineCount } = await persistSmartCutProjectWithVersionRetry({
    job,
    episodeId,
    editorProjectId,
    initialVersion: editorProject.version,
    initialProjectData: editorProject.projectData,
    storyboards,
    voiceLines,
    panelIds,
  })

  await reportTaskProgress(job, 90, {
    stage: 'smart_cut_completed',
    panelCount,
    voiceLineCount,
  })

  return {
    success: true,
    editorProjectId,
    episodeId,
    panelCount,
    voiceLineCount,
    actualQuantity: 1,
  }
}
