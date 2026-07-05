import { describe, expect, it } from 'vitest'
import { resolveEffectiveVideoDurationSeconds } from '@/lib/model-capabilities/video-duration'

// Uses google veo-3.0-fast-generate-001 which has durationOptions [4, 6, 8]
const DISCRETE_OPTS_MODEL = 'google::veo-3.0-fast-generate-001'
// Uses bailian wan2.2-i2v-plus which has no durationOptions in catalog (continuous range)
const CONTINUOUS_MODEL = 'bailian::wan2.2-i2v-plus'

describe('resolveEffectiveVideoDurationSeconds', () => {
  it('returns undefined for null / undefined / invalid inputs', () => {
    expect(resolveEffectiveVideoDurationSeconds(null, DISCRETE_OPTS_MODEL)).toBeUndefined()
    expect(resolveEffectiveVideoDurationSeconds(undefined, DISCRETE_OPTS_MODEL)).toBeUndefined()
    expect(resolveEffectiveVideoDurationSeconds(0, DISCRETE_OPTS_MODEL)).toBeUndefined()
    expect(resolveEffectiveVideoDurationSeconds(-3, DISCRETE_OPTS_MODEL)).toBeUndefined()
    expect(resolveEffectiveVideoDurationSeconds(Number.NaN, DISCRETE_OPTS_MODEL)).toBeUndefined()
  })

  it('snaps to nearest allowed option for discrete duration models', () => {
    // options [4, 6, 8]
    expect(resolveEffectiveVideoDurationSeconds(4, DISCRETE_OPTS_MODEL)).toBe(4)
    expect(resolveEffectiveVideoDurationSeconds(5, DISCRETE_OPTS_MODEL)).toBe(4) // tie: first-wins picks 4
    expect(resolveEffectiveVideoDurationSeconds(6, DISCRETE_OPTS_MODEL)).toBe(6)
    expect(resolveEffectiveVideoDurationSeconds(7, DISCRETE_OPTS_MODEL)).toBe(6) // tie: first-wins picks 6
    expect(resolveEffectiveVideoDurationSeconds(8, DISCRETE_OPTS_MODEL)).toBe(8)
    // Strictly closer to the higher option
    expect(resolveEffectiveVideoDurationSeconds(5.6, DISCRETE_OPTS_MODEL)).toBe(6)
    expect(resolveEffectiveVideoDurationSeconds(7.6, DISCRETE_OPTS_MODEL)).toBe(8)
    // Out-of-range snaps to nearest end
    expect(resolveEffectiveVideoDurationSeconds(1, DISCRETE_OPTS_MODEL)).toBe(4)
    expect(resolveEffectiveVideoDurationSeconds(20, DISCRETE_OPTS_MODEL)).toBe(8)
  })

  it('rounds non-integer inputs before snapping', () => {
    expect(resolveEffectiveVideoDurationSeconds(8.4, DISCRETE_OPTS_MODEL)).toBe(8)
    expect(resolveEffectiveVideoDurationSeconds(3.6, DISCRETE_OPTS_MODEL)).toBe(4)
  })

  it('clamps to at least 1 second then snaps', () => {
    // 0.3 -> rounds to 0 -> clamped to 1 -> snaps to nearest of [4,6,8] = 4
    expect(resolveEffectiveVideoDurationSeconds(0.3, DISCRETE_OPTS_MODEL)).toBe(4)
  })

  it('passes through rounded seconds for continuous-range / catalog models without durationOptions', () => {
    expect(resolveEffectiveVideoDurationSeconds(8, CONTINUOUS_MODEL)).toBe(8)
    expect(resolveEffectiveVideoDurationSeconds(8.7, CONTINUOUS_MODEL)).toBe(9)
    expect(resolveEffectiveVideoDurationSeconds(12, CONTINUOUS_MODEL)).toBe(12)
  })

  it('returns rounded seconds for unknown models (pass through; provider clamps)', () => {
    expect(resolveEffectiveVideoDurationSeconds(12, 'custom::my-video-model')).toBe(12)
  })
})
