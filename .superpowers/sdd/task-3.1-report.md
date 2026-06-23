# Task 3.1 Report: Editor Render Worker

## Status
DONE_WITH_CONCERNS

## render-server feasibility conclusion
- `@twick/render-server@0.15.31` exposes `renderTwickVideo(variables: any, settings: any): Promise<string>`.
- It returns a local rendered video file path.
- The package README says server-side rendering is Node.js + FFmpeg and requires Node.js 20+. It also notes Puppeteer/browser rendering support requirements.
- Its package dependencies include `@twick/renderer`, `@twick/ffmpeg`, `@twick/visualizer`, and the underlying `@twick/renderer` package depends on `puppeteer`.
- Current app package.json has Node engine `>=18.18.0`, while render-server requires Node `>=20.0.0`. Deployment must run the worker on Node 20+ with Puppeteer/headless browser support and FFmpeg/ffprobe available. The Twick README recommends the prebuilt Docker image for a known-good environment.

## Implementation depth
Implemented full orchestration and direct programmatic render integration:
- Route -> BullMQ task -> video worker dispatch -> `renderTwickVideo()` -> local file -> MinIO/storage upload -> `MediaObject` -> `NovelPromotionEditorProject` render fields.
- Rendering is not stubbed. Tests mock `@twick/render-server` because the local CI/dev environment is not guaranteed to provide the required browser/FFmpeg runtime.

## API route
Created `src/app/api/novel-promotion/[projectId]/editor/render/route.ts`:
- `POST`: auth + project ownership + editor project ownership, active-task concurrency guard for same `NovelPromotionEditorProject`, duration/settings normalization, submits `TASK_TYPE.EDITOR_RENDER` with `editor_export`-compatible payload, and sets editor render status to `PROCESSING`.
- `GET`: validates owned render task and returns task + editor render state.
- `DELETE`: validates owned render task, cancels via task service, removes queued BullMQ job best-effort, and resets queued export status to `IDLE` or started export status to `FAILED`.

## Worker handler
Created `src/lib/workers/handlers/editor-render-task-handler.ts` and wired it into `src/lib/workers/video.worker.ts` for `TASK_TYPE.EDITOR_RENDER`.

Worker behavior:
- Loads the owned editor project by `editorProjectId` + `episodeId`.
- Converts stored Twick project JSON into render-server input: `{ input: { ...timelineProject, properties: { width, height, fps } } }`.
- Recursively resolves media refs before rendering.
- Reports task progress at load, media-resolution, upload, and completion stages.
- Calls `renderTwickVideo(variables, { outDir, outFile, quality, bitrate? })`.
- Reads the local output file, uploads it through existing storage helpers, creates/ensures `MediaObject` with MIME/size/dimensions/duration metadata, and updates `NovelPromotionEditorProject.renderStatus/renderOutputMediaObjectId/renderSettings/renderTaskId`.
- Returns `actualQuantity = durationSeconds / 60` (min 0.01) so existing worker billing settlement charges actual per-minute export duration; failures rethrow through `withTaskLifecycle` so frozen billing is rolled back.

## mediaobj resolution
Extended `src/lib/twick/media-url-resolver.ts`:
- Existing `resolveMediaUrl()` remains front-end friendly and returns `/m/<publicId>`.
- Added `resolveMediaUrlForServerRender()` and batch variant. For `mediaobj://<id>`, it loads the `MediaObject`, signs the storage key with `getSignedObjectUrl`, and runs through `toFetchableUrl()` so render-server receives a server-fetchable URL.

## MinIO / MediaObject
- Upload uses existing `uploadObject()` storage abstraction, so it works with MinIO via the current storage provider.
- `ensureMediaObjectFromStorageKey()` creates/upserts the render output `MediaObject`.
- `NovelPromotionEditorProject.renderOutputMediaObjectId` is set to the created output media object.

## Billing
- `TASK_TYPE.EDITOR_RENDER` and `BILLING_ITEM.EDITOR_EXPORT` were already present.
- Existing policy bills `EDITOR_RENDER` as editor `editor_export` per minute.
- Route supplies `durationMinutes`/`quantity` for pre-freeze.
- Worker returns `actualQuantity` for settlement and relies on `withTaskLifecycle` rollback for failures/cancellations.

## Concurrency control
- Same editor project can have only one active `editor_render` task (`queued` or `processing`) at a time. A second `POST` returns `409 CONFLICT` with the active task id/status.

## Deployment requirements / concerns
- Worker deployment must run Node 20+ despite app package.json currently allowing Node >=18.18.
- Worker image/host must include Puppeteer-compatible headless browser dependencies and FFmpeg/ffprobe. Use Twick render-server Docker image guidance or bake equivalent dependencies into the app worker image.
- The implementation uses direct programmatic `@twick/render-server`; if production chooses a separate render microservice, `renderTwickVideoToFile()` is the integration seam to replace.

## Tests / verification

