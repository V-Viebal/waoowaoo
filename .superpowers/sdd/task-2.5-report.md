# Task 2.5 Report: Twick Editor AI Enhance

## Status

DONE_WITH_CONCERNS

## Provider exploration findings

Read/checked:

- `src/lib/image-generation/*`
- `src/lib/workers/handlers/image-task-handlers-core.ts`
- `src/lib/workers/video.worker.ts`
- `src/lib/generator-api.ts`
- `src/lib/generators/factory.ts`
- `src/lib/lipsync/index.ts`
- `standards/capabilities/image-video.catalog.json`
- `src/lib/model-config-contract.ts`
- `src/lib/model-capabilities/catalog.ts`

Findings:

- No existing real video enhancement provider was found.
- Existing video worker supports only `VIDEO_PANEL` image-to-video generation and `LIP_SYNC`.
- Existing image modification path supports generic image editing/generation, not video restore/upscale/crop.
- Provider/capability configs include image/video generation options such as aspect ratio, duration, fps, resolution, first/last frame, audio generation, etc.; no `upscale`, `restore`, `enhance`, or video-crop capability is modeled.
- Existing `TASK_TYPE.EDITOR_AI_ENHANCE` + route/billing labels existed, but no worker handler existed before this task.

## MVP implemented

Because no real video enhancement provider exists, MVP was scoped to parameterized smart crop only:

- `smart_crop`:
  - Validates a selected timeline video element at route and worker layers.
  - Does not generate a new video file.
  - Updates the selected video element's Twick props/metadata:
    - `props.objectFit = 'cover'`
    - `props.fit = 'cover'`
    - `props.crop = { mode: 'smart_crop', targetAspectRatio, anchor, strength }`
    - `metadata.source = 'ai_enhanced'`, `metadata.enhanceType = 'smart_crop'`, original src preserved in metadata.
  - Uses optimistic-lock retry when persisting editor project `projectData`.
  - Keeps the original `props.src` unchanged.
  - Does not create `MediaObject` or `NovelPromotionEditorAsset`, because no new media is produced.
  - Returns `actualQuantity = 0` / `actualSeconds = 0` so the pre-freeze can be settled/released for this pure timeline transform.

- `restore`:
  - UI is visible but disabled with an explicit provider-unavailable message.
  - Worker throws `ENHANCE_RESTORE_PROVIDER_UNAVAILABLE` if submitted, so task lifecycle rolls back billing freeze and does not persist timeline changes.
  - No fake provider call was added.

## EditorAsset usage

- Schema confirmed:
  - `NovelPromotionEditorAsset` has `editorProjectId`, `mediaObjectId`, `type`, `sourceType`, `sourcePanelId`, `enhanceType`, `metadata`.
- For this MVP, `NovelPromotionEditorAsset` is not created because no new `MediaObject` is generated.
- Existing voice optimize still creates `NovelPromotionEditorAsset` for generated audio; enhance will use the same model when a real video enhancement provider is added.

## Version safety / billing / anti-freebie behavior

- Route:
  - Uses existing `createEditorAiRoute` with `TASK_TYPE.EDITOR_AI_ENHANCE`.
  - `beforeSubmit` validates `enhanceType` and selected timeline video element.
  - Normalizes `durationSeconds` from the server-side selected timeline element, not just client input.
  - Billing item selection remains in `_shared.ts`: `editor_ai_enhance_smart_crop` or `editor_ai_enhance_restore`, both per-second.

- Worker:
  - Loads editor project by `editorProjectId + episodeId`.
  - Double-validates selected video element.
  - Uses optimistic `updateMany({ id, version })` with up to 3 merge retries.
  - Checks actual usage before persistence. For pure smart crop actual usage is 0, so freeze is not underestimated.
  - Restore fails before persistence and before any EditorAsset creation.

## Changed files

