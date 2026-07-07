# Director's Desk (导演台) — Design Spec

**Date:** 2026-07-07
**Status:** Approved
**Reference project:** https://github.com/jiguang132/storyai-3d-director-desk (R3F + procedural mannequin, refactored into this codebase)

---

## 1. Overview

Add an in-browser 3D "director's desk" (previsualization / blocking tool) for every panel (镜头). Users open it from the panel card, get a 3D scene auto-populated with the panel's characters, location, and props, then drag things around, pose characters, frame camera shots, and save. The saved shot (camera framing screenshot + structured camera/position metadata) feeds back into panel image generation as the highest-priority reference image and prompt constraint, making generated frames match the director's blocking.

### User flow

```
镜头 (PanelCard)
  → 点击"🎬 导演台"按钮
  → 新窗口打开独立导演台页面 (同域, window.open, 可拖副屏)
  → 自动载入当前镜头的人物/场景/道具元数据 → 3D 渲染 (名字标签)
  → 人工布局 (拖动/旋转/缩放, 选姿势, 调机位 FOV/位置/朝向)
  → 保存 → 机位图 + 工程 JSON 存库
  → 生成分镜图时: 机位图作为第一参考图, 机位元数据注入 prompt context,
    站位/朝向反写 photographyRules
```

---

## 2. Key Decisions

| 维度 | 决定 |
|---|---|
| 集成形态 | **同域独立页面路由** (`/[locale]/workspace/[projectId]/director-desk?panelId=xxx`)，`window.open` 新窗口。同域共享 cookie，直接 REST API，不用 postMessage 协议。性能隔离（独立 React 树），可拖副屏。 |
| 角色呈现 | **混合模式**：默认 billboard 立牌（贴角色形象图，一眼可辨），可切换 mannequin（程序化胶囊人，调姿势体型）。 |
| 场景 | **网格地面 + 场景图弧形背板**（180° 圆柱内贴图），背板可切显隐/透明度/yaw。道具用 billboard 立牌（贴道具图）。 |
| 持久化 | **数据库**：`NovelPromotionPanel` 新增 `directorLayout` (TEXT, JSON 工程) + `directorShotMediaId` (FK → MediaObject, 激活机位截图)。跨设备可复用，机位图进入媒体库。 |
| 生图接入 | **图 + 文字双约束**：机位图作为参考图第一张（构图优先）；机位/角色坐标注入 `director_shot` prompt context；保存时反向同步 `photographyRules.characters[].screen_position/posture/facing` 中文 prose。 |
| 3D 栈 | `three` + `@react-three/fiber` + `@react-three/drei` + `zustand`。从参考项目移植核心 mannequin 代码，按本项目风格改写。 |

### v1 Scope (In)
- 多机位（cameras[] + activeCameraId + 机位切换）
- 群演分组（crowd kind, N×M capsule 阵列）
- 20 种姿势预设 + 8 种体型（mannequin 模式）
- 撤销/重做（内存 50 步，不持久化）
- 机位截图带文字标签（drei `<Text>` 原生 Three 文字，不走 Html DOM）

### v1 Scope (Out / YAGNI)
- FBX/OBJ 本地 3D 模型导入（资产库复杂度高，后续版本加）
- 跨窗口实时同步（主编辑器和导演台之间）；关窗后回主编辑器刷新即可看到更新
- Undo 栈持久化到 localStorage/DB（仅内存）
- 几何 primitive 占位道具（box/sphere 等）
- 3D 阴影 / PBR 后处理 / 物理
- e2e 3D canvas 截图测试

---

## 3. Architecture

```
PanelCard (storyboard 编辑页)
   │  点击"🎬 导演台"按钮
   ▼
window.open('/[locale]/workspace/[projectId]/director-desk?panelId=xxx')
   │
   ▼
[新窗口 / 独立 React 树 / 无主编辑器壳]
DirectorDeskPage (Next.js App Router page, 'use client')
   │  GET /api/.../director-desk/load?panelId=xxx
   │  初始化 zustand store (已有 directorLayout 就载入, 否则自动铺场景)
   ▼
┌──────────────────────────────────────────────────────┐
│ TopBar: 镜头名 | 导演/机位视角 | 重置/保存/关闭       │
├──────┬────────────────────────────────┬───────────────┤
│ 左   │                                │ 右            │
│ 对   │   R3F Canvas (3D 视图)         │ 属 性 面 板   │
│ 象   │  billboard/mannequin/背板/grid │ (选中驱动)    │
│ 树   │  camera gizmo + TransformCtl   │               │
│      │                                │               │
└──────┴────────────────────────────────┴───────────────┘
   │
   │  保存: POST /api/.../director-desk/save
   │    body: { panelId, project, activeCameraSnapshot }
   ▼
NovelPromotionPanel.directorLayout (TEXT JSON)
NovelPromotionPanel.directorShotMediaId (FK → MediaObject)
   │
   │  下次生成分镜图
   ▼
handlePanelImageTask:
  1. 机位图 → referenceImages[0] (weight 0.9)
  2. director_shot 元数据 → 注入 buildPanelPromptContext
  3. 反向同步 photographyRules 的站位/朝向文字
```