### Command
`npx vitest run tests/unit/worker/editor-render-task-handler.test.ts tests/unit/lib/twick/media-url-resolver.test.ts tests/unit/billing/task-policy.test.ts tests/integration/api/editor-render-route.test.ts`

### Output
```text
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

 RUN  v2.1.9 /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor

stderr | tests/integration/api/editor-render-route.test.ts > editor render route > rejects concurrent active render tasks for the same editor project
{"ts":"2026-06-23T09:40:11.667+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Editor render task already in progress","requestId":"req-render-1","projectId":"project-1","errorCode":"CONFLICT","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/render","errorType":"ApiError"},"error":{"name":"ApiError","message":"Editor render task already in progress","stack":"ApiError: Editor render task already in progress\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/render/route.ts:181:11\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-render-route.test.ts:188:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)","code":"CONFLICT"}}

 ✓ tests/integration/api/editor-render-route.test.ts (6 tests) 407ms
   ✓ editor render route > returns 401 when unauthenticated 393ms
 ✓ tests/unit/worker/editor-render-task-handler.test.ts (4 tests) 6ms
 ✓ tests/unit/lib/twick/media-url-resolver.test.ts (13 tests) 8ms
 ✓ tests/unit/billing/task-policy.test.ts (9 tests) 23ms

 Test Files  4 passed (4)
      Tests  32 passed (32)
   Start at  09:40:10
   Duration  1.92s (transform 347ms, setup 31ms, collect 251ms, tests 444ms, environment 1ms, prepare 222ms)
```

### Command
`npx tsc --noEmit 2>&1 | grep -iE "render|Render|editor.*handler"; exit 0`

### Output
```text

```
No render/editor-handler typecheck output.

### Command
`npm run typecheck`

### Output
```text
> vvicat@0.4.1 typecheck
> tsc --noEmit

tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(2,52): error TS2307: Cannot find module '@testing-library/react' or its corresponding type declarations.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(58,54): error TS2339: Property 'toBeInTheDocument' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(59,61): error TS2339: Property 'toBeInTheDocument' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(60,56): error TS2339: Property 'toBeInTheDocument' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(61,65): error TS2339: Property 'toBeInTheDocument' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(62,59): error TS2339: Property 'toBeInTheDocument' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(75,69): error TS2339: Property 'toBeInTheDocument' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(76,71): error TS2339: Property 'toBeInTheDocument' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(77,73): error TS2339: Property 'toBeInTheDocument' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(114,54): error TS2339: Property 'toHaveValue' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(115,61): error TS2339: Property 'toHaveValue' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(116,56): error TS2339: Property 'toHaveValue' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(117,65): error TS2339: Property 'toHaveValue' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(118,59): error TS2339: Property 'toHaveValue' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(135,25): error TS2339: Property 'toHaveValue' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(139,27): error TS2339: Property 'toHaveValue' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(193,69): error TS2339: Property 'toBeDisabled' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(218,36): error TS2339: Property 'toBeDisabled' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(235,40): error TS2339: Property 'toBeDisabled' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(284,58): error TS2339: Property 'toHaveValue' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(322,83): error TS2339: Property 'toBeInTheDocument' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(353,46): error TS2339: Property 'toBeInTheDocument' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(381,46): error TS2339: Property 'toBeInTheDocument' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(398,54): error TS2339: Property 'toHaveValue' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(411,56): error TS2339: Property 'toHaveValue' does not exist on type 'Assertion<any>'.
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx(426,59): error TS2339: Property 'toHaveValue' does not exist on type 'Assertion<any>'.
tests/unit/editor-stage-runtime.test.ts(455,24): error TS2741: Property 'name' is missing in type '{ id: string; type: string; elements: { id: string; type: string; s: number; e: number; props: { src: string; }; metadata: { panelId: string; storyboardId: string; }; }[]; }' but required in type 'TrackJSON'.
tests/unit/storyboard-images/grid-video-prompt.test.ts(100,9): error TS1117: An object literal cannot have multiple properties with the same name.
tests/unit/storyboard-images/grid-video-prompt.test.ts(126,11): error TS1117: An object literal cannot have multiple properties with the same name.
```

Full typecheck still fails on unrelated pre-existing test typing issues; there are no render/editor-handler errors after the fix.


## 修复轮次

### 6 个审查问题修复说明
1. **Important / 跨租户 mediaobj 签名泄露**
   - `resolveMediaUrlForServerRender()` 现在要求服务端渲染上下文 `{ userId, projectId, editorProjectId, episodeId }`。
   - 对 `mediaobj://<id>` 签名前，复用 Prisma 中既有 `MediaObject` 反向关联关系做可达性校验：当前项目 episode 的面板/分镜/语音/音频媒体、当前 `NovelPromotionEditorProject` 的 editor assets、当前用户的 global characters/locations/voices。
   - 不可达或缺上下文的 `mediaobj://` 直接抛错，不再静默签名。
   - worker 调用 `buildTwickRenderInput()` 时传入 `job.data.userId/projectId`、`episodeId`、`editorProjectId`。