- `src/lib/twick/enhance.ts`
- `src/lib/workers/handlers/editor-enhance-task-handler.ts`
- `src/lib/workers/text.worker.ts`
- `src/app/api/novel-promotion/[projectId]/editor/ai/enhance/route.ts`
- `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/editor/right-panel/ai/EnhancePanel.tsx`
- `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/editor/right-panel/RightPanel.tsx`
- `messages/en/novel-promotion.json`
- `messages/zh/novel-promotion.json`
- `tests/unit/twick/enhance.test.ts`
- `tests/unit/worker/editor-enhance-task-handler.test.ts`
- `tests/integration/api/editor-ai-routes.test.ts`
- `tests/unit/billing/service.test.ts`
- `.superpowers/sdd/task-2.5-report.md`

## Test commands and outputs

### Command 1

```bash
npm test -- --run tests/unit/twick/enhance.test.ts tests/unit/worker/editor-enhance-task-handler.test.ts tests/integration/api/editor-ai-routes.test.ts tests/unit/billing/service.test.ts
```

Output:

```text
Exit code 1
npm error Missing script: "test"
npm error
npm error To see a list of scripts, run:
npm error   npm run
npm error A complete log of this run can be found in: /Users/xiaomao/.npm/_logs/2026-06-22T10_31_05_780Z-debug-0.log
```

### Command 2

```bash
cd /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor && npx vitest run tests/unit/twick/enhance.test.ts tests/unit/worker/editor-enhance-task-handler.test.ts tests/integration/api/editor-ai-routes.test.ts tests/unit/billing/service.test.ts
```

Output:

```text
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

 RUN  v2.1.9 /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor

stderr | tests/unit/billing/service.test.ts > billing/service > expands freeze and charges actual voice usage when actual exceeds quoted
{"ts":"2026-06-22T18:33:43.512+08:00","level":"ERROR","service":"vvicat","audit":false,"message":"[Billing] actual cost exceeds frozen max, overage freeze required","details":{"actualCost":0.72,"frozenCost":0.072,"requiredOverage":0.648}}

stderr | tests/unit/billing/service.test.ts > billing/service > fails and rolls back when overage freeze expansion cannot be covered
{"ts":"2026-06-22T18:33:43.513+08:00","level":"ERROR","service":"vvicat","audit":false,"message":"[Billing] actual cost exceeds frozen max, overage freeze required","details":{"actualCost":0.72,"frozenCost":0.072,"requiredOverage":0.648}}

stderr | tests/unit/billing/service.test.ts > billing/service > task billing lifecycle helpers > editor catalog settlement uses actual quantity without resolving text model pricing
{"ts":"2026-06-22T18:33:43.518+08:00","level":"ERROR","service":"vvicat","audit":false,"message":"[Billing] actual cost exceeds frozen max, overage freeze required","details":{"actualCost":0.12,"frozenCost":0.075,"requiredOverage":0.045}}

stderr | tests/unit/billing/service.test.ts > billing/service > task billing lifecycle helpers > settleTaskBilling throws BILLING_CONFIRM_FAILED when confirm and rollback both fail
...

 ✓ tests/integration/api/editor-ai-routes.test.ts (43 tests) 344ms
 ✓ tests/unit/worker/editor-enhance-task-handler.test.ts (5 tests) 5ms
 ✓ tests/unit/twick/enhance.test.ts (3 tests) 3ms

 Test Files  4 passed (4)
      Tests  81 passed (81)
   Start at  18:33:43
   Duration  1.45s (transform 351ms, setup 8ms, collect 322ms, tests 380ms, environment 0ms, prepare 113ms)
```

### Command 3

```bash
cd /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor && npx tsc --noEmit 2>&1 | grep -iE "enhance|Enhance|editor.*handler"
```

Output:

```text
```

No enhance/editor-handler TypeScript diagnostics.

### Command 4

```bash
cd /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor && npx tsc --noEmit
```

Output:

```text
Exit code 1
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
tests/unit/storyboard-images/grid-video-prompt.test.ts(100,9): error TS1117: An object literal cannot have multiple properties with the same name.
tests/unit/storyboard-images/grid-video-prompt.test.ts(126,11): error TS1117: An object literal cannot have multiple properties with the same name.
```

