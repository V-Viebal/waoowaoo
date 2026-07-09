'use client'
import { TransformControls } from '@react-three/drei'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { useDirectorStore } from '../store/directorStore'
import type { DirectorObject } from '@/lib/director-desk/schema'

interface TransformableObjectProps {
  objectId: string
  transform: DirectorObject['transform']
  locked: boolean
  kind: DirectorObject['kind']
  mode: DirectorObject['mode']
  children: React.ReactNode
}

export function TransformableObject({ objectId, transform, locked, kind, mode, children }: TransformableObjectProps) {
  const groupRef = useRef<THREE.Group>(null)
  const draggingRef = useRef(false)
  const selectedId = useDirectorStore((s) => s.selectedId)
  const transformMode = useDirectorStore((s) => s.transformMode)
  const setObjectTransform = useDirectorStore((s) => s.setObjectTransform)
  const select = useDirectorStore((s) => s.select)
  const { controls: sceneControls } = useThree() as { controls: { enabled: boolean } | null }

  const isSelected = selectedId === objectId

  useEffect(() => {
    // Skip sync while the user is mid-drag — avoids fighting TransformControls.
    if (draggingRef.current) return
    if (!groupRef.current) return
    groupRef.current.position.set(transform.position[0], transform.position[1], transform.position[2])
    groupRef.current.rotation.set(transform.rotation[0], transform.rotation[1], transform.rotation[2])
    groupRef.current.scale.set(transform.scale[0], transform.scale[1], transform.scale[2])
  }, [transform])

  const commit = () => {
    if (!groupRef.current) return
    const g = groupRef.current
    let rx = g.rotation.x
    const ry = g.rotation.y
    let rz = g.rotation.z
    const sx = g.scale.x
    let sy = g.scale.y
    let sz = g.scale.z
    // billboards: Y-only rotation + uniform scale
    if (kind !== 'crowd' && mode === 'billboard') {
      rx = 0
      rz = 0
      const s = sx
      sy = s
      sz = s
    }
    setObjectTransform(objectId, {
      position: [g.position.x, g.position.y, g.position.z],
      rotation: [rx, ry, rz],
      scale: [sx, sy, sz],
    })
  }

  const group = (
    <group
      ref={groupRef}
      onClick={(e) => {
        e.stopPropagation()
        select(objectId)
      }}
    >
      {children}
    </group>
  )

  if (isSelected && !locked) {
    return (
      <TransformControls
        mode={transformMode}
        onMouseDown={() => {
          draggingRef.current = true
          if (sceneControls && 'enabled' in sceneControls) sceneControls.enabled = false
        }}
        onMouseUp={() => {
          draggingRef.current = false
          if (sceneControls && 'enabled' in sceneControls) sceneControls.enabled = true
        }}
        onObjectChange={commit}
      >
        {group}
      </TransformControls>
    )
  }
  return group
}
