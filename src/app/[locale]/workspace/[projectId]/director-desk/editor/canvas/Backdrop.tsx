'use client'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { useDirectorStore } from '../store/directorStore'

function BackdropInner({ url, opacity, yaw }: { url: string; opacity: number; yaw: number }) {
  const texture = useTexture(url)
  ;(texture as THREE.Texture).colorSpace = THREE.SRGBColorSpace
  return (
    <mesh position={[0, 5, 0]} rotation={[0, yaw + Math.PI / 2, 0]}>
      <cylinderGeometry args={[20, 20, 10, 48, 1, true, Math.PI / 2, Math.PI]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} transparent opacity={opacity} />
    </mesh>
  )
}

export function Backdrop() {
  const scene = useDirectorStore((s) => s.project.scene)
  const url = scene.backdropImageUrl
  if (!url) return null
  return <BackdropInner url={url} opacity={scene.backdropOpacity} yaw={scene.backdropYaw} />
}
