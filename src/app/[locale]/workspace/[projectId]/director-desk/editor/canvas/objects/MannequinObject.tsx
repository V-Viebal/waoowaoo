'use client'
import { useDirectorStore } from '../../store/directorStore'
import { NameLabel } from '../NameLabel'
import { ProceduralMannequin } from '../../runtime/mannequin/ProceduralMannequin'
import type { DirectorObject } from '@/lib/director-desk/schema'

interface Props {
  object: DirectorObject
}

export function MannequinObject({ object }: Props) {
  const showLabels = useDirectorStore((s) => s.project.scene.showLabels)
  return (
    <group>
      <ProceduralMannequin
        color={object.color}
        bodyType={object.bodyType}
        posePresetId={object.posePresetId}
        poseControls={object.poseControls}
      />
      {showLabels && <NameLabel text={object.name} y={2.4} color={object.color} />}
    </group>
  )
}
