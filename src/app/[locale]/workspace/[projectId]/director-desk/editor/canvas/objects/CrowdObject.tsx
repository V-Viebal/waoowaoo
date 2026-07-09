'use client'
import { useMemo } from 'react'
import { useDirectorStore } from '../../store/directorStore'
import { NameLabel } from '../NameLabel'
import type { DirectorObject } from '@/lib/director-desk/schema'

interface Props {
  object: DirectorObject
}

export function CrowdObject({ object }: Props) {
  const showLabels = useDirectorStore((s) => s.project.scene.showLabels)
  const cols = Math.max(1, object.crowdCount?.[0] ?? 2)
  const rows = Math.max(1, object.crowdCount?.[1] ?? 3)
  const spacingX = object.crowdSpacing?.[0] ?? 0.8
  const spacingZ = object.crowdSpacing?.[1] ?? 0.8

  const positions = useMemo(() => {
    const out: [number, number, number][] = []
    const offsetX = ((cols - 1) * spacingX) / 2
    const offsetZ = ((rows - 1) * spacingZ) / 2
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        out.push([c * spacingX - offsetX, 0.9, r * spacingZ - offsetZ])
      }
    }
    return out
  }, [cols, rows, spacingX, spacingZ])

  return (
    <group>
      {positions.map((p, i) => (
        <mesh key={i} position={p}>
          <capsuleGeometry args={[0.15, 1, 4, 8]} />
          <meshStandardMaterial color={object.color} roughness={0.8} metalness={0.05} />
        </mesh>
      ))}
      {showLabels && <NameLabel text={object.name} y={2.1} color={object.color} />}
    </group>
  )
}
