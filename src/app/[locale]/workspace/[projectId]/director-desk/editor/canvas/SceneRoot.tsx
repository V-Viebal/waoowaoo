'use client'
import { useDirectorStore } from '../store/directorStore'
import { Ground } from './Ground'
import { Backdrop } from './Backdrop'
import { CameraRigs } from './CameraRigs'
import { ViewportOverlays } from './ViewportOverlays'
import { TransformableObject } from './TransformableObject'
import { BillboardObject } from './objects/BillboardObject'
import { MannequinObject } from './objects/MannequinObject'
import { CrowdObject } from './objects/CrowdObject'

export function SceneRoot() {
  const objects = useDirectorStore((s) => s.project.objects)
  const select = useDirectorStore((s) => s.select)
  const viewMode = useDirectorStore((s) => s.viewMode)

  return (
    <group>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 8, 5]} intensity={1} />
      <hemisphereLight args={['#ffffff', '#333844', 0.35]} />
      {/* click on empty ground plane -> deselect */}
      <mesh
        position={[0, -0.001, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={(e) => {
          e.stopPropagation()
          select(null)
        }}
      >
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      <Ground />
      <Backdrop />
      {objects
        .filter((o) => o.visible)
        .map((o) => {
          let child
          if (o.kind === 'crowd') child = <CrowdObject object={o} />
          else if (o.kind === 'character' && o.mode === 'mannequin') child = <MannequinObject object={o} />
          else child = <BillboardObject object={o} />
          return (
            <TransformableObject key={o.id} objectId={o.id} transform={o.transform} locked={o.locked} kind={o.kind} mode={o.mode}>
              {child}
            </TransformableObject>
          )
        })}
      <CameraRigs />
      {viewMode === 'camera' && <ViewportOverlays />}
    </group>
  )
}
