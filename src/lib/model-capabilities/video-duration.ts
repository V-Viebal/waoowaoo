import { resolveBuiltinCapabilitiesByModelKey } from './lookup'

/**
 * Given a panel's persisted duration (from LLM analysis, user edit on panel, or
 * grid video prompt rewrite) and a video model key, return a duration in whole
 * seconds that is valid for the model.
 *
 * - Rounds to nearest positive integer second.
 * - If the model exposes `durationOptions`, snaps to the nearest allowed value
 *   (common for discrete-option providers like Vidu/Qwen-Kling).
 * - If the model has no declared options (continuous range / custom model),
 *   returns the rounded seconds as-is; the provider clamps or rejects it.
 * - Returns undefined for missing/invalid duration inputs.
 */
export function resolveEffectiveVideoDurationSeconds(
  panelDuration: number | null | undefined,
  modelKey: string,
): number | undefined {
  if (typeof panelDuration !== 'number' || !Number.isFinite(panelDuration) || panelDuration <= 0) {
    return undefined
  }
  const seconds = Math.max(1, Math.round(panelDuration))

  const caps = resolveBuiltinCapabilitiesByModelKey('video', modelKey)
  const allowed = caps?.video?.durationOptions
  if (!allowed || allowed.length === 0) {
    return seconds
  }

  let nearest = allowed[0]!
  let bestDelta = Math.abs(seconds - nearest)
  for (let i = 1; i < allowed.length; i++) {
    const option = allowed[i]!
    const delta = Math.abs(seconds - option)
    if (delta < bestDelta) {
      bestDelta = delta
      nearest = option
    }
  }
  return nearest
}
