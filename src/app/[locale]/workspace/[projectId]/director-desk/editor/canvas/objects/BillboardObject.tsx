'use client'
import { useMemo } from 'react'
import { Billboard, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { useDirectorStore } from '../../store/directorStore'
import { NameLabel } from '../NameLabel'
import type { DirectorObject } from '@/lib/director-desk/schema'

interface Props {
  object: DirectorObject
}

function ImagePlane({ url, height }: { url: string; height: number }) {
  const texture = useTexture(url)
  ;(texture as THREE.Texture).colorSpace = THREE.SRGBColorSpace
  const image = texture.image as HTMLImageElement | undefined
  const aspect = image && image.width ? image.width / image.height : 0.6
  const width = height * aspect
  return (
    <mesh position={[0, height / 2, 0]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent side={THREE.DoubleSide} />
    </mesh>
  )
}

function Placeholder({ color, height }: { color: string; height: number }) {
  const width = height * 0.6
  return (
    <mesh position={[0, height / 2, 0]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} />
    </mesh>
  )
}

export function BillboardObject({ object }: Props) {
  const showLabels = useDirectorStore((s) => s.project.scene.showLabels)
  const height = object.kind === 'character' ? 1.7 : 0.6
  const url = object.imageUrl
  const facing = object.facing

  const disc = useMemo(
    () => (
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <circleGeometry args={[0.35, 24]} />
        <meshBasicMaterial color={object.color} transparent opacity={0.6} />
      </mesh>
    ),
    [object.color],
  )

  const inner = url ? <ImagePlane url={url} height={height} /> : <Placeholder color={object.color} height={height} />

  return (
    <group>
      {disc}
      {typeof facing === 'number' ? (
        <group rotation={[0, facing, 0]}>{inner}</group>
      ) : (
        <Billboard>{inner}</Billboard>
      )}
      {showLabels && <NameLabel text={object.name} y={height + 0.22} color={object.color} />}
    </group>
  )
}
