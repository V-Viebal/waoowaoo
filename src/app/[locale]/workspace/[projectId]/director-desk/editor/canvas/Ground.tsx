'use client'
import { Grid } from '@react-three/drei'
import { useDirectorStore } from '../store/directorStore'

export function Ground() {
  const scene = useDirectorStore((s) => s.project.scene)
  if (!scene.showGround) return null
  return (
    <group>
      {scene.showGrid && (
        <Grid
          args={[40, 40]}
          cellSize={0.5}
          cellThickness={0.7}
          cellColor="#3a3f47"
          sectionSize={5}
          sectionThickness={1.2}
          sectionColor="#5b6371"
          fadeDistance={40}
          fadeStrength={1.4}
          infiniteGrid
        />
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]} receiveShadow={false}>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#181c22" transparent opacity={scene.groundOpacity} roughness={0.95} />
      </mesh>
    </group>
  )
}
