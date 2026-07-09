'use client'
import { Canvas, useThree } from '@react-three/fiber'
import { GizmoHelper, GizmoViewport, OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { useEffect, useRef } from 'react'
import type { PerspectiveCamera as ThreePerspectiveCamera } from 'three'
import { useDirectorStore } from '../store/directorStore'
import { useActiveCamera } from '../store/directorSelectors'
import { SceneRoot } from './SceneRoot'

function CameraRig() {
  const setGlCanvas = useDirectorStore((s) => s.setGlCanvas)
  const viewMode = useDirectorStore((s) => s.viewMode)
  const active = useActiveCamera()
  const { gl } = useThree()

  useEffect(() => {
    setGlCanvas(gl.domElement)
    return () => setGlCanvas(null)
  }, [gl, setGlCanvas])

  if (viewMode === 'camera' && active) {
    return <CameraFromActive cam={active} />
  }
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 1.55, 5.4]} fov={50} near={0.05} far={200} />
      <OrbitControls makeDefault target={[0, 1.05, 0]} enableDamping />
    </>
  )
}

function CameraFromActive({ cam }: { cam: { position: [number, number, number]; target: [number, number, number]; fov: number } }) {
  const ref = useRef<ThreePerspectiveCamera>(null)
  useEffect(() => {
    if (!ref.current) return
    ref.current.position.set(cam.position[0], cam.position[1], cam.position[2])
    ref.current.lookAt(cam.target[0], cam.target[1], cam.target[2])
    ref.current.fov = cam.fov
    ref.current.updateProjectionMatrix()
  }, [cam.position, cam.target, cam.fov])
  return <PerspectiveCamera ref={ref} makeDefault fov={cam.fov} near={0.05} far={200} />
}

export function DirectorCanvas() {
  return (
    <Canvas
      shadows={false}
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      style={{ background: '#1a1d23' }}
    >
      <color attach="background" args={['#1a1d23']} />
      <CameraRig />
      <SceneRoot />
      <GizmoHelper alignment="top-right" margin={[80, 80]}>
        <GizmoViewport axisColors={['#E56C5B', '#6CDB7A', '#7AA7FF']} labelColor="white" />
      </GizmoHelper>
    </Canvas>
  )
}
