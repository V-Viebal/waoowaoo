import { describe, expect, it } from 'vitest'
import { initDirectorProjectFromPanel, inferCamera } from '@/lib/director-desk/init'

describe('auto-init director project from panel', () => {
  it('builds default scene with 中景 camera when metadata empty', () => {
    const proj = initDirectorProjectFromPanel({
      panel: { shotType: null, description: null, characters: [], props: [], location: null, photographyRules: null },
      project: { videoRatio: '9:16' },
    })
    expect(proj.version).toBe(1)
    expect(proj.cameras).toHaveLength(1)
    expect(proj.cameras[0].fov).toBe(50)
    expect(proj.objects).toHaveLength(0)
    expect(proj.scene.backdropAssetId).toBeNull()
  })

  it('特写 shotType -> fov 35, closer camera', () => {
    const cam = inferCamera('特写')
    expect(cam.fov).toBe(35)
    expect(cam.position[2]).toBeLessThan(3)
  })

  it('全景 shotType -> fov 60, far camera', () => {
    const cam = inferCamera('全景')
    expect(cam.fov).toBe(60)
    expect(cam.position[2]).toBeGreaterThan(8)
  })

  it('places two characters 左右 and adds a prop and backdrop', () => {
    const proj = initDirectorProjectFromPanel({
      panel: {
        shotType: '中景',
        description: '两人对峙',
        characters: [
          { name: '张三', imageMediaId: 'img-1', imageUrl: 'https://example.com/1.jpg' },
          { name: '李四', imageMediaId: 'img-2', imageUrl: 'https://example.com/2.jpg' },
        ],
        props: [{ name: '刀', imageMediaId: 'prop-1', imageUrl: 'https://example.com/prop.jpg' }],
        location: { name: '皇宫', imageMediaId: 'loc-1', imageUrl: 'https://example.com/loc.jpg' },
        photographyRules: {
          characters: [
            { name: '张三', screen_position: '画面左侧', posture: '站立', facing: '面向镜头' },
            { name: '李四', screen_position: '画面右侧', posture: '站立', facing: '面向镜头' },
          ],
        },
      },
      project: { videoRatio: '9:16' },
    })
    const chars = proj.objects.filter(o => o.kind === 'character')
    expect(chars).toHaveLength(2)
    expect(chars[0].refId).toBe('img-1')
    expect(chars[0].transform.position[0]).toBeLessThan(-1)
    expect(chars[1].transform.position[0]).toBeGreaterThan(1)
    expect(chars[0].facing).toBe(0)
    const props = proj.objects.filter(o => o.kind === 'prop')
    expect(props).toHaveLength(1)
    expect(props[0].refId).toBe('prop-1')
    expect(proj.scene.backdropAssetId).toBe('loc-1')
  })

  it('spreads characters evenly when no photographyRules', () => {
    const proj = initDirectorProjectFromPanel({
      panel: {
        shotType: '中景', description: null,
        characters: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
        props: [], location: null, photographyRules: null,
      },
      project: { videoRatio: '9:16' },
    })
    const xs = proj.objects.filter(o => o.kind === 'character').map(o => o.transform.position[0])
    expect(new Set(xs.map(Math.round)).size).toBe(3)
    xs.forEach(x => expect(x).toBeGreaterThanOrEqual(-3))
    xs.forEach(x => expect(x).toBeLessThanOrEqual(3))
  })
})
