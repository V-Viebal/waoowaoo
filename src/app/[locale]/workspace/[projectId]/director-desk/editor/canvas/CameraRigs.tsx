'use client'
import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { useDirectorStore } from '../store/directorStore'
import { NameLabel } from './NameLabel'

function computeFrustumCorners(pos: THREE.Vector3, target: THREE.Vector3, fov: number, aspect: number, dist: number) {
  const forward = new THREE.Vector3().subVectors(target, pos).normalize()
  const up = new THREE.Vector3(0, 1, 0)
  if (Math.abs(forward.dot(up)) > 0.99) up.set(0, 0, 1)
  const right = new THREE.Vector3().crossVectors(forward, up).normalize()
  const upActual = new THREE.Vector3().crossVectors(right, forward).normalize()
  const hHalf = Math.tan((fov * Math.PI) / 360) * dist
  const wHalf = hHalf * aspect
  const center = new THREE.Vector3().copy(pos).addScaledVector(forward, dist)
  const tl = new THREE.Vector3().copy(center).addScaledVector(upActual, hHalf).addScaledVector(right, -wHalf)
  const tr = new THREE.Vector3().copy(center).addScaledVector(upActual, hHalf).addScaledVector(right, wHalf)
  const bl = new THREE.Vector3().copy(center).addScaledVector(upActual, -hHalf).addScaledVector(right, -wHalf)
  const br = new THREE.Vector3().copy(center).addScaledVector(upActual, -hHalf).addScaledVector(right, wHalf)
  return { tl, tr, bl, br }
}

function toPoints(v: THREE.Vector3): [number, number, number] {
  return [v.x, v.y, v.z]
}

function CameraFrustum({
  cam,
  isActive,
  onSelect,
  aspect,
  showLabels,
}: {
  cam: { id: string; name: string; fov: number; position: [number, number, number]; target: [number, number, number] }
  isActive: boolean
  aspect: number
  showLabels: boolean
  onSelect: (id: string) => void
}) {
  const color = isActive ? '#FFD166' : '#A9D8FF'
  const dist = 1.2
  const points = useMemo(() => {
    const pos = new THREE.Vector3(...cam.position)
    const target = new THREE.Vector3(...cam.target)
    const corners = computeFrustumCorners(pos, target, cam.fov, aspect, dist)
    const p = toPoints
    return {
      lines: [
        [p(pos), p(corners.tl)],
        [p(pos), p(corners.tr)],
        [p(pos), p(corners.bl)],
        [p(pos), p(corners.br)],
        [p(corners.tl), p(corners.tr)],
        [p(corners.tr), p(corners.br)],
        [p(corners.br), p(corners.bl)],
        [p(corners.bl), p(corners.tl)],
      ] as [number, number, number][][],
      pos: p(pos),
    }
  }, [cam.position, cam.target, cam.fov, aspect, dist])

  return (
    <group
      onClick={(e) => {
        e.stopPropagation()
        onSelect(cam.id)
      }}
    >
      {points.lines.map((pair, i) => (
        <Line key={i} points={pair} color={color} lineWidth={1.5} transparent opacity={0.85} />
      ))}
      <mesh position={points.pos as [number, number, number]}>
        <boxGeometry args={[0.22, 0.16, 0.28]} />
        <meshStandardMaterial color={color} metalness={0.4} roughness={0.6} transparent opacity={0.85} />
      </mesh>
      {showLabels && (
        <group position={[points.pos[0], points.pos[1] + 0.35, points.pos[2]]}>
          <NameLabel text={cam.name} y={0} color={color} />
        </group>
      )}
    </group>
  )
}

export function CameraRigs() {
  const cameras = useDirectorStore((s) => s.project.cameras)
  const activeId = useDirectorStore((s) => s.project.activeCameraId)
  const viewMode = useDirectorStore((s) => s.viewMode)
  const select = useDirectorStore((s) => s.select)
  const videoRatio = useDirectorStore((s) => s.videoRatio)
  const showLabels = useDirectorStore((s) => s.project.scene.showLabels)
  const aspect = useMemo(() => {
    const m = /^(\d+):(\d+)$/.exec(videoRatio)
    if (!m) return 9 / 16
    return Number(m[1]) / Number(m[2])
  }, [videoRatio])

  return (
    <group>
      {cameras.map((cam) => {
        const isActive = cam.id === activeId
        if (viewMode === 'camera' && isActive) return null
        if (cam.visible === false) return null
        return (
          <CameraFrustum
            key={cam.id}
            cam={cam}
            isActive={isActive}
            aspect={aspect}
            showLabels={showLabels}
            onSelect={select}
          />
        )
      })}
    </group>
  )
}