These full typecheck failures are unrelated to enhance and pre-existing in other tests.

### Command 5

```bash
git -C /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor diff --check
```

Output:

```text
```

No whitespace errors.

## Concerns / follow-ups

- Real video restore/upscale and provider-backed smart crop remain future work. Need a provider/capability contract for video enhancement before generating new MediaObject and EditorAsset for enhance.
- Twick runtime support for the exact `props.crop/objectFit/fit` fields should be verified visually; the MVP stores deterministic timeline parameters, but rendering depends on Twick honoring these props.
- Full `npx tsc --noEmit` currently fails on unrelated existing test type errors (`ArtStyleEditor.test.tsx` missing testing-library/jest-dom matcher types; duplicate keys in `grid-video-prompt.test.ts`).


## 修复轮次

### Status

DONE

### 修复 1：smart_crop 改用 Twick 真实消费字段

本轮先核对了 Twick v0.15.31 的真实字段与消费链：

- `node_modules/@twick/timeline/dist/src/types.d.ts`：`ElementJSON` 支持顶层扩展字段；`Frame` 为 `x/y/rotation/width/height/size`；`ObjectFit` 为 `contain|cover|fill|none|scale-down`。
- `node_modules/@twick/timeline/dist/src/core/elements/video.element.d.ts`：`VideoElement` 有顶层 `objectFit`、`frame`，并提供 `getObjectFit()` / `setObjectFit()` / `getFrame()` / `setFrame()`。
- `node_modules/@twick/timeline/dist/index.js` serializer/deserializer：`visitVideoElement()` 序列化顶层 `frame`、`objectFit`；`deserializeVideoElement()` 从顶层 `json.objectFit`、`json.frame` 还原。
- `node_modules/@twick/visualizer/dist/project.js`：视频/图片渲染创建 `Rect` 容器时展开 `t.frame`，并调用 object-fit 计算逻辑：`o6({ elementRef, containerSize: n().size(), elementSize: s().size(), objectFit: t.objectFit })`。未发现 `props.crop` / `props.fit` 被消费。

改动：

- `applySmartCropToVideoElement()` 不再写 `props.objectFit` / `props.fit` / `props.crop`。
- 改为写 Twick 消费的顶层字段：
  - `objectFit: 'cover'`
  - `frame: { x, y, size: [width, height] }`
- 保留 `props.src` 不变，不创建新 `MediaObject` / `EditorAsset`。
- 增加 `calculateSmartCropFrame()`，用项目画布尺寸和目标比例计算 Twick frame；测试覆盖 16:9 ↔ 9:16 的 aspect 数学。

Twick 裁剪能力边界：

- 当前 Twick 可确认消费的是媒体元素顶层 `objectFit` + `frame`。
- `objectFit='cover'` 能按 frame 容器做居中 cover 适配，用于横竖屏适配。
- 未发现 Twick 支持自定义裁剪矩形 `props.crop` 或 `props.fit`。
- 未发现基础媒体渲染支持精细锚点裁剪（top/bottom/left/right）或 crop strength；因此本轮不再写这些被 Twick 忽略的字段。anchor 只保留在 metadata 作为用户意图记录，不宣称会驱动 Twick 渲染。

### 修复 2：restore route 层拒绝

- 在 `src/app/api/novel-promotion/[projectId]/editor/ai/enhance/route.ts` 的 `beforeSubmit` 中直接拒绝 `enhanceType=restore`。
- 返回 400 / `ENHANCE_RESTORE_UNAVAILABLE`。
- 因为拒绝发生在 `submitTask()` 之前，所以不会创建任务、不会预冻结、不会触发 BullMQ retry。
- 集成测试断言 `submitTaskMock` 未调用，覆盖“不创建任务/不冻结”的行为边界。

### 修复 3：restore UI 不再可选

- `EnhancePanel` 中 restore tab/button 改为始终 disabled，并加 `title={t('enhance.restoreUnavailable')}`。
- 文案同步为 smart crop 更新 Twick `objectFit/frame` 参数，而不是旧的 `crop/fit` 参数。

