export type StoryboardGridLayout = {
  columns: number
  rows: number
  capacity: number
  panelCount: number
}

export class StoryboardGridEmptyError extends Error {
  readonly code = 'STORYBOARD_GRID_EMPTY'

  constructor() {
    super('Storyboard grid requires at least one panel')
    this.name = 'StoryboardGridEmptyError'
  }
}

/**
 * Compute an auto-arranged grid layout for the requested panel count.
 * Uses up to 3 columns, growing rows as needed.
 */
export function buildStoryboardGridLayout(
  _preset: 'grid_auto',
  panelCount: number,
): StoryboardGridLayout {
  const normalizedPanelCount = Number.isFinite(panelCount) ? Math.max(0, Math.floor(panelCount)) : 0
  if (normalizedPanelCount <= 0) {
    throw new StoryboardGridEmptyError()
  }

  const columns = Math.min(3, normalizedPanelCount)
  const rows = Math.ceil(normalizedPanelCount / columns)
  return {
    columns,
    rows,
    capacity: columns * rows,
    panelCount: normalizedPanelCount,
  }
}
