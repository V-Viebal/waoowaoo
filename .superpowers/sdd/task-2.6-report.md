# Task 2.6 Smart Transition Report

## Status
DONE_WITH_CONCERNS

## Requirements/source notes
- `.superpowers/sdd/task-2.6-brief.md` was not present in this worktree.
- Read `docs/superpowers/specs/2026-06-20-twick-editor-integration-design.md` section 6.5 and `.superpowers/sdd/twick-api-findings.md`.

## Twick transition real structure
Confirmed from `node_modules/@twick/timeline/dist/src/types.d.ts` and `timeline.editor.d.ts`:
- Element transition is a top-level element field: `transition?: { toElementId: string; duration: number; kind: string }`.
- `TimelineEditor` exposes `addTransition(fromElementId, toElementId, kind, duration): boolean` and `removeTransition(elementId): boolean`.
- No exported `TransitionKind` enum/union exists in the installed Twick type declarations; `kind` is typed as `string`.
- The design/POC mentions `fade / dissolve / slide / zoom`; MVP constrains recommendations to these four kinds only to avoid unsupported invented names.

## Implementation choice: synchronous API
Chose synchronous API (`POST /api/novel-promotion/[projectId]/editor/ai/transition`) instead of BullMQ task.
Reason:
- Smart Transition is rule-based and local, no provider call.
- Immediate calculation is cheaper and simpler than enqueueing a free task.
- Existing `_shared.ts` forces task submission, so transition uses a dedicated route with the same auth/ownership pattern.

## Recommendation rules
Pure function: `recommendSmartTransitions` in `src/lib/novel-promotion/editor/smart-transition.ts`.
- Same `metadata.storyboardId` → prefer `dissolve`, then `fade`, `slide`, `zoom`.
- Different/missing storyboard → prefer `fade`, then `dissolve`, `slide`, `zoom`.
- `slide` is included when panels differ to emphasize generated-panel progression.
- Returns 3-5 recommendations; current MVP returns 4 unique recommendations with kind, duration, confidence, reason.

## Setting transition
Frontend `TransitionPanel`:
- Uses `useTimelineContext()` to read `present`, selected item, and `editor`.
- Finds the next video/image clip on the same track after the selected clip.
- Fetches recommendations from the synchronous API.
- Applies selection via `setTimelineElementTransition`, which calls Twick `editor.addTransition(fromElementId, toElementId, kind, duration)`.
- Calls `flushProjectSave()` after applying so runtime persistence saves the updated top-level `transition` field.

## Free/billing
- Route returns `{ free: true, billing: null }`.
- Does not call `submitTask`.
- Does not construct billing info, freeze balance, or invoke any provider.

## Test commands and output

### Initial wrong command
Command:
```bash
npm test -- tests/unit/twick/smart-transition.test.ts tests/integration/api/editor-ai-routes.test.ts
```
Output:
```text
Exit code 1
npm error Missing script: "test"
npm error
npm error To see a list of scripts, run:
npm error   npm run
npm error A complete log of this run can be found in: /Users/xiaomao/.npm/_logs/2026-06-22T11_08_55_851Z-debug-0.log
```

### Initial wrong-root command
Command:
```bash
npx vitest run /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/unit/twick/smart-transition.test.ts /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts
```
Output:
```text
Exit code 1
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

 RUN  v2.1.9 /Users/xiaomao/Documents/fuyang/waoowaoo

filter:  /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/unit/twick/smart-transition.test.ts, /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts
include: **/*.test.ts
exclude:  **/node_modules/**, **/dist/**, **/.next/**, **/.worktrees/**, **/.claude/worktrees/**

No test files found, exiting with code 1
```

