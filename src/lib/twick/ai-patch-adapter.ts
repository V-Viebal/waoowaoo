import type { TwickTimelineProject } from './types'

export interface TwickAiPatch {
  operation: 'replace-project'
  project: TwickTimelineProject
  reason?: string
}

export function applyTwickAiPatch(
  project: TwickTimelineProject,
  patch: TwickAiPatch,
): TwickTimelineProject {
  if (patch.operation === 'replace-project') {
    return patch.project
  }
  return project
}
