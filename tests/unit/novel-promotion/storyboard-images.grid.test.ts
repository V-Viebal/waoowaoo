import { describe, expect, it } from 'vitest'
import {
  StoryboardGridCapacityError,
  buildStoryboardGridLayout,
  findMissingStoryboardPanelImages,
} from '@/lib/storyboard-images/grid'

describe('storyboard image grid rules', () => {
  it('uses fixed 3/6/9 grid presets with expected rows and columns', () => {
    expect(buildStoryboardGridLayout('grid_3', 3)).toMatchObject({
      preset: 'grid_3',
      columns: 1,
      rows: 3,
      capacity: 3,
      panelCount: 3,
    })
    expect(buildStoryboardGridLayout('grid_6', 6)).toMatchObject({
      preset: 'grid_6',
      columns: 2,
      rows: 3,
      capacity: 6,
      panelCount: 6,
    })
    expect(buildStoryboardGridLayout('grid_9', 9)).toMatchObject({
      preset: 'grid_9',
      columns: 3,
      rows: 3,
      capacity: 9,
      panelCount: 9,
    })
  })

  it('computes n-grid layout with at most three columns', () => {
    expect(buildStoryboardGridLayout('grid_auto', 1)).toMatchObject({
      preset: 'grid_auto',
      columns: 1,
      rows: 1,
      capacity: 1,
      panelCount: 1,
    })
    expect(buildStoryboardGridLayout('grid_auto', 7)).toMatchObject({
      preset: 'grid_auto',
      columns: 3,
      rows: 3,
      capacity: 9,
      panelCount: 7,
    })
  })

  it('rejects fixed presets that cannot hold all panels', () => {
    expect(() => buildStoryboardGridLayout('grid_3', 4)).toThrow(StoryboardGridCapacityError)
    expect(() => buildStoryboardGridLayout('grid_6', 7)).toThrow(StoryboardGridCapacityError)
  })

  it('reports panel numbers that cannot be composited because image is missing', () => {
    const missing = findMissingStoryboardPanelImages([
      { id: 'panel-1', panelIndex: 0, panelNumber: 1, imageUrl: 'images/panel-1.jpg' },
      { id: 'panel-2', panelIndex: 1, panelNumber: 2, imageUrl: null },
      { id: 'panel-3', panelIndex: 2, panelNumber: null, imageUrl: '' },
    ])

    expect(missing).toEqual([2, 3])
  })
})