---

## 4. Data Model

### 4.1 Prisma additions — `NovelPromotionPanel`

```prisma
// append to NovelPromotionPanel model:
directorLayout          String?  @db.Text
directorShotMediaId     String?
directorShotMedia       MediaObject? @relation("NovelPromotionPanelDirectorShotMedia", fields: [directorShotMediaId], references: [id], onDelete: SetNull)
```

Pattern matches existing `sketchImageMedia` / `previousImageMedia` relations. Both fields nullable; migration additive, no backfill needed.

### 4.2 `directorLayout` JSON schema (TypeScript)

```ts
interface DirectorProject {
  version: 1
  scene: DirectorSceneSettings
  objects: DirectorObject[]
  cameras: DirectorCamera[]
  activeCameraId: string
}

interface DirectorSceneSettings {
  backgroundColor: string          // default '#1a1d23'
  showGround: boolean              // default true
  groundOpacity: number            // 0–1
  showLabels: boolean
  showGrid: boolean
  backdropAssetId: string | null   // LocationImage.imageMediaId
  backdropOpacity: number          // 0–1, default 0.6
  backdropYaw: number              // radians
}

type DirectorObjectKind = 'character' | 'prop' | 'crowd'
type DirectorRenderMode = 'billboard' | 'mannequin'

interface DirectorObject {
  id: string                       // uuid
  kind: DirectorObjectKind
  name: string
  refId: string | null             // character: CharacterAppearance.imageMediaId
                                   // prop: LocationImage.imageMediaId
                                   // crowd: null
  imageUrl: string | null          // signed URL resolved at load time (not persisted)
  visible: boolean
  locked: boolean
  color: string                    // mannequin tint; also dot color on tree
  mode: DirectorRenderMode
  transform: {
    position: [number, number, number]  // xyz meters
    rotation: [number, number, number]  // xyz radians
    scale: [number, number, number]
  }
  // character-specific
  bodyType?: 'mannequin'|'female'|'broad'|'muscular'|'slim'|'teen'|'child'|'chibi'
  posePresetId?: string                // key into POSE_PRESETS
  poseControls?: Record<string, number>
  facing?: number                      // radians around y; set = billboard locks, unset = always faces camera
  // crowd-specific
  crowdCount?: [number, number]        // [rows, cols]
  crowdSpacing?: [number, number]      // [x, z] meters
}

interface DirectorCamera {
  id: string
  name: string                      // '主机位', '特写', etc.
  fov: number                       // 10–120, default 50
  position: [number, number, number]
  target: [number, number, number]
}
```

**Changes vs reference project:**
- Drop `assets[]` (characters/location/props images already in MediaObject; no local FBX library)
- Drop panorama/equirectangular modes; only backdrop arc
- Billboard gains optional `facing` (when set, plane locks rotation instead of always face-camera)
- No global scene scale/position/rotation; ground always y=0
- v1 keeps cameras[] but UI surfaces a primary "active" camera flow; camera list is exposed in CameraPanel

### 4.3 Director shot media on MediaObject

The screenshot is uploaded via `uploadObject` (JPEG) → `ensureMediaObjectFromStorageKey` → FK attached to panel exactly like `sketchImageMedia`. Screenshot is rendered at project `videoRatio`, short edge 1024px, JPEG q=0.88.

---

## 5. API Routes

All under `/api/novel-promotion/[projectId]/director-desk/`, using existing `apiHandler` + `requireProjectAuthLight(projectId)` + `ApiError` patterns (see `src/app/api/novel-promotion/[projectId]/panel/route.ts`).

### 5.1 `GET /load?panelId=xxx`

Returns panel data + resolved asset URLs + existing `directorLayout` if present:

```ts
{
  panel: {
    id, panelNumber, shotType, cameraMove, description,
    characters: Array<{name, appearance, slot?, imageUrl, imageMediaId}>,
    props: Array<{name, imageUrl?, imageMediaId?}>,
    location: null | { name, imageUrl, imageMediaId, availableSlots: string[] },
    photographyRules: PhotographyRules | null,
    actingNotes: ActingNotes | null,
    directorLayout: DirectorProject | null
  },
  project: {
    videoRatio: string,            // '9:16' | '16:9' | '1:1'
  }
}
```

All `imageUrl` fields are signed COS URLs (1h TTL) resolved server-side. Prop resolution: match `panel.props[]` names against project `NovelPromotionLocation where assetKind='prop'` (case-insensitive, slash-alias).

### 5.2 `POST /save`

