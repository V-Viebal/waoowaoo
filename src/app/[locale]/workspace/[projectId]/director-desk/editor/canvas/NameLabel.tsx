'use client'
import { Text, Billboard } from '@react-three/drei'

interface NameLabelProps {
  text: string
  y: number
  color?: string
}

export function NameLabel({ text, y, color = '#f4f6fb' }: NameLabelProps) {
  const width = Math.max(0.6, text.length * 0.12 + 0.3)
  return (
    <Billboard position={[0, y, 0]}>
      <mesh>
        <planeGeometry args={[width, 0.28]} />
        <meshBasicMaterial color="#0f1216" transparent opacity={0.68} depthWrite={false} />
      </mesh>
      <Text fontSize={0.2} color={color} anchorX="center" anchorY="middle" position={[0, 0, 0.001]}>
        {text}
      </Text>
    </Billboard>
  )
}