### Targeted tests
Command:
```bash
npm --prefix /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor exec vitest -- --root /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor run tests/unit/twick/smart-transition.test.ts tests/integration/api/editor-ai-routes.test.ts
```
Output summary (full output contained expected route error logs for negative tests and sourcemap warnings):
```text
✓ tests/integration/api/editor-ai-routes.test.ts (40 tests) 429ms
✓ tests/unit/twick/smart-transition.test.ts (5 tests) 4ms

Test Files  2 passed (2)
Tests  45 passed (45)
Start at  19:10:28
Duration  1.34s (transform 408ms, setup 10ms, collect 284ms, tests 433ms, environment 0ms, prepare 100ms)
```

### Required transition-filtered typecheck
Command:
```bash
npm --prefix /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor exec tsc -- --noEmit 2>&1 | grep -iE "transition|Transition"
```
Output:
```text
(no output)
```
Meaning: no transition-related typecheck errors after fixing the route `ApiError` constructor usage.

### Full typecheck
Command:
```bash
npm --prefix /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor run typecheck
```
Output:
```text
Exit code 2

> vvicat@0.4.1 typecheck
> tsc --noEmit

src/app/api/novel-promotion/[projectId]/editor/ai/transition/route.ts(104,44): error TS2345: Argument of type 'string' is not assignable to parameter of type 'Record<string, unknown>'.
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
Follow-up: fixed the transition route error by passing `{ message: error.message }` to `ApiError`. The remaining full-typecheck errors are unrelated pre-existing test dependency/matcher/duplicate-key issues; the required transition-filtered typecheck then produced no output.

## Concerns
- Twick package exposes transition `kind` as `string`; no installed type enum was found. MVP uses the four kinds documented by design/POC: `fade`, `dissolve`, `slide`, `zoom`.
- Full typecheck is still blocked by unrelated existing test errors outside this task.


## 修复轮次

### 保存时序修复
- 已确认 `node_modules/@twick/timeline/dist/src/core/editor/timeline.editor.d.ts` 暴露 `getProject(): ProjectJSON`，且 `addTransition` 注释说明其设置 from element 的 top-level `transition` metadata。
- `setTimelineElementTransition` 现在在 `editor.addTransition(...)` 成功后立即调用 `editor.getProject()`，返回包含最新 top-level `transition` 的 `ProjectJSON`。
- `TransitionPanel.applyRecommendation` 不再依赖下一轮 `TimelineRuntimeSync` effect；它会把 `latestProject` 直接传给 runtime `updateProjectData(latestProject)`，让 `projectDataRef` 和本地 revision 先更新，再调用 `flushProjectSave()`。因此 flush 的 target revision 是包含转场的新 revision。
- 补充 `useEditorProjectSync` 单测覆盖：调用方先 `updateProjectData(latestProject)` 再 `flushProjectSave()` 时，PUT 保存体包含 top-level `transition`。

### 其他 AI 面板时序排查
- 搜索范围：`src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/editor/right-panel/ai`、`src/lib/novel-promotion/stages`、`src/lib/twick`、`tests`。
- `CaptionPanel`、`EnhancePanel`、`SmartCutPanel`、`VoiceOptimizePanel` 的 `flushProjectSave()` 都发生在提交后端任务前，用于先保存现有时间轴；未发现它们在前端直接修改 Twick timeline 后立刻 flush 的 apply→flush 时序。
- 当前唯一直接前端改 timeline 后 flush 的路径是 `TransitionPanel.applyRecommendation`，已修复。

### Twick transition 渲染能力确认与 UI 诚实标注
- 已再次检查 `node_modules/@twick/timeline`、`@twick/visualizer`、`@twick/browser-render`、`@twick/render-server`、`@twick/video-editor`。
- 证据：`@twick/timeline` 存在 `addTransition/removeTransition/getProject`，并序列化 top-level `transition` metadata；`timeline.editor.d.ts` 注释为 “visualizer can interpret it when implemented”。
- 渲染消费结论：在当前安装版本的 `@twick/visualizer/dist`、`@twick/visualizer/src`、`@twick/browser-render/dist`、`@twick/render-server/dist` 中未发现消费 `transition.kind` / `toElementId` / `dissolve` 的实际渲染逻辑。命中项主要是动画/框效果的通用 “transition” 文案或 CSS/配置，不是 timeline element transition metadata 的预览/导出实现。
- UI 已增加诚实提示：转场会保存到 Twick 时间轴；预览/导出中的视觉转场效果取决于当前安装的 Twick 渲染器版本支持。

### 后端校验修复
- `buildSmartTransitionInputFromProject` 现在从 `projectData.tracks` 定位 from/to：
  - 校验元素存在且不是同一个元素。
  - 校验 from/to 在同一轨道。
  - 校验二者类型必须是 `video` 或 `image`。
  - 按时间排序后的 video/image 元素中，`to` 必须是 `from` 后面最近的媒体元素；重叠倒退也返回 `TRANSITION_ELEMENTS_NOT_ADJACENT`。
- 同步 API 将这些边界错误映射为 `INVALID_PARAMS`。

### 测试命令和完整输出

#### Requested transition tests
Command:
```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/twick/transition.test.ts tests/unit/twick/smart-transition.test.ts tests/integration/api/editor-ai-routes.test.ts --reporter=dot
```
Output:
```text
[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v2.1.9 /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor

Sourcemap for "/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/vendor/omnivoice-sdk/dist/index.js" points to missing source files
Sourcemap for "/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/vendor/omnivoice-sdk/dist/client.js" points to missing source files
Sourcemap for "/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/vendor/omnivoice-sdk/dist/internal/http.js" points to missing source files
Sourcemap for "/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/vendor/omnivoice-sdk/dist/internal/sse.js" points to missing source files
Sourcemap for "/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/vendor/omnivoice-sdk/dist/design.js" points to missing source files
Sourcemap for "/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/vendor/omnivoice-sdk/dist/dub.js" points to missing source files
stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'smart-cut' returns 404 for another project editorProject
{"ts":"2026-06-23T09:06:39.359+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"1c1af7da-1d34-48ae-8ac3-8571a9074126","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":4,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:253:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'caption' returns 404 for another project editorProject
{"ts":"2026-06-23T09:06:39.371+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"759bf722-b349-42eb-b818-3e45a1a22f6c","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/caption","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:253:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'enhance smart crop' returns 404 for another project editorProject
{"ts":"2026-06-23T09:06:39.375+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"a25530c4-c8d3-4e38-829a-f9b2ac7a5862","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:253:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'voice-optimize durationSeconds' returns 404 for another project editorProject
{"ts":"2026-06-23T09:06:39.379+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"0e98c438-a8cc-4dc0-8401-c5f039033f4c","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:253:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'voice-optimize maxSeconds fallback' returns 404 for another project editorProject
{"ts":"2026-06-23T09:06:39.381+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"86ae5103-876c-4744-9aea-a1ea733723c1","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:253:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > smart-cut returns 400 and does not enqueue when the episode has no video panels
{"ts":"2026-06-23T09:06:39.416+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"SMART_CUT_NO_VIDEO_PANELS","requestId":"b03b122f-d6ab-490b-a207-15da78c39ea3","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"SMART_CUT_NO_VIDEO_PANELS","stack":"ApiError: SMART_CUT_NO_VIDEO_PANELS\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/smart-cut/route.ts:31:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:334:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > caption returns 400 and does not enqueue when the episode has no voice-line text
{"ts":"2026-06-23T09:06:39.421+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"CAPTION_NO_VOICE_LINES","requestId":"72a48b66-7193-4e5a-a0f9-a6b64fbeb5c5","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/caption","errorType":"ApiError"},"error":{"name":"ApiError","message":"CAPTION_NO_VOICE_LINES","stack":"ApiError: CAPTION_NO_VOICE_LINES\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/caption/route.ts:40:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:358:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > caption returns 400 instead of 500 when all voice-line content is nullable or blank
{"ts":"2026-06-23T09:06:39.424+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"CAPTION_NO_VOICE_LINES","requestId":"5d025605-d565-4aff-8791-8707aacc9ce9","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/caption","errorType":"ApiError"},"error":{"name":"ApiError","message":"CAPTION_NO_VOICE_LINES","stack":"ApiError: CAPTION_NO_VOICE_LINES\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/caption/route.ts:40:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:392:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > enhance returns 400 and does not enqueue when selected video is missing or invalid
{"ts":"2026-06-23T09:06:39.426+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"ENHANCE_VIDEO_ELEMENT_NOT_FOUND","requestId":"df7148e0-d329-4391-ae47-52390f29e300","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"},"error":{"name":"ApiError","message":"ENHANCE_VIDEO_ELEMENT_NOT_FOUND","stack":"ApiError: ENHANCE_VIDEO_ELEMENT_NOT_FOUND\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/enhance/route.ts:29:13)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:45\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:408:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > enhance restore returns 400 at route layer and does not enqueue or freeze billing
{"ts":"2026-06-23T09:06:39.432+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"ENHANCE_RESTORE_UNAVAILABLE","requestId":"8f0a803c-afdb-4b47-9a11-3b2af38556f5","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"},"error":{"name":"ApiError","message":"ENHANCE_RESTORE_UNAVAILABLE","stack":"ApiError: ENHANCE_RESTORE_UNAVAILABLE\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/enhance/route.ts:18:13)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:45\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:424:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > voice-optimize returns 400 and does not enqueue when voiceLineId is missing
{"ts":"2026-06-23T09:06:39.434+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"voiceLineId is required","requestId":"0d6ac59e-6c34-4a78-aafb-8590d5898363","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"voiceLineId is required","stack":"ApiError: voiceLineId is required\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/voice-optimize/route.ts:58:13)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:45\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:440:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > voice-optimize returns 400 and does not enqueue for an invalid voiceLineId
{"ts":"2026-06-23T09:06:39.440+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"VOICE_OPTIMIZE_NO_VOICE_LINE","requestId":"2ad1e4fa-2ab5-4b23-9b5d-318faadbace6","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"VOICE_OPTIMIZE_NO_VOICE_LINE","stack":"ApiError: VOICE_OPTIMIZE_NO_VOICE_LINE\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/voice-optimize/route.ts:74:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:457:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > voice-optimize returns 400 when content is explicitly blank and does not fall back to the original voice line
{"ts":"2026-06-23T09:06:39.446+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"VOICE_OPTIMIZE_EMPTY_TEXT","requestId":"a3454119-5c08-44f0-a7c7-0eae27723804","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"VOICE_OPTIMIZE_EMPTY_TEXT","stack":"ApiError: VOICE_OPTIMIZE_EMPTY_TEXT\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/voice-optimize/route.ts:81:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:485:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > voice-optimize returns 400 when speaker is explicitly blank and does not fall back to the original voice line
{"ts":"2026-06-23T09:06:39.449+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"VOICE_OPTIMIZE_EMPTY_SPEAKER","requestId":"8e717bef-6a65-41bc-824f-19026a098b3a","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"VOICE_OPTIMIZE_EMPTY_SPEAKER","stack":"ApiError: VOICE_OPTIMIZE_EMPTY_SPEAKER\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/voice-optimize/route.ts:84:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:501:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > smart-cut propagates insufficient balance from task submission as 402
{"ts":"2026-06-23T09:06:39.460+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Insufficient balance","requestId":"e797edfb-03b0-43c9-b950-3312b29ef7cf","projectId":"project-1","errorCode":"INSUFFICIENT_BALANCE","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"Insufficient balance","stack":"ApiError: Insufficient balance\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:639:42\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runFiles (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1262:5)\n    at startTests (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1271:3)\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/vitest/dist/chunks/runBaseTests.3qpJUEJM.js:126:11\n    at withEnv (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/vitest/dist/chunks/runBaseTests.3qpJUEJM.js:90:5)","code":"INSUFFICIENT_BALANCE"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > transition synchronous route > returns 404 for another project editorProject
{"ts":"2026-06-23T09:06:39.591+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"44f9e942-6e72-4013-81e7-3fc685c0d81e","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/transition","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/transition/route.ts:82:11\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:727:19\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > transition synchronous route > returns 400 when transition clips are not adjacent on the same track
{"ts":"2026-06-23T09:06:39.597+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"TRANSITION_ELEMENTS_NOT_ADJACENT","requestId":"dffb967c-ef17-4a6a-a5f0-f6fb26a65d40","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/transition","errorType":"ApiError"},"error":{"name":"ApiError","message":"TRANSITION_ELEMENTS_NOT_ADJACENT","stack":"ApiError: TRANSITION_ELEMENTS_NOT_ADJACENT\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/transition/route.ts:104:13\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:768:19\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > transition synchronous route > returns 400 when transition target type is not video or image
{"ts":"2026-06-23T09:06:39.599+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"TRANSITION_UNSUPPORTED_ELEMENT_TYPE","requestId":"d4ff3b05-48cc-4690-9fe4-ac0aa4f4fbcd","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/transition","errorType":"ApiError"},"error":{"name":"ApiError","message":"TRANSITION_UNSUPPORTED_ELEMENT_TYPE","stack":"ApiError: TRANSITION_UNSUPPORTED_ELEMENT_TYPE\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/transition/route.ts:104:13\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:791:19\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)","code":"INVALID_PARAMS"}}

 ✓ tests/integration/api/editor-ai-routes.test.ts (42 tests) 2214ms
   ✓ editor AI route skeletons > 'smart-cut' returns 401 when unauthenticated 911ms
   ✓ editor AI route skeletons > 'voice-optimize durationSeconds' returns 401 when unauthenticated 942ms
 ✓ tests/unit/twick/smart-transition.test.ts (10 tests) 23ms

 Test Files  2 passed (2)
      Tests  52 passed (52)
   Start at  09:06:34
   Duration  7.28s (transform 1.83s, setup 43ms, collect 1.54s, tests 2.24s, environment 2ms, prepare 1.79s)


```
Note: `tests/unit/twick/transition.test.ts` does not exist in this worktree; Vitest ran the existing matched files and reported 2 passed files / 52 passed tests. Transition writer tests live in `tests/unit/twick/smart-transition.test.ts`.

#### Save timing runtime test
Command:
```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/editor-stage-runtime.test.ts --reporter=dot
```
Output:
```text
[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v2.1.9 /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor

stderr | tests/unit/editor-stage-runtime.test.ts > useEditorProjectSync > reloads server project data and bumps reload revision even when version is unchanged
An update to HookHarness inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://react.dev/link/wrap-tests-with-act
An update to HookHarness inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://react.dev/link/wrap-tests-with-act
An update to HookHarness inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://react.dev/link/wrap-tests-with-act
An update to HookHarness inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://react.dev/link/wrap-tests-with-act
An update to HookHarness inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://react.dev/link/wrap-tests-with-act
An update to HookHarness inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://react.dev/link/wrap-tests-with-act

 ✓ tests/unit/editor-stage-runtime.test.ts (14 tests) 1258ms
   ✓ useEditorProjectSync > flushes a pending debounced save on window blur and hidden visibilitychange 1040ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  09:06:54
   Duration  3.84s (transform 532ms, setup 12ms, collect 922ms, tests 1.26s, environment 682ms, prepare 138ms)

```

#### Required transition-filtered typecheck
Command:
```bash
npx tsc --noEmit 2>&1 | grep -iE "transition|Transition"
```
Output:
```text
(no output)
```
Meaning: no transition-related typecheck errors were emitted.

### Concerns after fix round
- Current Twick package stores transition metadata correctly, but installed renderer packages do not appear to implement visual transition rendering yet. The UI now states this boundary explicitly.
- The requested path `tests/unit/twick/transition.test.ts` is absent; existing transition unit coverage is in `tests/unit/twick/smart-transition.test.ts`, plus the added save-timing coverage in `tests/unit/editor-stage-runtime.test.ts`.
