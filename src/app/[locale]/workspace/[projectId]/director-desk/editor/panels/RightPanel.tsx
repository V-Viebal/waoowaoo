'use client'
import { useSelectedCamera, useSelectedObject } from '../store/directorSelectors'
import { CameraPanel } from './CameraPanel'
import { CharacterPanel } from './CharacterPanel'
import { CrowdPanel } from './CrowdPanel'
import { PropPanel } from './PropPanel'
import { ScenePanel } from './ScenePanel'

export function RightPanel() {
  const cam = useSelectedCamera()
  const obj = useSelectedObject()
  if (cam) return <CameraPanel />
  if (obj) {
    if (obj.kind === 'character') return <CharacterPanel object={obj} />
    if (obj.kind === 'prop') return <PropPanel object={obj} />
    if (obj.kind === 'crowd') return <CrowdPanel object={obj} />
  }
  return <ScenePanel />
}
