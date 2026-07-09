'use client'
import { useDirectorStore } from '../store/directorStore'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-white/70">
      <span className="w-24 shrink-0">{label}</span>
      <div className="flex-1">{children}</div>
    </label>
  )
}

export function ScenePanel() {
  const scene = useDirectorStore((s) => s.project.scene)
  const setSceneField = useDirectorStore((s) => s.setSceneField)
  const addCamera = useDirectorStore((s) => s.addCamera)
  const addObject = useDirectorStore((s) => s.addObject)
  const reset = useDirectorStore((s) => s.reset)

  return (
    <div className="flex flex-col gap-3 text-xs text-white/80">
      <div className="mb-1 text-sm font-medium">场景设置</div>

      <Row label="背景色">
        <input
          type="color"
          value={scene.backgroundColor}
          onChange={(e) => setSceneField('backgroundColor', e.target.value)}
          className="h-6 w-full cursor-pointer rounded border border-white/10 bg-transparent"
        />
      </Row>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={scene.showGround}
          onChange={(e) => setSceneField('showGround', e.target.checked)}
        />
        <span>显示地面</span>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={scene.showGrid}
          onChange={(e) => setSceneField('showGrid', e.target.checked)}
        />
        <span>网格</span>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={scene.showLabels}
          onChange={(e) => setSceneField('showLabels', e.target.checked)}
        />
        <span>名字标签</span>
      </label>

      <Row label="地面透明度">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={scene.groundOpacity}
          onChange={(e) => setSceneField('groundOpacity', Number(e.target.value))}
          className="w-full"
        />
      </Row>
      <Row label="背板透明度">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={scene.backdropOpacity}
          onChange={(e) => setSceneField('backdropOpacity', Number(e.target.value))}
          className="w-full"
        />
      </Row>
      <Row label="背板旋转">
        <input
          type="range"
          min={-Math.PI}
          max={Math.PI}
          step={0.05}
          value={scene.backdropYaw}
          onChange={(e) => setSceneField('backdropYaw', Number(e.target.value))}
          className="w-full"
        />
      </Row>

      <div className="mt-4 border-t border-white/10 pt-3">
        <div className="mb-2 text-sm font-medium">截图 / 机位</div>
        <div className="mb-2 text-[11px] text-white/50">在左侧选择机位后截图</div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => addCamera()}
            className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs hover:bg-white/10"
          >
            添加机位
          </button>
          <button
            onClick={() =>
              addObject({
                kind: 'crowd',
                name: '群演',
                crowdCount: [2, 3],
                crowdSpacing: [0.8, 0.8],
                color: '#888888',
                refId: null,
              })
            }
            className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs hover:bg-white/10"
          >
            添加群演
          </button>
        </div>
      </div>

      <button
        onClick={() => {
          if (confirm('确定重置为上次保存吗？')) void reset()
        }}
        className="mt-4 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/60 hover:bg-white/10"
      >
        重置为上次保存
      </button>
    </div>
  )
}