### 改动文件

- `src/lib/twick/enhance.ts`
- `src/app/api/novel-promotion/[projectId]/editor/ai/enhance/route.ts`
- `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/editor/right-panel/ai/EnhancePanel.tsx`
- `messages/en/novel-promotion.json`
- `messages/zh/novel-promotion.json`
- `tests/unit/twick/enhance.test.ts`
- `tests/unit/worker/editor-enhance-task-handler.test.ts`
- `tests/integration/api/editor-ai-routes.test.ts`
- `.superpowers/sdd/task-2.5-report.md`

### Test command and complete output

Command:

```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/twick/enhance.test.ts tests/unit/worker/editor-enhance-task-handler.test.ts tests/integration/api/editor-ai-routes.test.ts tests/unit/billing/service.test.ts --reporter=dot
```

Output:

```text
[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v2.1.9 /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor

stderr | tests/unit/billing/service.test.ts > billing/service > expands freeze and charges actual voice usage when actual exceeds quoted
{"ts":"2026-06-22T18:55:20.572+08:00","level":"ERROR","service":"vvicat","audit":false,"message":"[Billing] actual cost exceeds frozen max, overage freeze required","details":{"actualCost":0.72,"frozenCost":0.072,"requiredOverage":0.648}}

stderr | tests/unit/billing/service.test.ts > billing/service > fails and rolls back when overage freeze expansion cannot be covered
{"ts":"2026-06-22T18:55:20.574+08:00","level":"ERROR","service":"vvicat","audit":false,"message":"[Billing] actual cost exceeds frozen max, overage freeze required","details":{"actualCost":0.72,"frozenCost":0.072,"requiredOverage":0.648}}

stderr | tests/unit/billing/service.test.ts > billing/service > task billing lifecycle helpers > editor catalog settlement uses actual quantity without resolving text model pricing
{"ts":"2026-06-22T18:55:20.617+08:00","level":"ERROR","service":"vvicat","audit":false,"message":"[Billing] actual cost exceeds frozen max, overage freeze required","details":{"actualCost":0.12,"frozenCost":0.075,"requiredOverage":0.045}}

stderr | tests/unit/billing/service.test.ts > billing/service > task billing lifecycle helpers > settleTaskBilling throws BILLING_CONFIRM_FAILED when confirm and rollback both fail
{"ts":"2026-06-22T18:55:20.650+08:00","level":"ERROR","service":"vvicat","audit":false,"message":"[Billing] rollback task freeze failed:","details":{},"error":{"name":"Error","message":"rollback failed","stack":"Error: rollback failed\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/unit/billing/service.test.ts:704:55\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:146:14\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:11\n    at runWithTimeout (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:39:7)\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:17)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runFiles (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1262:5)"}}

stderr | tests/unit/billing/service.test.ts > billing/service > task billing lifecycle helpers > settleTaskBilling expands freeze when actual exceeds quoted
{"ts":"2026-06-22T18:55:20.651+08:00","level":"ERROR","service":"vvicat","audit":false,"message":"[Billing] actual cost exceeds frozen max, overage freeze required","details":{"actualCost":0.72,"frozenCost":0.072,"requiredOverage":0.648}}

stderr | tests/unit/billing/service.test.ts > billing/service > task billing lifecycle helpers > settleTaskBilling charges Seedance 2.0 videos from exact usage tokens
{"ts":"2026-06-22T18:55:20.673+08:00","level":"ERROR","service":"vvicat","audit":false,"message":"[Billing] actual cost exceeds frozen max, overage freeze required","details":{"actualCost":5.52,"frozenCost":4.968,"requiredOverage":0.552}}

 ✓ tests/unit/billing/service.test.ts (30 tests) 109ms
stderr | tests/unit/billing/service.test.ts > billing/service > task billing lifecycle helpers > rollbackTaskBilling handles success and fallback branches
{"ts":"2026-06-22T18:55:20.674+08:00","level":"ERROR","service":"vvicat","audit":false,"message":"[Billing] rollback task freeze failed:","details":{},"error":{"name":"Error","message":"rollback failed","stack":"Error: rollback failed\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/unit/billing/service.test.ts:823:55\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runFiles (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1262:5)\n    at startTests (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1271:3)\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/vitest/dist/chunks/runBaseTests.3qpJUEJM.js:126:11"}}

Sourcemap for "/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/vendor/omnivoice-sdk/dist/index.js" points to missing source files
Sourcemap for "/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/vendor/omnivoice-sdk/dist/client.js" points to missing source files
Sourcemap for "/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/vendor/omnivoice-sdk/dist/internal/http.js" points to missing source files
Sourcemap for "/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/vendor/omnivoice-sdk/dist/internal/sse.js" points to missing source files
Sourcemap for "/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/vendor/omnivoice-sdk/dist/design.js" points to missing source files
Sourcemap for "/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/vendor/omnivoice-sdk/dist/dub.js" points to missing source files
stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'smart-cut' returns 404 for another project editorProject
{"ts":"2026-06-22T18:55:21.273+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"f453c9d9-8447-4569-9988-b5a332a369d4","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:258:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'caption' returns 404 for another project editorProject
{"ts":"2026-06-22T18:55:21.274+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"b0b8f2d7-fe7d-468d-90cf-70cedb0356a1","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/caption","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:258:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'enhance smart crop' returns 404 for another project editorProject
{"ts":"2026-06-22T18:55:21.275+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"33e0be25-c3a6-4899-8f5c-f95fe4ed3c01","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:258:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'voice-optimize durationSeconds' returns 404 for another project editorProject
{"ts":"2026-06-22T18:55:21.275+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"e3b1ca58-fee8-46a9-a265-4a23713e47bf","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:258:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'voice-optimize maxSeconds fallback' returns 404 for another project editorProject
{"ts":"2026-06-22T18:55:21.275+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"93599893-bd86-4860-b827-f764173289e6","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:258:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'transition' returns 404 for another project editorProject
{"ts":"2026-06-22T18:55:21.276+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"1861e6d0-3795-4c5a-b14d-098ed26203e6","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/transition","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:258:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > smart-cut returns 400 and does not enqueue when the episode has no video panels
{"ts":"2026-06-22T18:55:21.284+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"SMART_CUT_NO_VIDEO_PANELS","requestId":"9ec63086-48e4-4c6a-8706-b9fc97c56895","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"SMART_CUT_NO_VIDEO_PANELS","stack":"ApiError: SMART_CUT_NO_VIDEO_PANELS\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/smart-cut/route.ts:31:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:339:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > caption returns 400 and does not enqueue when the episode has no voice-line text
{"ts":"2026-06-22T18:55:21.285+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"CAPTION_NO_VOICE_LINES","requestId":"a35b6b92-ed00-4242-857a-e8172929f688","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/caption","errorType":"ApiError"},"error":{"name":"ApiError","message":"CAPTION_NO_VOICE_LINES","stack":"ApiError: CAPTION_NO_VOICE_LINES\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/caption/route.ts:40:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:363:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > caption returns 400 instead of 500 when all voice-line content is nullable or blank
{"ts":"2026-06-22T18:55:21.285+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"CAPTION_NO_VOICE_LINES","requestId":"790761df-c43b-4d31-9bdd-71931cddb43b","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/caption","errorType":"ApiError"},"error":{"name":"ApiError","message":"CAPTION_NO_VOICE_LINES","stack":"ApiError: CAPTION_NO_VOICE_LINES\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/caption/route.ts:40:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:397:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > enhance returns 400 and does not enqueue when selected video is missing or invalid
{"ts":"2026-06-22T18:55:21.286+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"ENHANCE_VIDEO_ELEMENT_NOT_FOUND","requestId":"b80aa16d-ea1f-477a-bd65-7d165372763e","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"},"error":{"name":"ApiError","message":"ENHANCE_VIDEO_ELEMENT_NOT_FOUND","stack":"ApiError: ENHANCE_VIDEO_ELEMENT_NOT_FOUND\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/enhance/route.ts:29:13)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:45\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:413:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > enhance restore returns 400 at route layer and does not enqueue or freeze billing
{"ts":"2026-06-22T18:55:21.286+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"ENHANCE_RESTORE_UNAVAILABLE","requestId":"72888b8b-97a7-49bd-8bf4-cb5df8b658c0","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"},"error":{"name":"ApiError","message":"ENHANCE_RESTORE_UNAVAILABLE","stack":"ApiError: ENHANCE_RESTORE_UNAVAILABLE\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/enhance/route.ts:18:13)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:45\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:429:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > voice-optimize returns 400 and does not enqueue when voiceLineId is missing
{"ts":"2026-06-22T18:55:21.287+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"voiceLineId is required","requestId":"fc737bac-2cc7-43cc-8726-cb24d1a5afc7","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"voiceLineId is required","stack":"ApiError: voiceLineId is required\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/voice-optimize/route.ts:58:13)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:45\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:445:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > voice-optimize returns 400 and does not enqueue for an invalid voiceLineId
{"ts":"2026-06-22T18:55:21.287+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"VOICE_OPTIMIZE_NO_VOICE_LINE","requestId":"69b31755-c18f-4787-a268-3f31e0c0ca86","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"VOICE_OPTIMIZE_NO_VOICE_LINE","stack":"ApiError: VOICE_OPTIMIZE_NO_VOICE_LINE\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/voice-optimize/route.ts:74:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:462:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > voice-optimize returns 400 when content is explicitly blank and does not fall back to the original voice line
{"ts":"2026-06-22T18:55:21.288+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"VOICE_OPTIMIZE_EMPTY_TEXT","requestId":"476f77cd-6613-4b9e-baa4-f89a85bb79af","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"VOICE_OPTIMIZE_EMPTY_TEXT","stack":"ApiError: VOICE_OPTIMIZE_EMPTY_TEXT\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/voice-optimize/route.ts:81:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:490:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > voice-optimize returns 400 when speaker is explicitly blank and does not fall back to the original voice line
{"ts":"2026-06-22T18:55:21.288+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"VOICE_OPTIMIZE_EMPTY_SPEAKER","requestId":"5f5c8eb6-8b46-4746-99a5-29cdbbd16e9e","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"VOICE_OPTIMIZE_EMPTY_SPEAKER","stack":"ApiError: VOICE_OPTIMIZE_EMPTY_SPEAKER\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/voice-optimize/route.ts:84:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:506:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > smart-cut propagates insufficient balance from task submission as 402
{"ts":"2026-06-22T18:55:21.291+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Insufficient balance","requestId":"236be3fb-86b1-4b0e-922f-047901545f9b","projectId":"project-1","errorCode":"INSUFFICIENT_BALANCE","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"Insufficient balance","stack":"ApiError: Insufficient balance\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:644:42\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runFiles (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1262:5)\n    at startTests (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1271:3)\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/vitest/dist/chunks/runBaseTests.3qpJUEJM.js:126:11\n    at withEnv (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/vitest/dist/chunks/runBaseTests.3qpJUEJM.js:90:5)","code":"INSUFFICIENT_BALANCE"}}

 ✓ tests/integration/api/editor-ai-routes.test.ts (40 tests) 333ms
 ✓ tests/unit/worker/editor-enhance-task-handler.test.ts (5 tests) 5ms
 ✓ tests/unit/twick/enhance.test.ts (5 tests) 3ms

 Test Files  4 passed (4)
      Tests  80 passed (80)
   Start at  18:55:20
   Duration  1.56s (transform 345ms, setup 8ms, collect 325ms, tests 451ms, environment 1ms, prepare 119ms)


```

### Typecheck command and complete output

Command:

```bash
npx tsc --noEmit 2>&1 | grep -iE "enhance|Enhance|editor.*handler"
```

Output:

```text
```

No enhance/editor-handler TypeScript diagnostics matched the filter.
