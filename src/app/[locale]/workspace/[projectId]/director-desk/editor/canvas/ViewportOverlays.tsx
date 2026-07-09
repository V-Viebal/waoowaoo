'use client'
import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useDirectorStore } from '../store/directorStore'

function ratioToAspect(r: string): number {
  const m = /^(\d+):(\d+)$/.exec(r)
  if (!m) return 9 / 16
  return Number(m[1]) / Number(m[2])
}

export function ViewportOverlays() {
  const videoRatio = useDirectorStore((s) => s.videoRatio)
  const { camera } = useThree()
  const dist = 4

  // useMemo depends on camera position/target which we can't reactively track;
  // callback in Line re-invoked on every re-render is fine — but we don't
  // re-render on OrbitControls changes. For a static overlay this is OK because
  // camera view is fixed to the DirectorCamera; overlay stays aligned since it
  // reads camera transform when this component re-mounts on view switch.
  const points = useMemo(() => {
    const aspect = ratioToAspect(videoRatio)
    const persp = camera as THREE.PerspectiveCamera
    const hHalf = Math.tan((persp.fov * Math.PI) / 360) * dist
    const wHalf = hHalf * aspect
    const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize()
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize()
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize()
    const center = new THREE.Vector3().copy(camPos).addScaledVector(forward, dist)
    const tl = new THREE.Vector3().copy(center).addScaledVector(up, hHalf).addScaledVector(right, -wHalf)
    const tr = new THREE.Vector3().copy(center).addScaledVector(up, hHalf).addScaledVector(right, wHalf)
    const bl = new THREE.Vector3().copy(center).addScaledVector(up, -hHalf).addScaledVector(right, -wHalf)
    const br = new THREE.Vector3().copy(center).addScaledVector(up, -hHalf).addScaledVector(right, wHalf)
    const toArr = (v: THREE.Vector3): [number, number, number] => [v.x, v.y, v.z]
    const frame = [tl, tr, br, bl, tl].map(toArr) as [number, number, number][]

    const v1 = [
      new THREE.Vector3().copy(tl).addScaledVector(right, (wHalf * 2) / 3),
      new THREE.Vector3().copy(bl).addScaledVector(right, (wHalf * 2) / 3),
    ].map(toArr) as [number, number, number][]
    const v2 = [
      new THREE.Vector3().copy(tl).addScaledVector(right, (wHalf * 4) / 3),
      new THREE.Vector3().copy(bl).addScaledVector(right, (wHalf * 4) / 3),
    ].map(toArr) as [number, number, number][]
    const h1 = [
      new THREE.Vector3().copy(tl).addScaledVector(up, -(hHalf * 2) / 3),
      new THREE.Vector3().copy(tr).addScaledVector(up, -(hHalf * 2) / 3),
    ].map(toArr) as [number, number, number][]
    const h2 = [
      new THREE.Vector3().copy(tl).addScaledVector(up, -(hHalf * 4) / 3),
      new THREE.Vector3().copy(tr).addScaledVector(up, -(hHalf * 4) / 3),
    ].map(toArr) as [number, number, number][]
    return { frame, v1, v2, h1, h2 }
  }, [videoRatio, camera, camera.matrixWorld])

  return (
    <group>
      <Line points={points.frame} color="#ffffff" lineWidth={1.2} transparent opacity={0.85} />
      <Line points={points.v1} color="#ffffff" lineWidth={0.8} transparent opacity={0.35} />
      <Line points={points.v2} color="#ffffff" lineWidth={0.8} transparent opacity={0.35} />
      <Line points={points.h1} color="#ffffff" lineWidth={0.8} transparent opacity={0.35} />
      <Line points={points.h2} color="#ffffff" lineWidth={0.8} transparent opacity={0.35} />
    </group>
  )
}
