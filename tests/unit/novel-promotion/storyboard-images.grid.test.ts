import { describe, expect, it } from 'vitest'
import {
  StoryboardGridEmptyError,
  buildStoryboardGridLayout,
} from '@/lib/storyboard-images/grid'

describe('storyboard image grid rules', () => {
  it('computes n-grid layout with at most three columns', () => {
    expect(buildStoryboardGridLayout('grid_auto', 1)).toMatchObject({
      columns: 1,
      rows: 1,
      capacity: 1,
      panelCount: 1,
    })
    expect(buildStoryboardGridLayout('grid_auto', 7)).toMatchObject({
      columns: 3,
      rows: 3,
      capacity: 9,
      panelCount: 7,
    })
  })

  it('rejects panel counts below one', () => {
    expect(() => buildStoryboardGridLayout('grid_auto', 0)).toThrow(StoryboardGridEmptyError)
  })
})