Body:
```ts
{ panelId: string, project: DirectorProject, activeCameraSnapshot: string }
```
`activeCameraSnapshot` = dataURL (image/jpeg, base64) of the active camera capture (with labels + aspect frame burned in).

Handler steps (in `prisma.$transaction`):
1. Auth + verify panel belongs to project.
2. Validate `project` schema (version === 1, arrays, background color regex, objects within reasonable bounds).
3. Validate size: `directorLayout` JSON ≤ 1MB; dataURL ≤ 5MB (after strip prefix, base64-decoded).
4. Decode dataURL → Buffer → upload COS via `uploadObject` → `ensureMediaObjectFromStorageKey` → get `MediaRef`.
5. Compute `photographyRules` patch from active camera + character positions (see §7.3).
6. `prisma.novelPromotionPanel.update({ where: { id: panelId }, data: { directorLayout: JSON.stringify(project), directorShotMediaId: mediaRef.id, photographyRules: newPhotographyRulesJsonOrPatch } })`.
7. Return `{ success: true }`.

If screenshot upload fails (storage error): still save `directorLayout` + photographyRules patch, but leave `directorShotMediaId` unchanged; return `{ success: true, warning: 'screenshot_upload_failed' }`. (Guard: don't lose a user's layout work because of a transient upload failure.)

### 5.3 `POST /close`

Optional telemetry endpoint. Frontend mostly just calls `window.close()`. v1: skip implementing; frontend calls close directly.

---

## 6. Frontend (Director Desk Page)

### 6.1 Route & page

- **New file:** `src/app/[locale]/workspace/[projectId]/director-desk/page.tsx`
- Pattern mirrors `src/app/[locale]/workspace/[projectId]/editor/page.tsx` — standalone page, not inside main workspace stage shell; no sidebar nav; full-screen director-desk layout.
- `'use client'` at top.
- Parse `panelId` from `useSearchParams()`. If missing → error state ("缺少 panelId 参数").
- On mount: call load API → init zustand store. While loading → full-screen spinner.

### 6.2 Entry point on PanelCard

Add a button to `ImageSectionActionButtons` (bottom-center pill):
- Icon: `Clapperboard` (lucide-react)
- Label: i18n key `storyboard.directorDesk` ('导演台')
- Not disabled when panel has no image (director desk is used *before* generation to seed composition)
- Click: `window.open(\`/${locale}/workspace/${projectId}/director-desk?panelId=${panelId}\`, '_blank', 'width=1400,height=900')`

Optional nicety (v1, small): if `panel.directorShotMediaId` exists, show a small "🎬" corner badge on the panel card image indicating "this panel has a saved blocking". Skip if it adds too much CSS friction.

### 6.3 3D Canvas

