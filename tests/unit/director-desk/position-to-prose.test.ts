import { describe, expect, it } from 'vitest'
import {
  projectCharacterToScreen,
  toScreenPositionLabel,
  toPostureLabel,
  toFacingLabel,
  computePhotographyRulesPatch,
} from '@/lib/director-desk/photography-rules'
import { createDefaultDirectorProject } from '@/lib/director-desk/schema'

const DEFAULT_CAM = {
  camFov: 50,
  camPos: [0, 1.55, 5.4] as const,
  camTarget: [0, 1.55, 0] as const,
  aspect: 9 / 16,
}

describe('position to prose', () => {
  it('character at center of frame -> 画面正中', () => {
    const { nx, ny } = projectCharacterToScreen({ charPos: [0, 1.55, 0], ...DEFAULT_CAM })
    expect(Math.abs(nx)).toBeLessThan(0.1)
    expect(Math.abs(ny)).toBeLessThan(0.1)
    expect(toScreenPositionLabel(nx, ny)).toBe('画面正中')
  })

  it('character at x=-2 z=0 -> 画面左侧', () => {
    const { nx } = projectCharacterToScreen({ charPos: [-2, 1.55, 0], ...DEFAULT_CAM })
    expect(nx).toBeLessThan(-0.3)
    expect(toScreenPositionLabel(nx, 0)).toContain('左侧')
  })

  it('character at x=2 z=0 -> 画面右侧', () => {
    const { nx } = projectCharacterToScreen({ charPos: [2, 1.55, 0], ...DEFAULT_CAM })
    expect(nx).toBeGreaterThan(0.3)
    expect(toScreenPositionLabel(nx, 0)).toContain('右侧')
  })

  it('posture maps to chinese', () => {
    expect(toPostureLabel('stand')).toBe('站立')
    expect(toPostureLabel('sit')).toBe('坐着')
    expect(toPostureLabel('crouch')).toBe('蹲伏')
    expect(toPostureLabel(undefined)).toBe('站立')
  })

  it('facing camera (facing=0) -> 面向镜头', () => {
    expect(toFacingLabel(0, [0, 1.55, 5.4], [0, 1.55, 0])).toBe('面向镜头')
  })

  it('facing away (facing=π) -> 背对镜头', () => {
    expect(toFacingLabel(Math.PI, [0, 1.55, 5.4], [0, 1.55, 0])).toBe('背对镜头')
  })

  it('facing right (facing=-π/2) -> 面向画面右侧', () => {
    expect(toFacingLabel(-Math.PI / 2, [0, 1.55, 5.4], [0, 1.55, 0])).toBe('面向画面右侧')
  })

  it('facing left (facing=π/2) -> 面向画面左侧', () => {
    expect(toFacingLabel(Math.PI / 2, [0, 1.55, 5.4], [0, 1.55, 0])).toBe('面向画面左侧')
  })

  it('default project has no characters -> empty patch', () => {
    const proj = createDefaultDirectorProject()
    const patch = computePhotographyRulesPatch({ project: proj })
    expect(patch.characters).toHaveLength(0)
  })
})
