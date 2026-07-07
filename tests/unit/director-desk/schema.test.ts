import { describe, expect, it } from 'vitest'

import {
  createDefaultDirectorProject,
  parseDirectorProject,
  serializeDirectorProject,
  validateDirectorProjectSize,
  type DirectorProject,
} from '@/lib/director-desk/schema'

describe('director-desk schema', () => {
  it('roundtrips default project through serialize + parse', () => {
    const project = createDefaultDirectorProject()
    const json = serializeDirectorProject(project)
    const parsed = parseDirectorProject(JSON.parse(json))
    expect(parsed).not.toBeNull()
    expect(parsed?.version).toBe(1)
    expect(parsed?.cameras).toHaveLength(1)
    expect(parsed?.cameras[0].name).toBe('主机位')
    expect(parsed?.activeCameraId).toBe('cam-1')
    expect(parsed?.objects).toEqual([])
    expect(parsed?.scene.backgroundColor).toBe('#1a1d23')
    expect(parsed?.scene.showGround).toBe(true)
    expect(parsed?.scene.groundOpacity).toBe(0.8)
    expect(parsed?.scene.backdropAssetId).toBeNull()
  })

  it('rejects mismatched version', () => {
    const project = createDefaultDirectorProject()
    const raw = JSON.parse(serializeDirectorProject(project))
    raw.version = 2
    expect(parseDirectorProject(raw)).toBeNull()
  })

  it('rejects non-array objects/cameras', () => {
    const base = JSON.parse(serializeDirectorProject(createDefaultDirectorProject()))
    const badObjects = { ...base, objects: 'oops' }
    expect(parseDirectorProject(badObjects)).toBeNull()
    const badCameras = { ...base, cameras: null }
    expect(parseDirectorProject(badCameras)).toBeNull()
  })

  it('rejects oversized JSON', () => {
    const project = createDefaultDirectorProject()
    const filler = 'x'.repeat(1024 * 1024 + 10)
    const raw = { ...project, __filler: filler }
    const json = JSON.stringify(raw)
    expect(validateDirectorProjectSize(json)).toBe(false)

    const small = serializeDirectorProject(project)
    expect(validateDirectorProjectSize(small)).toBe(true)
  })

  it('strips imageUrl/backdropImageUrl on parse', () => {
    const project = createDefaultDirectorProject()
    project.scene.backdropImageUrl = 'https://example.com/bg.png'
    project.objects.push({
      id: 'obj-1',
      kind: 'prop',
      name: '参考图',
      refId: 'media-1',
      visible: true,
      locked: false,
      color: '#888',
      mode: 'billboard',
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      imageUrl: 'https://example.com/ref.png',
    })

    const json = serializeDirectorProject(project)
    const raw = JSON.parse(json) as DirectorProject & {
      scene: DirectorProject['scene']
    }
    // backdropImageUrl and imageUrl stripped by serializer
    expect(raw.scene.backdropImageUrl).toBeUndefined()
    expect(raw.objects[0]).not.toHaveProperty('imageUrl')

    // even if input contains them, parse discards
    const inputWithTransientFields = {
      ...raw,
      scene: { ...raw.scene, backdropImageUrl: 'https://x' },
      objects: [{ ...raw.objects[0], imageUrl: 'https://y' }],
    }
    const parsed = parseDirectorProject(inputWithTransientFields)
    expect(parsed).not.toBeNull()
    expect(parsed?.scene.backdropImageUrl).toBeNull()
    expect(parsed?.objects[0].imageUrl).toBeUndefined()
  })

  it('createDefaultDirectorProject returns 1 camera named 主机位 and empty objects', () => {
    const project = createDefaultDirectorProject()
    expect(project.cameras).toHaveLength(1)
    expect(project.cameras[0].name).toBe('主机位')
    expect(project.objects).toEqual([])
  })
})
