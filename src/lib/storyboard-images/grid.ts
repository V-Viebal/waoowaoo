export const STORYBOARD_IMAGE_MODES = {
  SINGLE_PANEL: 'single_panel',
  AI_STORYBOARD: 'ai_storyboard',
  COMPOSITED_STORYBOARD: 'composited_storyboard',
} as const

export type StoryboardImageMode = (typeof STORYBOARD_IMAGE_MODES)[keyof typeof STORYBOARD_IMAGE_MODES]

export const STORYBOARD_GRID_PRESETS = {
  GRID_3: 'grid_3',
  GRID_6: 'grid_6',
  GRID_9: 'grid_9',
  GRID_AUTO: 'grid_auto',
} as const

export type StoryboardGridPreset = (typeof STORYBOARD_GRID_PRESETS)[keyof typeof STORYBOARD_GRID_PRESETS]

export type StoryboardGridLayout = {
  preset: StoryboardGridPreset
  columns: number
  rows: number
  capacity: number
  panelCount: number
}

export type StoryboardPanelImageSource = {
  id: string
  panelIndex: number
  panelNumber?: number | null
  imageUrl?: string | null
}

const FIXED_GRID_LAYOUTS: Record<Exclude<StoryboardGridPreset, 'grid_auto'>, Pick<StoryboardGridLayout, 'columns' | 'rows' | 'capacity'>> = {
  grid_3: { columns: 1, rows: 3, capacity: 3 },
  grid_6: { columns: 2, rows: 3, capacity: 6 },
  grid_9: { columns: 3, rows: 3, capacity: 9 },
}

export class StoryboardGridCapacityError extends Error {
  readonly code = 'STORYBOARD_GRID_CAPACITY_EXCEEDED'
  readonly preset: StoryboardGridPreset
  readonly panelCount: number
  readonly capacity: number

  constructor(preset: StoryboardGridPreset, panelCount: number, capacity: number) {
    super(`Storyboard grid ${preset} can hold ${capacity} panels, received ${panelCount}`)
    this.name = 'StoryboardGridCapacityError'
    this.preset = preset
    this.panelCount = panelCount
    this.capacity = capacity
  }
}

export class StoryboardGridEmptyError extends Error {
  readonly code = 'STORYBOARD_GRID_EMPTY'

  constructor() {
    super('Storyboard grid requires at least one panel')
    this.name = 'StoryboardGridEmptyError'
  }
}

export class StoryboardPanelImageMissingError extends Error {
  readonly code = 'STORYBOARD_PANEL_IMAGE_MISSING'
  readonly missingPanelNumbers: number[]

  constructor(missingPanelNumbers: number[]) {
    super(`Missing storyboard panel images: ${missingPanelNumbers.join(', ')}`)
    this.name = 'StoryboardPanelImageMissingError'
    this.missingPanelNumbers = missingPanelNumbers
  }
}

export function parseStoryboardGridPreset(value: unknown): StoryboardGridPreset {
  if (
    value === STORYBOARD_GRID_PRESETS.GRID_3
    || value === STORYBOARD_GRID_PRESETS.GRID_6
    || value === STORYBOARD_GRID_PRESETS.GRID_9
    || value === STORYBOARD_GRID_PRESETS.GRID_AUTO
  ) {
    return value
  }
  return STORYBOARD_GRID_PRESETS.GRID_AUTO
}

export function buildStoryboardGridLayout(
  preset: StoryboardGridPreset,
  panelCount: number,
): StoryboardGridLayout {
  const normalizedPanelCount = Number.isFinite(panelCount) ? Math.max(0, Math.floor(panelCount)) : 0
  if (normalizedPanelCount <= 0) {
    throw new StoryboardGridEmptyError()
  }

  if (preset !== STORYBOARD_GRID_PRESETS.GRID_AUTO) {
    const fixed = FIXED_GRID_LAYOUTS[preset]
    if (normalizedPanelCount > fixed.capacity) {
      throw new StoryboardGridCapacityError(preset, normalizedPanelCount, fixed.capacity)
    }
    return {
      preset,
      columns: fixed.columns,
      rows: fixed.rows,
      capacity: fixed.capacity,
      panelCount: normalizedPanelCount,
    }
  }

  const columns = Math.min(3, normalizedPanelCount)
  const rows = Math.ceil(normalizedPanelCount / columns)
  return {
    preset,
    columns,
    rows,
    capacity: columns * rows,
    panelCount: normalizedPanelCount,
  }
}

export function resolveStoryboardPanelNumber(panel: StoryboardPanelImageSource): number {
  return typeof panel.panelNumber === 'number' && Number.isFinite(panel.panelNumber)
    ? panel.panelNumber
    : panel.panelIndex + 1
}

export function findMissingStoryboardPanelImages(panels: StoryboardPanelImageSource[]): number[] {
  return panels
    .filter((panel) => typeof panel.imageUrl !== 'string' || panel.imageUrl.trim().length === 0)
    .map(resolveStoryboardPanelNumber)
}