- Single R3F `<Canvas>` from `@react-three/fiber`.
- Director view default: `camera={{ fov: 50, position: [0, 1.55, 5.4] }}`, `<OrbitControls>` (drei).
- Camera view: swap to `<PerspectiveCamera makeDefault>` driven by active camera's fov/position/target; disable OrbitControls.
- Lighting: `<ambientLight intensity={0.6}/>` + `<directionalLight position={[5, 8, 5]} intensity={1.0}/>`. No shadows.
- Ground: `<gridHelper>` + semi-transparent `<Plane>` (receiveShadow off).
- Backdrop: open-ended cylinder geometry (sector 180°, radius 20m, height 10m, double-sided inside), `MeshBasicMaterial` with scene map (loaded via `useTexture`), controlled by `backdropOpacity/backdropYaw`.
- Camera rig visualization: draw active camera as a wireframe frustum + small box body (follow reference project's `getViewportCameraBodyWireframeLines` / `getViewportCameraFrustumLines`, color `#A9D8FF`); non-active cameras listed in tree show smaller marker. Rig geometry is offset backward from view origin so the gizmo does not occlude the lens (same `VIEWPORT_CAMERA_FRUSTUM_DEPTH` shift pattern as reference project).
- GizmoHelper/GizmoViewport in top-right (drei) for quick axis views.

### 6.4 Object rendering

**Billboard (default):**
- Use drei `<Billboard>` to face camera when `facing` is unset; otherwise a plain `<Plane>` rotated by `facing` around Y.
- Plane sized by image aspect (load with `useTexture`), default height 1.7m (character), 0.6m (prop).
- Round/capsule base disc on ground (color = object.color) to anchor.
- Name label: drei `<Text>` (NOT Html) floating 0.2m above the plane, white with semi-transparent dark backing panel (small `<Plane>` behind text). Using `<Text>` guarantees labels appear in canvas screenshots.
- Props: same as character billboard but half height, no name label (name only appears on hover/selection via a floating label — or always on; v1 keep simple: always show small label).

**Mannequin:**
- Port `ProceduralMannequin.tsx`, `mannequinParts.tsx`, `bodyTypes.ts`, `mannequinPose.ts`, `mannequinPosePresets.ts` from the reference project into `src/app/[locale]/workspace/[projectId]/director-desk/editor/runtime/mannequin/`.
- Material tinted by `object.color`; details in dark material.
- Supports all 8 body types + 20 pose presets + per-joint slider tweaks (`poseControls`).
- Name label via `<Text>` above head (y = body-type label anchor + 0.2m).

**Crowd:**
- Render `rows × cols` capsule primitives (simple, no images) in a grid with `crowdSpacing` gaps, centered on the crowd anchor transform.
- Single color (object.color) for all members.
- Single name label floating above center.
- Individual members are NOT selectable; selecting a crowd selects the group anchor; transforms move the entire crowd uniformly.

**Selection & transform:**
- Click = raycast select; store `selectedId` in store.
- When selected, wrap with drei `<TransformControls>` with current `transformMode` (translate/rotate/scale).
- Billboard mode: lock rotation to Y-only; scale mode enforced to uniform (all three axes driven by one scalar, applied as `[s,s,s]`) to prevent squishing the plane. Mannequin mode allows free scale.
- Q/W/E/R shortcuts cycle transform modes; Delete/Backspace removes selected; Ctrl+Z/Y undo/redo; Ctrl+C/V duplicates (position offset +1m forward).

### 6.5 Three-column shell layout

Reference project shell sizes: left 220px, right 300px. Copy.

**Left panel (ObjectTreePanel):**
- Search box at top.
- Groups (collapsible): 角色 / 群演 / 道具 / 摄像机.
- Each row: colored dot (object.color) + name (double-click to rename) + 👁 toggle visibility + 🔒 toggle lock.
- Multi-select (Shift/Ctrl click); Delete removes selection.

**Center (ViewportToolbar overlays on canvas):**
- Top-left: current camera name badge.
- Bottom: transform mode toggle (translate/rotate/scale), rule-of-thirds overlay toggle, label toggle, grid toggle.
- Rule-of-thirds overlay: draws a 3×3 grid inside the aspect frame using drei `<Line>` segments (in-scene so it appears in screenshots).

**Right panel (dispatch on selected kind):**
- **ScenePanel** (no selection / click bg): scene settings (bg color picker, ground toggles, grid, labels), backdrop settings (opacity slider, yaw slider, reset to location image; v1 only uses the resolved location image or solid color — local custom backdrop upload is a follow-up), capture/screenshot buttons (see 6.6), "重置为上次保存" button (reload from API), "添加群演" / "添加道具" quick-add.
- **CharacterPanel:**
  - Tab 1 "属性": name, position XYZ (numeric inputs), rotation Y (facing slider — other axes locked for billboard), uniform scale slider (0.2–3), color picker, appearance picker (lists all CharacterAppearance images for the character; switches refId/imageUrl), render mode toggle (billboard/mannequin).
  - Tab 2 "姿势" (only in mannequin mode): body-type selector (8 presets), pose preset grid (20 buttons), per-joint sliders (-90°..90° for shoulders/elbows/hips/knees/torso/head).
- **PropPanel:** transform (position/rotation Y/uniform scale), image picker (lists project props with images).
- **CameraPanel:**
  - Tab 1 "属性": camera dropdown/switcher, name, fov slider (10–120), position XYZ inputs, target XYZ inputs, "看向选中对象" button (fills target from selected object's position), "添加机位" / "删除机位" (cannot delete last camera), "设为激活机位".
  - Tab 2 "截图": thumbnail list of captures for this camera (stored in zustand memory, not persisted); "截取当前机位" button (renders to canvas, crops to aspect ratio, bakes Text labels); thumbnail click → preview modal; per-capture: "设为激活截图" / "下载" / "删除". The "active camera snapshot" sent to save API is the latest capture of activeCameraId (or, if none, auto-capture on save).
- **CrowdPanel:** rows/cols steppers, spacing sliders, color picker, transform, "解散群演" button (converts to individual characters? YAGNI: just remove the crowd).

### 6.6 TopBar

- Left: `Panel #{panelNumber}` + truncated `panel.description` (max 30 chars).
- Center: segmented control "导演视角 | 机位视角".
- Right:
  - "重置" (text button + tooltip "重置为上次保存"): confirms → re-call load API, overwrite store.
  - "保存" (primary button): captures active camera if no fresh capture → POST save API → toast success → clear dirty.
  - "保存并关闭": save → on success `window.close()`.
  - "×" close icon: if dirty → confirm dialog ("放弃未保存的布局？ 保存 / 放弃 / 取消"); if clean → `window.close()`.

### 6.7 Dirty tracking & unload protection

- Store maintains `isDirty: boolean`; any mutation action sets it true; successful save sets false; reset/load sets false.
- `beforeunload` listener: if isDirty, trigger browser's default "leave site?" confirmation.

### 6.8 Zustand Store

Shape (port from reference project, simplified):

```ts
interface DirectorStore {
  project: DirectorProject
  selectedId: string | null
  viewMode: 'director' | 'camera'
  transformMode: 'translate'|'rotate'|'scale'
  isDirty: boolean
  history: DirectorProject[]   // past states (undo)
  future: DirectorProject[]    // redo

  load(project: DirectorProject): void
  select(id: string | null): void
  setViewMode(m: 'director'|'camera'): void
  setTransformMode(m): void
  setSceneField<K extends keyof DirectorSceneSettings>(k: K, v: DirectorSceneSettings[K]): void
  setObjectField(id, field, value): void
  setObjectTransform(id, transform): void
  addObject(partial: Partial<DirectorObject>): string
  duplicateObject(id): string
  removeObject(id): void
  addCamera(partial?): string
  removeCamera(id): void
  setCameraField(id, field, value): void
  setActiveCamera(id): void
  undo(): void
  redo(): void
  reset(): void                 // calls API reload
  // selector helpers
  getSelectedObject(): DirectorObject | null
  getActiveCamera(): DirectorCamera | null
}
```

No localStorage persistence. Undo stack capped at 50 steps.

### 6.9 Dependencies

```bash
npm install three @react-three/fiber @react-three/drei zustand
npm install -D @types/three
```

Not installed: `camera-controls` (drei OrbitControls sufficient), `@react-three/postprocessing`, `zustand/middleware` persist (no persistence), `@react-three/drei` extras we don't use (imports tree-shake).

---

## 7. Auto-initialization (first open)

When `panel.directorLayout` is null (never opened before), construct a sensible default `DirectorProject` from existing panel metadata so user starts from a reasonable blocking rather than an empty stage.

### 7.1 Default scene

- `scene.backgroundColor = '#1a1d23'`, ground on, opacity 0.8, grid on, labels on.
- If `panel.location` resolved → `backdropAssetId = location.imageMediaId`, opacity 0.6, yaw 0. Else null.

### 7.2 Default camera (主机位)

Inferred from `panel.shotType`:

| shotType contains | fov | position | target |
|---|---|---|---|
| 特写 / 近景 | 35 | [0, 1.6, 2.0] | [0, 1.6, 0] |
| 中景 (default / no match) | 50 | [0, 1.55, 5.4] | [0, 1.55, 0] |
| 全景 / 远景 | 60 | [0, 3, 10] | [0, 1.2, 0] |
| 仰拍 | same base | [0, 0.8, base-z] | [0, 1.6, 0] |
| 俯拍 | same base | [0, base-y+2, base-z*0.7] | [0, 0.5, 0] |

If `photographyRules.characters[].screen_position` mentions left/right bias, nudge target.x slightly toward the opposite side by 0.5m.

### 7.3 Character placement

Parse `panel.characters` (already resolved to `{name, appearance, imageUrl, imageMediaId, slot?}`). For each character:

- Default position: x spread evenly (i * 1.5 - (n-1)*0.75), z = 0, y = 0.
- Override from `photographyRules.characters[i].screen_position` (Chinese prose → approximate x/z):
  - 画面左侧/左前方/左前… → x ≈ -2
  - 画面左中/左侧偏中 → x ≈ -1.5
  - 画面正中/中央/中间 → x ≈ 0
  - 画面右中/右侧偏中 → x ≈ 1.5
  - 画面右侧/右前方 → x ≈ 2
  - 前景/近景 → z ≈ 2
  - 后景/远景/背景 → z ≈ -2
- `slot` (from `availableSlots`) is Chinese free text; for v1, do NOT parse it for coordinates (too fuzzy). If screen_position is missing AND slot is set, keep default x-spread rather than guessing. (ponytail: bad heuristic > no heuristic here.)
- `facing` derived from `photographyRules.characters[i].facing`: "面向镜头"/"面向观众"/"正对" → 0; "背对镜头"/"背对" → π; "面向左侧"/"向左"/"看向画面左侧" → π/2; "面向右侧"/"向右"/"看向画面右侧" → -π/2; "面向右前方"等组合 → 对角 (±π/4). Default 0.
- `mode = 'billboard'`, `refId = imageMediaId`, `color` assigned from a rotating palette (red/blue/green/yellow/purple/cyan/orange).
- `bodyType = 'mannequin'` (default male); `posePresetId = 'stand'`.
- Posture from photographyRules: sitting/蹲/跪 → lower y by 0.5-0.8m (billboard only has y offset since no skeleton bend).

### 7.4 Prop placement

For each `panel.props[i]`:
- Match against project's `prop` assets (NovelPromotionLocation where assetKind='prop') by name (case-insensitive, slash aliases).
- If matched → create `kind: 'prop'` object, `refId = imageMediaId`, position `[(i - n/2)*0.8, 0, -1.5]` (front row), scale 0.6, mode billboard.
- If not matched → skip (YAGNI: no image, no point placing an invisible/silent prop; user can add later).

### 7.5 Fallback

If both `photographyRules` and characters are empty/malformed: place characters in a row at z=0 facing camera; default 中景 camera; no props.

---

## 8. Downstream Integration (Panel Image Generation)

### 8.1 Reference image: director shot as first reference

In `collectPanelReferenceImages` (`src/lib/workers/handlers/image-task-handler-shared.ts`), if `panel.directorShotMediaId` is set, prepend it to refs with an explicit role/priority marker:

```ts
if (panel.directorShotMediaId) {
  const media = await resolveMedia(panel.directorShotMediaId)
  if (media) refs.unshift({ url: toSignedUrlIfCos(media.storageKey), role: 'director_shot' })
}
// then: sketch → character appearances → location image
```

Existing `normalizeReferenceImagesForGeneration` deduplicates by URL; adjust if needed so the director shot stays first. No weight field exists in the current ref type — rely on position ordering (first image = strongest reference). The image prompt template already instructs the model to follow reference images; the in-prompt `director_shot` metadata (§8.2) reinforces this verbally.

### 8.2 Prompt context: `director_shot` field

In `buildPanelPromptContext` (`panel-image-task-handler.ts`), after building the panel/context sections, if `panel.directorLayout` parses successfully, attach:

```ts
const director = safeParseJson(panel.directorLayout) as DirectorProject | null
if (director?.version === 1) {
  const cam = director.cameras.find(c => c.id === director.activeCameraId)
  if (cam) {
    panelLike.director_shot = {
      camera_fov: cam.fov,
      camera_position: { x: round(cam.position[0],2), y: round(cam.position[1],2), z: round(cam.position[2],2) },
      camera_target:   { x: round(cam.target[0],2),   y: round(cam.target[1],2),   z: round(cam.target[2],2)   },
      characters: director.objects
        .filter(o => o.kind === 'character' && o.visible)
        .map(o => ({
          name: o.name,
          position: { x: round(o.transform.position[0],2), y: round(o.transform.position[1],2), z: round(o.transform.position[2],2) },
          facing_deg: Math.round(((o.facing ?? 0) * 180) / Math.PI),
          posture: o.posePresetId ?? 'stand',
          render_mode: o.mode,
        })),
    }
  }
}
```

This gets serialized into the existing `storyboard_text_json_input` placeholder in both single and grid prompt templates — no template restructuring needed, but append a strict rule to both `single_panel_image.zh.txt` and `panel_grid_image.zh.txt` under the `【分镜数据】` block:

```
- 若分镜数据包含 director_shot（导演台预演机位元数据），则必须严格遵循其摄像机 FOV、机位坐标、look-at 目标、角色站位和朝向来构图。
  参考图中第一张为导演台机位图（含角色站位示意和名字标注），是最高优先级的构图参考。
  坐标系说明：单位米，y 轴向上，z 轴负方向为镜头前方，x 轴向右。
```

Grid video prompt rewrites automatically benefit: `gridVideoPromptAt` flow reads `gridGenerationContext`, which is a serialized snapshot of the promptContext — `director_shot` rides along.

### 8.3 Reverse-sync to `photographyRules` on save

When saving, compute a patch for `photographyRules.characters[]` (only touch these three fields; preserve lighting/color_tone/depth_of_field/scene_summary):

For each character in directorLayout (kind='character', visible), compute:

1. **screen_position (Chinese prose)**: Project character world position into active camera viewport NDC using the camera's view-projection; map (nx, ny) ∈ [-1,1]×[-1,1] to a 3×3 grid × depth label:
   - col = nx < -0.33 ? '左侧' : nx > 0.33 ? '右侧' : '正中'
   - row = ny > 0.33 ? '上方' : ny < -0.33 ? '下方' : '中部' (Three.js NDC y up)
   - depth = character's distance-to-camera vs average: 20% closer than average → '前景', 20% farther → '后景', else ''
   - composite: e.g. `画面左侧中部`, `画面右下方前景`, `画面正中`
2. **posture (Chinese)**: map `posePresetId` → Chinese using a POSE_PRESET_ID_ZH map (stand→站立, sit→坐着, crouch→蹲伏, kneel-one→单膝跪, kneel-two→双膝跪, walk→行走, run→奔跑, lean→倚靠, bow→鞠躬, think→沉思, fight→打斗, kick→踢, throw→投掷, push→推搡, wave→挥手, reach→伸手, cross-arms→抱臂, phone→看手机, hands-on-hips→叉腰, t-pose→T-姿势). billboard + no posePresetId → '站立'.
3. **facing (Chinese)**: angle between character forward (based on `facing`) and camera forward. Compute angle delta (0..π):
   - abs(delta) < π/8 (22.5°) → '面向镜头'
   - abs(delta - π) < π/8 → '背对镜头'
   - delta > 0 → '面向画面右侧' (character's right = camera's left when facing camera — verify sign with Three.js math)
   - delta < 0 → '面向画面左侧'

Algorithm: compute char-to-cam vector, project to XZ plane, compare with character forward (-Z rotated by `facing` around Y), get signed angle in radians.

Then merge into existing photographyRules:
- Parse existing `panel.photographyRules` JSON (if null → create empty `{ characters: [] }`).
- For each director character: if a matching `characters[i]` by name exists → patch its `screen_position`, `posture`, `facing`; else push a new `{ name, screen_position, posture, facing }` entry.
- Characters in photographyRules but NOT in directorLayout: leave untouched (director didn't remove them; they might be offscreen or referenced elsewhere). Guard: do NOT delete them.
- Stringify back and save.

### 8.4 Unchanged flows
- Video generation (panel-to-video, first-last-frame) reads panel.imagePrompt/videoPrompt; since the single image now reflects the director's blocking, downstream video inherits it automatically. No code changes.
- Lip sync / TTS / voice lines / editor projects: unrelated, untouched.
- Panel variants (`handlePanelVariantTask`): variants should also include director_shot in their prompt context — since they likely call `buildPanelPromptContext` or reuse the panel's existing `imagePrompt` (which is now generated with director_shot), verify and ensure the director_shot flows through (ponytail: check variant handler in code review; if it builds its own context, add the same director_shot block there too).
- Candidate selection / undo / regenerate: no changes.

---

## 9. Screenshot Generation

The "active camera snapshot" is produced client-side via R3F's `gl.domElement.toDataURL('image/jpeg', 0.88)` (or `gl.getContext().canvas.toDataURL`). Before readback:

1. Switch view to camera view on active camera.
2. Ensure labels (drei `<Text>`), grid-of-thirds overlay, aspect frame are visible.
3. Ensure UI chrome (TransformControls gizmo, OrbitControls, GizmoHelper, Tree/Props panels are DOM and not on the canvas — already safe) is hidden; specifically hide the camera rig wireframe for the active camera (don't show a wireframe of the camera we're looking through).
4. Render one frame; read back; crop to the project's `videoRatio` aspect (letterbox crop around center) at short-edge 1024px.
   - Use Three.js viewport or a secondary offscreen canvas + `drawImage` to crop and resize; the cropped JPEG is what gets sent to the save API.
5. If capture fails (e.g., toDataURL blocked, or context lost), fall back to not sending a screenshot (per §5.2 guard: layout still saves).

Non-active cameras can have captures too (stored in memory as dataURLs in zustand `captures: Record<cameraId, Array<{id, dataUrl, meta}>>`) for the director's own reference while staging; only the active camera's latest capture is uploaded.

---

## 10. Testing

### 10.1 Unit tests (`tests/unit/`)

- `director-desk/schema.test.ts` — DirectorProject parse/validate/serialize roundtrip; version migration (future schema bumps); invalid inputs (missing arrays, bad hex color, oversized positions) reject or default.
- `director-desk/position-to-prose.test.ts` — the §8.3 viewport projection + prose mapper:
  - Character at center → '画面正中'
  - Character at (x=-2, z=0), cam at (0,1.55,5.4) → 画面左侧 (plus 中部/上方 check)
  - Character much closer to cam → adds '前景'
  - Pose preset map roundtrip (all 20 presets map to a Chinese string)
  - Facing angle → Chinese prose (0→面向镜头, π→背对, ±π/2→两侧)
- `director-desk/auto-init.test.ts` — given a representative panel (shotType=中景, 2 characters with photographyRules screen_position 左/右, one location, one prop):
  - Returns DirectorProject with 1 camera (fov 50), 2 characters (x≈-2 and x≈2), 1 prop, backdrop set.
  - Missing photographyRules → characters spread evenly; default camera.
  - Missing location → backdropAssetId null.

### 10.2 Integration tests (`tests/integration/api/`)

- `director-desk/load.test.ts`
  - Auth required; wrong project → 403.
  - No directorLayout yet → directorLayout null; all imageUrls signed.
  - Existing directorLayout → parses and returns back.
- `director-desk/save.test.ts`
  - Happy path: directorLayout + valid dataURL → panel updated; MediaObject created; directorShotMediaId set.
  - Corrupt JSON → 400.
  - JSON > 1MB → 400.
  - Storage failure (mocked): returns warning; directorLayout + photographyRules still saved; directorShotMediaId unchanged.
  - Unmatched character name in photographyRules patch appends a new entry rather than crashing.
- `director-desk/auth.test.ts`: user B cannot save a panel in user A's project.

### 10.3 Guard tests (`tests/guards/`)

- `director-desk/corrupt-layout-guard.test.ts`:
  - If directorLayout is unparseable (garbage), load API returns null directorLayout (frontend falls back to auto-init), and image generation still succeeds (director_shot undefined, referenceImages does not include director shot, no crash).
- `director-desk/old-panel-generates.test.ts`:
  - A panel with null directorLayout still generates an image exactly as before (no director_shot key, prompt template unchanged structurally, no extra reference image).

### 10.4 Not tested (ponytail)
- R3F canvas rendering e2e tests (flaky, low ROI; covered implicitly by manual testing).
- Undo/redo stack state transitions (trivial zustand logic; not worth unit tests).

---

## 11. File Map (Approximate)

New files:
```
prisma/migrations/<timestamp>_add_director_layout/  (migration)
src/app/[locale]/workspace/[projectId]/director-desk/
  page.tsx                                         (route entry, mirrors editor/page.tsx pattern)
  layout.tsx                                       (minimal layout, no main nav)
  loading.tsx
  editor/
    DirectorDeskShell.tsx                          (3-column layout)
    TopBar.tsx
    store/
      directorStore.ts
      directorSelectors.ts
    schema/
      directorProject.ts                           (types + validators + defaults)
      cameraGeometry.ts                            (rig-vs-view offset math)
      poseSchema.ts                                (POSE_PRESET_IDS, body type keys)
      positionToProse.ts                           (§8.3 mapper, unit-tested)
      autoInitialize.ts                            (§7 logic, unit-tested)
    canvas/
      DirectorCanvas.tsx                           (R3F Canvas + director/camera camera switch)
      SceneRoot.tsx                                (renders all objects/lights/ground/backdrop)
      Ground.tsx
      Backdrop.tsx
      CameraRigs.tsx                               (wireframe cameras + frustum lines)
      ViewportOverlays.tsx                         (aspect frame, rule-of-thirds)
      TransformableObject.tsx                      (wraps selected in TransformControls)
      objects/
        BillboardCharacter.tsx
        BillboardProp.tsx
        MannequinCharacter.tsx
        CrowdGroup.tsx
        NameLabel.tsx                              (drei <Text> with backing plane)
    runtime/mannequin/                             (ported from reference project, sans UE4 mannequin — v1 no external model support)
      ProceduralMannequin.tsx
      mannequinParts.tsx
      bodyTypes.ts
      mannequinPose.ts
    panels/
      ObjectTreePanel.tsx
      RightPanel.tsx
      ScenePanel.tsx
      CharacterPanel.tsx
      PropPanel.tsx
      CameraPanel.tsx
      CrowdPanel.tsx
    io/
      screenshot.ts                                (capture + crop + jpeg)
      loadApi.ts
      saveApi.ts
src/app/api/novel-promotion/[projectId]/director-desk/
  load/route.ts
  save/route.ts
src/lib/director-desk/                             (shared server-side logic)
  schema.ts                                        (validation, parse, migrate)
  photographyRules.ts                              (§8.3 reverse-sync helpers)
  init.ts                                          (§7 auto-init server helpers — used by load API when layout null)
tests/unit/director-desk/schema.test.ts
tests/unit/director-desk/position-to-prose.test.ts
tests/unit/director-desk/auto-init.test.ts
tests/integration/api/director-desk/load.test.ts
tests/integration/api/director-desk/save.test.ts
tests/integration/api/director-desk/auth.test.ts
tests/guards/director-desk/corrupt-layout-guard.test.ts
tests/guards/director-desk/old-panel-generates.test.ts
```

Modified files:
```
prisma/schema.prisma                               (add directorLayout + directorShotMediaId to NovelPromotionPanel)
src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/ImageSectionActionButtons.tsx
                                                     (add 🎬 导演台 button)
src/lib/workers/handlers/panel-image-task-handler.ts
                                                     (buildPanelPromptContext: attach director_shot)
src/lib/workers/handlers/image-task-handler-shared.ts
                                                     (collectPanelReferenceImages: prepend director shot)
lib/prompts/novel-promotion/single_panel_image.zh.txt
lib/prompts/novel-promotion/single_panel_image.en.txt
lib/prompts/novel-promotion/panel_grid_image.zh.txt
lib/prompts/novel-promotion/panel_grid_image.en.txt
                                                     (append director_shot rule under 分镜数据)
src/lib/workers/handlers/panel-variant-task-handler.ts
                                                     (verify director_shot flows through, add if not)
messages/zh/common.json (or storyboard.json)         (add storyboard.directorDesk key)
messages/en/*.json
```

(Prompt templates for other locales — only zh/en exist per repo; update those.)

---

## 12. Open Issues / Follow-ups (post-v1)

- FBX/OBJ local 3D model import with persistent local model library.
- Cross-window real-time sync (BroadcastChannel or postMessage) so main editor sees live state.
- Geometry primitives (box/sphere/cone) as placeholder props.
- Drop shadows + SSAO + better PBR lighting for more realistic blocking.
- UE4 mannequin model support (code ported but disabled).
- Per-camera non-active screenshot persistence to MediaObject.
- "Apply blocking to neighboring panels" batch operation (same location, similar characters → copy layout with minor tweaks).
- Director-shot panel card thumbnail preview + click-to-enlarge.