2. **Important / 并发 409 竞态非原子**
   - `POST /editor/render` 不再用 `findFirst(active task) -> submitTask` 两步作为锁。
   - 改为先执行 `novelPromotionEditorProject.updateMany({ where: { id, episodeId, renderStatus in [IDLE, FAILED, DONE] }, data: { renderStatus: PROCESSING, renderTaskId: null, renderSettings } })`。
   - `count === 0` 表示已有导出持锁，返回 409；只有拿到原子状态锁的请求才会创建任务。
   - `submitTask` 失败时仅在 `renderTaskId: null` 的锁占位状态下回滚到原状态，避免误清理已创建任务。

3. **Important / duration metadata 过期导致计费低估**
   - 新增共享计算：`calculateTwickTimelineMaxEndSeconds()`、`calculateTwickTimelineDurationSeconds()`、`calculateEditorRenderBillingMinutes()`。
   - 时长取 `max(metadata.custom.duration, project.duration, max(track.elements[].e))`，而不是优先信任旧 metadata。
   - route 预冻结与 worker 结算都使用同一共享逻辑，保证 freeze 不低于实际轨道时长。

4. **Important / 渲染失败遗留临时文件**
   - 渲染前按 `taskId + format` 构造并记录 expected output path。
   - `finally` 同时清理 expected path 与 render-server 返回 path。
   - 额外扫描输出目录，删除同 task basename 的 sidecar/残片文件。

5. **Minor / EDITOR_RENDER 最小计费量不一致**
   - `task-policy` 中 `EDITOR_RENDER` 改为和 caption 一样使用 `minQuantity: 0.01`。
   - route/worker/task-policy 对短视频最小量保持 0.01 分钟一致，避免短视频按 1 分钟误冻结/误拒。

6. **Minor / 递归解析所有字符串误改非媒体字段**
   - worker 深度解析仍遍历项目 JSON，但仅对 `mediaobj://` 字符串调用 resolver。
   - 非 `mediaobj://` 字符串原样保留，`/` 开头的字幕文本/metadata 不会再被转换成 internal URL。

### Tests / verification

#### Command
`BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/worker/editor-render-task-handler.test.ts tests/unit/lib/twick/media-url-resolver.test.ts tests/unit/billing/task-policy.test.ts tests/integration/api/editor-render-route.test.ts --reporter=dot`

#### Output
```text
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

 RUN  v2.1.9 /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor

stderr | tests/integration/api/editor-render-route.test.ts > editor render route > rejects concurrent active render tasks for the same editor project when the atomic render lock is held
{"ts":"2026-06-23T10:04:22.658+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Editor render task already in progress","requestId":"req-render-1","projectId":"project-1","errorCode":"CONFLICT","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/render","errorType":"ApiError"},"error":{"name":"ApiError","message":"Editor render task already in progress","stack":"ApiError: Editor render task already in progress\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/render/route.ts:190:11\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-render-route.test.ts:200:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)","code":"CONFLICT"}}

stderr | tests/integration/api/editor-render-route.test.ts > editor render route > allows only one of two concurrent POST requests to create a render task
{"ts":"2026-06-23T10:04:22.663+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Editor render task already in progress","requestId":"req-render-1","projectId":"project-1","errorCode":"CONFLICT","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/render","errorType":"ApiError"},"error":{"name":"ApiError","message":"Editor render task already in progress","stack":"ApiError: Editor render task already in progress\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/render/route.ts:190:11\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at async Promise.all (index 1)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-render-route.test.ts:213:29\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"CONFLICT"}}

 ✓ tests/integration/api/editor-render-route.test.ts (8 tests) 758ms
   ✓ editor render route > returns 401 when unauthenticated 739ms
 ✓ tests/unit/worker/editor-render-task-handler.test.ts (4 tests) 10ms
 ✓ tests/unit/lib/twick/media-url-resolver.test.ts (15 tests) 7ms
 ✓ tests/unit/billing/task-policy.test.ts (10 tests) 21ms

 Test Files  4 passed (4)
      Tests  37 passed (37)
   Start at  10:04:21
   Duration  2.27s (transform 522ms, setup 21ms, collect 267ms, tests 795ms, environment 0ms, prepare 174ms)
```

#### Command
`npx tsc --noEmit 2>&1 | grep -iE "render|Render|editor.*handler|media-url"`

#### Output
```text

```
No render/editor-handler/media-url typecheck output.

#### Command
`git -C /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor diff --check`

#### Output
```text

```
No whitespace errors.

### Concerns
- `@twick/render-server` production runtime concern remains: worker host/image must provide Node 20+, browser/Puppeteer dependencies, and FFmpeg/ffprobe.
- Server-render media access is intentionally allowlist-based through existing `MediaObject` relation graph. If future editor timelines reference new MediaObject-owning tables, those relations must be added to the resolver allowlist before export can sign them.
