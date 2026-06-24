# Task 2.2 Report: Twick Editor Smart Cut MVP

## Status
DONE_WITH_CONCERNS

## Handler 实现
- 新增 `src/lib/workers/handlers/editor-smart-cut-task-handler.ts`。
- `handleEditorSmartCutTask(job)` 从真实 `TaskJobData.payload` 读取 `episodeId` / `editorProjectId` / 可选 `panelIds`。
- 后端直接查询：
  - `NovelPromotionEditorProject`：校验 editor project 属于当前 episode，并读取 `projectData`。
  - `NovelPromotionStoryboard` + `panels`：按 `clip.start` + `createdAt` 排序，panel 按 `panelIndex` 排序。
  - `NovelPromotionVoiceLine`：按 `lineIndex` 排序，读取 `audioMediaId` / `audioDuration` / matched panel 字段。
- 转换为 Task 1.2 类型：
  - `PanelVideoSource[]` 使用真实字段 `panel.videoMediaId` / `panel.videoMedia.id`，duration 优先 `videoMedia.durationMs` 转秒，fallback `panel.duration` 秒，再 fallback 3 秒。
  - `VoiceLineSource[]` 使用 `voiceLine.audioMediaId` / `audioMedia.id`，duration 按 DB `audioDuration` 毫秒转秒，fallback `audioMedia.durationMs`，再 fallback 2 秒。
- 调用 `buildInitialProject(panelVideos, voiceSources, { includeAudio: true, includeCaptions: false })` 重建 Twick timeline。
- 更新 `NovelPromotionEditorProject.projectData`，`version: { increment: 1 }`。
- 返回 `{ actualQuantity: 1 }` 以便 editor per_use 结算路径明确记录实际数量。

## Worker 注册
- 注册在 `src/lib/workers/text.worker.ts`：`TASK_TYPE.EDITOR_AI_SMART_CUT -> handleEditorSmartCutTask(job)`。
- 原因：Smart Cut MVP 是分析/组装类任务，无视频生成/渲染外部资源消耗；`getQueueTypeByTaskType()` 对未列入 image/video/voice 的任务默认走 text queue，因此 route 提交的 `EDITOR_AI_SMART_CUT` 已进入 text queue。

## 结算路径
- 没有在 handler 内显式 `commit` / `refund`。
- 真实项目使用 `withTaskLifecycle` 统一结算：
  - 成功：`settleTaskBilling({ billingInfo }, { result })`，editor per_use 通过 `BILLING_ITEM.EDITOR_SMART_CUT` 解析，actualQuantity=1。
  - 失败：`rollbackTaskBilling({ id: taskId, billingInfo })` 自动回滚冻结金额。
- 新增 `tests/unit/worker/editor-smart-cut-billing-lifecycle.test.ts` 覆盖成功结算和失败退款路径。

## 前端触发与刷新
- 新增 `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/editor/right-panel/ai/SmartCutPanel.tsx`。
- `RightPanel` AI tab 中将原“智能粗剪”disabled 占位替换为真实 `SmartCutPanel`。
- 使用 `useWorkspaceProvider()` 获取 `projectId` / `episodeId` / SSE task event subscription。
- 使用 `useEditorStageRuntime()` 获取 `editorProjectId` / `hasVideoPanels` / `reloadProject()`。
- 点击按钮 POST `/api/novel-promotion/${projectId}/editor/ai/smart-cut`，显示 active task progress。
- 任务完成后通过 SSE 或 task snapshot fallback 调用 `reloadProject()`，触发 runtime 的 `projectReloadRevision` remount 机制刷新 Twick timeline。

## 测试命令与输出

### Smart Cut worker + billing lifecycle + route tests
命令：
```bash
npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/unit/worker/editor-smart-cut-task-handler.test.ts tests/unit/worker/editor-smart-cut-billing-lifecycle.test.ts tests/integration/api/editor-ai-routes.test.ts
```
输出摘要：
```text
Test Files  3 passed (3)
Tests       37 passed (37)
```
说明：`editor-ai-routes.test.ts` 中 404 / 402 用例会按既有 api logger 输出 error 日志，但断言通过。

### 要求的 filtered typecheck
命令：
```bash
npx tsc --noEmit 2>&1 | grep -iE "smart-cut|editor.*handler|SmartCut"
```
输出：
```text
(no output)
```

### Full typecheck
命令：
```bash
npm run typecheck
```
输出摘要：失败，但仅为既有无关测试类型错误：
```text
tests/unit/components/art-style-library/ArtStyleEditor.test.tsx: missing @testing-library/react / jest-dom matcher typings
tests/unit/storyboard-images/grid-video-prompt.test.ts: duplicate object literal properties
```

## 与 brief 偏差
- brief 建议新建 `src/lib/workers/editor-ai.worker.ts`，真实队列架构已由 `getQueueTypeByTaskType()` 将 editor smart-cut 默认送入 text queue；因此实际注册到 `text.worker.ts`。
- brief 使用 `videoMediaObjectId` / `audioMediaObjectId` 字段名，真实 Prisma 字段为 `videoMediaId` / `audioMediaId`，关系为 `videoMedia` / `audioMedia`。
- brief 示例显式 `commitTransaction/refundTransaction`，真实项目由 `withTaskLifecycle` 自动 `settleTaskBilling/rollbackTaskBilling`。
- brief 提到 `src/lib/twick/ai-patch-adapter.ts` 和 `useEditorAIActions.ts`，当前真实代码中未发现这两个文件/接口；MVP 直接接入 RightPanel + runtime context。

## MVP 范围
- 无 AI 智能排序、无 LLM 调用、无智能裁切。
- 仅按 storyboard/panel 顺序重建 Twick timeline，并按 matched voice line 优先、lineIndex 顺序 fallback 对齐音频。

## 修复轮次

### 修复 1：空素材不入队 / 不扣费 / 不覆盖 timeline
- route 层：`src/app/api/novel-promotion/[projectId]/editor/ai/smart-cut/route.ts` 在 `createEditorAiRoute` 的 `beforeSubmit` 前置钩子中统计当前 episode（以及可选 `panelIds` 范围）有 `videoMediaId` 的 panel 数；为 0 时抛 `ApiError('INVALID_PARAMS', { message: 'SMART_CUT_NO_VIDEO_PANELS' })`，因此不调用 `submitTask`、不预扣费、不入队。
- shared route：`src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts` 新增 `beforeSubmit` 钩子，位置在归属校验之后、billingInfo 构建和 `submitTask` 之前。
- handler 层兜底：`src/lib/workers/handlers/editor-smart-cut-task-handler.ts` 在 `buildSmartCutProject` 后、写库前判断 `panelCount === 0`，抛 `SMART_CUT_NO_VIDEO_PANELS`，不会执行 `novelPromotionEditorProject.update`，避免覆盖已有 `projectData`。
- 退款确认：失败会向外抛给 worker 的 `withTaskLifecycle`；现有 `editor-smart-cut-billing-lifecycle.test.ts` 已覆盖 handler 失败时 rollback，本轮又在 handler 测试中验证该错误能经 `withTaskLifecycle` 传播。

### 修复 2：SSE 漏事件后的完成轮询 fallback
- `src/lib/query/hooks/useTaskStatus.ts` 给 `useActiveTasks` / `useTaskSnapshot` / `useTaskStatus` 增加可选 `refetchInterval`，不改变默认调用方行为。
- `SmartCutPanel` 在存在 `submittedTaskId` 时传 `refetchInterval: 2500`，terminal 后停止。
- SSE 和轮询共用 `handleCompletedTask(taskId)`，用 `completedTaskIdsRef` 去重，确保正常 SSE 与轮询补偿不会重复 `reloadProject()`。

### 修复 3：发起 smart-cut 前 flush 未保存编辑
- `src/lib/novel-promotion/stages/editor-stage-runtime/useEditorProjectSync.ts` 新增 `flushProjectSave()`：flush debounce/pending save，并等待当前保存 mutation 结束；失败或超时会抛错阻止 smart-cut 提交。
- `src/lib/novel-promotion/stages/editor-stage-runtime-core.tsx` 将 `flushProjectSave` 暴露到 editor runtime context。
- `SmartCutPanel` 在 POST smart-cut 前先 `await flushProjectSave()`，避免 worker 基于服务端旧 editor project 重建并覆盖用户未保存 timeline 编辑。

### 测试命令与完整输出

命令：
```bash
npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/unit/worker/editor-smart-cut-task-handler.test.ts tests/unit/worker/editor-smart-cut-billing-lifecycle.test.ts tests/integration/api/editor-ai-routes.test.ts --reporter=dot
```
完整输出：
```text
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

 RUN  v2.1.9 /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'smart-cut' returns 404 for another project editorProject
{"ts":"2026-06-22T14:17:08.490+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"767936a8-8db7-4ad1-b9ac-9a326d96fd5d","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":7,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'caption' returns 404 for another project editorProject
{"ts":"2026-06-22T14:17:08.533+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"4b4fc1e5-7df6-4592-9786-b775c3c64da8","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":4,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/caption","errorType":"ApiError"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'enhance restore' returns 404 for another project editorProject
{"ts":"2026-06-22T14:17:08.537+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"9cc5fdbb-5fd6-46cc-85ab-bed919d1f6a7","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'enhance smart crop' returns 404 for another project editorProject
{"ts":"2026-06-22T14:17:08.545+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"ed7ae182-cd3f-4e33-adca-e39cd27e1c27","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":5,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'voice-optimize durationSeconds' returns 404 for another project editorProject
{"ts":"2026-06-22T14:17:08.547+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"cba3f802-d0e7-4dd4-87f8-80ebe7e2496e","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'voice-optimize maxSeconds fallback' returns 404 for another project editorProject
{"ts":"2026-06-22T14:17:08.554+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"f611ddf1-3df6-4d6a-af24-bef44c596f42","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'transition' returns 404 for another project editorProject
{"ts":"2026-06-22T14:17:08.559+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"f05c4268-dece-4119-8c84-d6bad90c1321","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/transition","errorType":"ApiError"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > smart-cut returns 400 and does not enqueue when the episode has no video panels
{"ts":"2026-06-22T14:17:08.626+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"SMART_CUT_NO_VIDEO_PANELS","requestId":"5e9bb62a-5043-42d1-9588-335968671d8c","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > smart-cut propagates insufficient balance from task submission as 402
{"ts":"2026-06-22T14:17:08.643+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Insufficient balance","requestId":"8c01c0be-4616-47e8-8fe8-976bbedc182a","projectId":"project-1","errorCode":"INSUFFICIENT_BALANCE","retryable":false,"durationMs":3,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"}}

 ✓ tests/integration/api/editor-ai-routes.test.ts (32 tests) 1741ms
   ✓ editor AI route skeletons > 'smart-cut' returns 401 when unauthenticated 1406ms
 ✓ tests/unit/worker/editor-smart-cut-task-handler.test.ts (6 tests) 42ms
 ✓ tests/unit/worker/editor-smart-cut-billing-lifecycle.test.ts (2 tests) 49ms

 Test Files  3 passed (3)
      Tests  40 passed (40)
   Start at  14:17:01
   Duration  11.28s (transform 2.61s, setup 69ms, collect 4.08s, tests 1.83s, environment 2ms, prepare 699ms)
```

命令：
```bash
npx tsc --noEmit 2>&1 | grep -iE "smart-cut|editor.*handler|SmartCut"
```
完整输出：
```text
(no output)
```

补充 full typecheck 命令：
```bash
npx tsc --noEmit
```
输出：仍失败于既有无关测试类型问题（`@testing-library/react` / jest-dom matcher typings 缺失、`grid-video-prompt.test.ts` 重复对象属性），未出现 smart-cut/editor handler 相关错误。

## 修复轮次 2

### 修复：flushProjectSave await 真实保存 promise
- `src/lib/novel-promotion/stages/editor-stage-runtime/useEditorProjectSync.ts` 将保存启动路径收敛到 `startSave()`，使用 React Query v5 的 `saveMutation.mutateAsync(...)`，并把本次真实保存 promise 记录到 `inFlightSavePromiseRef`。
- `startSave()` 在调用 `mutateAsync` 前同步设置 `saveMutationPendingRef.current = true`，避免仍依赖 `useEffect([saveMutation.isPending])` 异步同步 ref 后才可见的竞态窗口。
- `flushPendingSave()` 现在返回当前/新启动的保存 promise：
  - 有 debounce pending 时，先 `debounceRef.current.flush()`，再返回该 flush 启动的 `inFlightSavePromiseRef.current`。
  - 有 `savePendingRef` 时，直接触发 `startSave()` 并返回 promise。
  - 已有保存进行中时，返回当前 in-flight promise。
  - 无 pending 变更时返回 `null`，`flushProjectSave()` 立即成功返回。
- `flushProjectSave()` 不再 busy-wait `saveMutationPendingRef.current`；它 await `flushPendingSave()` / `inFlightSavePromiseRef.current` 拿到的真实保存 promise。
- 保存失败时，`mutateAsync` promise reject 会从 `flushProjectSave()` 向外抛出；`SmartCutPanel` 的 mutationFn 中 `await flushProjectSave()` 位于 POST smart-cut 之前，因此保存失败会进入 `onError`，不会继续提交 smart-cut。
- 兼容失焦/卸载 flush：`blur` / `visibilitychange` / cleanup 仍调用 `flushPendingSave()`；这些路径不 await promise，但会立即启动保存，保持原有 fire-and-forget 行为，并通过 `void savePromise.catch(() => undefined)` 避免未处理 rejection。

### 测试命令与完整输出

命令：
```bash
npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/unit/editor-stage-runtime.test.ts tests/unit/worker/editor-smart-cut-task-handler.test.ts tests/integration/api/editor-ai-routes.test.ts --reporter=dot
```
完整输出：
```text
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

 RUN  v2.1.9 /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor

stderr | tests/unit/editor-stage-runtime.test.ts > useEditorProjectSync > flushProjectSave returns immediately when there are no pending changes
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

 ✓ tests/unit/editor-stage-runtime.test.ts (10 tests) 1226ms
   ✓ useEditorProjectSync > flushes a pending debounced save on window blur and hidden visibilitychange 1039ms
stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'smart-cut' returns 404 for another project editorProject
{"ts":"2026-06-22T14:37:18.412+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"73a15b5e-2c86-4fa1-af33-f75cc4c60191","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'caption' returns 404 for another project editorProject
{"ts":"2026-06-22T14:37:18.414+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"3eedc1b2-fcb7-4cde-b4de-e1084f016c87","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/caption","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'enhance restore' returns 404 for another project editorProject
{"ts":"2026-06-22T14:37:18.415+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"4cc0aa1d-e46c-4cd6-a96b-0c75d952cc35","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'enhance smart crop' returns 404 for another project editorProject
{"ts":"2026-06-22T14:37:18.417+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"6f9bb100-ac8f-491b-b13a-98e5e9d18347","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'voice-optimize durationSeconds' returns 404 for another project editorProject
{"ts":"2026-06-22T14:37:18.418+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"e2fa3ba4-36d9-459a-8828-a0e2b7906989","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'voice-optimize maxSeconds fallback' returns 404 for another project editorProject
{"ts":"2026-06-22T14:37:18.423+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"dc67593d-bcdf-4bd7-a461-3f78d094d9a9","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":5,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'transition' returns 404 for another project editorProject
{"ts":"2026-06-22T14:37:18.424+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"431b87f7-fa59-41a3-a341-b45ca5a99d61","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/transition","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > smart-cut returns 400 and does not enqueue when the episode has no video panels
{"ts":"2026-06-22T14:37:18.436+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"SMART_CUT_NO_VIDEO_PANELS","requestId":"9d2d18d2-7ec4-4c51-bc82-8d6091b1f6cf","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"SMART_CUT_NO_VIDEO_PANELS","stack":"ApiError: SMART_CUT_NO_VIDEO_PANELS\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/smart-cut/route.ts:31:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:205:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:318:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > smart-cut propagates insufficient balance from task submission as 402
{"ts":"2026-06-22T14:37:18.437+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Insufficient balance","requestId":"69b2d0c2-03ef-49ea-8656-159b957fb6ee","projectId":"project-1","errorCode":"INSUFFICIENT_BALANCE","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"Insufficient balance","stack":"ApiError: Insufficient balance\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:340:42\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runFiles (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1262:5)\n    at startTests (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1271:3)\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/vitest/dist/chunks/runBaseTests.3qpJUEJM.js:126:11\n    at withEnv (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/vitest/dist/chunks/runBaseTests.3qpJUEJM.js:90:5)","code":"INSUFFICIENT_BALANCE"}}

 ✓ tests/integration/api/editor-ai-routes.test.ts (32 tests) 234ms
 ✓ tests/unit/worker/editor-smart-cut-task-handler.test.ts (6 tests) 6ms

 Test Files  3 passed (3)
      Tests  48 passed (48)
   Start at  14:37:15
   Duration  3.35s (transform 385ms, setup 11ms, collect 560ms, tests 1.47s, environment 431ms, prepare 139ms)
```

命令：
```bash
npx tsc --noEmit 2>&1 | grep -iE "useEditorProjectSync|SmartCut|editor-stage-runtime"
```
完整输出：
```text
(no output)
```

### Concern
- `tests/unit/editor-stage-runtime.test.ts` 仍有既有 React 19 act warning（本轮新增“无 pending 变更立即返回”用例也可触发同类异步 query 状态更新 warning），但断言全部通过；未发现功能失败。


## 修复轮次 3

### 修复：flush 保存中又产生的新 debounce 编辑
- `src/lib/novel-promotion/stages/editor-stage-runtime/useEditorProjectSync.ts` 为本地编辑增加 `localProjectRevisionRef`，每次 `updateProjectData()` 递增；保存启动时记录本次保存覆盖到的 revision，保存成功后更新 `lastSavedProjectRevisionRef`。
- `flushPendingSave()` 调整为先 flush debounce，再判断当前是否有 in-flight save。这样“保存 A 进行中 + debounce 编辑 B pending”时，B 的 debounce 会被立即清掉并保留 `savePendingRef`，等 A 完成后下一轮启动 B 保存。
- `flushProjectSave()` 改为链式循环：记录调用瞬间的 `targetRevision`，每轮 flush pending / await in-flight，保存失败立即 reject；只有当 `lastSavedProjectRevisionRef >= targetRevision` 时 resolve。这样 Smart Cut 发起时刻已知的本地 `projectData` 必须已成功落库。
- 防死循环退出条件：循环上限 `FLUSH_PROJECT_SAVE_MAX_ITERATIONS = 4`；同时若无 in-flight、无 pending、无 debounce，则直接返回。持续编辑属于极端场景，函数保证发起 flush 那一刻的 target revision 被保存，超过迭代上限会抛 `Timed out while flushing editor project save`，阻止 Smart Cut 提交。
- 失焦 / visibilitychange / pagehide / unmount 仍 fire-and-forget 调 `flushPendingSave()`；在 in-flight 中也会触发最新 pending debounce 的 flush，不改变 Task 1.4 行为。

### 新增回归测试
- `tests/unit/editor-stage-runtime.test.ts` 新增 “保存 A 进行中 + 新 pending 编辑 B → flushProjectSave 等 A 后继续保存 B，且 B 完成前不 resolve” 的 React 19 `createRoot + act` hook harness 测试。
- 保留前两轮覆盖：pending debounce 等待、失败 reject、无 pending 立即返回。

### 测试命令与完整输出

命令：
```bash
npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/unit/editor-stage-runtime.test.ts tests/unit/worker/editor-smart-cut-task-handler.test.ts tests/integration/api/editor-ai-routes.test.ts --reporter=dot
```
完整输出：
```text
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

 RUN  v2.1.9 /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor

stderr | tests/unit/editor-stage-runtime.test.ts > useEditorProjectSync > flushProjectSave returns immediately when there are no pending changes
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

 ✓ tests/unit/editor-stage-runtime.test.ts (11 tests) 1193ms
   ✓ useEditorProjectSync > flushes a pending debounced save on window blur and hidden visibilitychange 1035ms
stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'smart-cut' returns 404 for another project editorProject
{"ts":"2026-06-22T14:58:11.690+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"fdb662ee-12ff-467e-ab38-d7a506925353","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'caption' returns 404 for another project editorProject
{"ts":"2026-06-22T14:58:11.692+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"a3be1493-7077-49b7-a5ac-4f65422f7b28","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/caption","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'enhance restore' returns 404 for another project editorProject
{"ts":"2026-06-22T14:58:11.693+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"76d22d57-316f-43de-a128-62700fd3c5df","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'enhance smart crop' returns 404 for another project editorProject
{"ts":"2026-06-22T14:58:11.693+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"fcae2691-9859-44d1-a91a-3082b799ec65","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'voice-optimize durationSeconds' returns 404 for another project editorProject
{"ts":"2026-06-22T14:58:11.693+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"7b6c9bb8-628c-4c62-9085-223b334384a9","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'voice-optimize maxSeconds fallback' returns 404 for another project editorProject
{"ts":"2026-06-22T14:58:11.694+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"33d1f5fc-d82f-43b0-a5bf-4423ef142dd3","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'transition' returns 404 for another project editorProject
{"ts":"2026-06-22T14:58:11.694+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"db39f46b-ec34-415c-83ac-f5dad5609971","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/transition","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > smart-cut returns 400 and does not enqueue when the episode has no video panels
{"ts":"2026-06-22T14:58:11.702+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"SMART_CUT_NO_VIDEO_PANELS","requestId":"818c160c-a795-4cb8-b14f-79a55aac50b1","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"SMART_CUT_NO_VIDEO_PANELS","stack":"ApiError: SMART_CUT_NO_VIDEO_PANELS\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/smart-cut/route.ts:31:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:205:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:318:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > smart-cut propagates insufficient balance from task submission as 402
{"ts":"2026-06-22T14:58:11.703+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Insufficient balance","requestId":"af7f549e-477e-428e-a32a-227b761ec28a","projectId":"project-1","errorCode":"INSUFFICIENT_BALANCE","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"Insufficient balance","stack":"ApiError: Insufficient balance\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:340:42\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runFiles (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1262:5)\n    at startTests (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1271:3)\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/vitest/dist/chunks/runBaseTests.3qpJUEJM.js:126:11\n    at withEnv (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/vitest/dist/chunks/runBaseTests.3qpJUEJM.js:90:5)","code":"INSUFFICIENT_BALANCE"}}

 ✓ tests/integration/api/editor-ai-routes.test.ts (32 tests) 180ms
 ✓ tests/unit/worker/editor-smart-cut-task-handler.test.ts (6 tests) 7ms

 Test Files  3 passed (3)
      Tests  49 passed (49)
   Start at  14:58:08
   Duration  3.24s (transform 538ms, setup 16ms, collect 837ms, tests 1.38s, environment 321ms, prepare 105ms)
```

命令：
```bash
npx tsc --noEmit 2>&1 | grep -iE "useEditorProjectSync|editor-stage-runtime|SmartCut"
```
完整输出：
```text
(no output)
```

### Concern
- `tests/unit/editor-stage-runtime.test.ts` 仍有既有 React 19 act warning；本轮新增并发回归测试通过，未新增功能失败。


## 修复轮次 4

### 修复：flush target revision 未落库时 reject
- `src/lib/novel-promotion/stages/editor-stage-runtime/useEditorProjectSync.ts` 在 `flushProjectSave()` 的“无 in-flight / 无 pending / 无 debounce”退出分支补上 target revision 不变量校验：若 `lastSavedProjectRevisionRef.current < targetRevision`，不再静默 resolve，而是 reject。
- 错误语义：
  - 当前存在保存冲突且 target revision 未保存：抛 `Error('conflict')`。
  - 无保存工作可启动但 target revision 仍未保存：抛 `Error('unsaved-changes')`。
  - 保存 promise 本身以 409 conflict reject 时，`flushProjectSave()` 将其归一为 `Error('conflict')`。
- `hasConflictRef` 用于让 `flushProjectSave()` 在 async/await 过程中读取最新 conflict 状态，避免闭包旧值影响边界判断。
- `startSave()` 在缺少 `projectId` / `episodeId` 时会清掉 `savePendingRef` 并返回 `null`，让 flush 能进入“无保存工作”分支并按 `lastSaved < targetRevision` reject，而不是循环到 timeout。
- 失焦 / visibilitychange / pagehide / unmount 仍只调用 `flushPendingSave()` fire-and-forget；这些路径不 await `flushProjectSave()`，不受本轮 reject 行为影响。

### SmartCutPanel 错误展示
- `SmartCutPanel` 已在提交 smart-cut 前 `await flushProjectSave()`；本轮确认错误会进入 React Query mutation `onError`，因此不会继续 POST smart-cut。
- `SmartCutPanel` 新增对 `conflict` / `unsaved-changes` 的本地化提示映射：
  - `conflict`：提示先解决编辑器项目保存冲突。
  - `unsaved-changes`：提示当前编辑内容尚未保存，需保存成功后再执行智能粗剪。

### 新增回归测试
- `tests/unit/editor-stage-runtime.test.ts` 新增：
  - `hasConflict=true` 且本地 revision 已前进时，`flushProjectSave()` reject `conflict`，不会静默 resolve，也不会继续保存。
  - 本地编辑未落库且无保存可启动时，`flushProjectSave()` reject `unsaved-changes`。
- 保留既有覆盖：target 已保存 resolve、保存中 + pending B 等待、保存失败 reject、无 pending 立即返回。

### 测试命令与完整输出

命令：
```bash
npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/unit/editor-stage-runtime.test.ts tests/unit/worker/editor-smart-cut-task-handler.test.ts tests/integration/api/editor-ai-routes.test.ts --reporter=dot
```
完整输出：
```text
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

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

 ✓ tests/unit/editor-stage-runtime.test.ts (13 tests) 1184ms
   ✓ useEditorProjectSync > flushes a pending debounced save on window blur and hidden visibilitychange 1036ms
stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'smart-cut' returns 404 for another project editorProject
{"ts":"2026-06-22T15:08:31.442+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"42578e86-2780-4713-8819-7fa113385899","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'caption' returns 404 for another project editorProject
{"ts":"2026-06-22T15:08:31.444+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"ed8c733d-11aa-4fd0-81f6-cee5910b6535","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/caption","errorType":"ApiError"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'enhance restore' returns 404 for another project editorProject
{"ts":"2026-06-22T15:08:31.445+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"1bf8d501-c004-41e0-922e-34096c1be742","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'enhance smart crop' returns 404 for another project editorProject
{"ts":"2026-06-22T15:08:31.445+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"f6b88eae-b485-490d-89d8-41f9f738bb2f","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'voice-optimize durationSeconds' returns 404 for another project editorProject
{"ts":"2026-06-22T15:08:31.446+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"223a68de-0aea-4f21-bb90-b2f1fec48da9","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'voice-optimize maxSeconds fallback' returns 404 for another project editorProject
{"ts":"2026-06-22T15:08:31.446+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"6514a71b-9d66-4a78-9f65-4c5d14d62133","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'transition' returns 404 for another project editorProject
{"ts":"2026-06-22T15:08:31.446+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"df3b91ac-67e0-4b5f-b723-1422fa83ec20","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/transition","errorType":"ApiError"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > smart-cut returns 400 and does not enqueue when the episode has no video panels
{"ts":"2026-06-22T15:08:31.455+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"SMART_CUT_NO_VIDEO_PANELS","requestId":"b1cd96b6-5776-4f16-b8e1-edea08ed68f9","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > smart-cut propagates insufficient balance from task submission as 402
{"ts":"2026-06-22T15:08:31.456+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Insufficient balance","requestId":"dad802da-2fa0-465c-982a-b953d3afacdf","projectId":"project-1","errorCode":"INSUFFICIENT_BALANCE","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"}}

 ✓ tests/integration/api/editor-ai-routes.test.ts (32 tests) 179ms
 ✓ tests/unit/worker/editor-smart-cut-task-handler.test.ts (6 tests) 5ms

 Test Files  3 passed (3)
      Tests  51 passed (51)
   Start at  15:08:28
   Duration  2.78s (transform 337ms, setup 11ms, collect 443ms, tests 1.37s, environment 283ms, prepare 92ms)
```

命令：
```bash
npx tsc --noEmit 2>&1 | grep -iE "useEditorProjectSync|editor-stage-runtime|SmartCut"
```
完整输出：
```text
(no output)
```

### Concern
- `tests/unit/editor-stage-runtime.test.ts` 仍输出既有 React 19 `act(...)` warning；全部断言通过，未发现功能失败。

### 测试完整原始输出补充

命令：
```bash
npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/unit/editor-stage-runtime.test.ts tests/unit/worker/editor-smart-cut-task-handler.test.ts tests/integration/api/editor-ai-routes.test.ts --reporter=dot
```
完整输出：
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

 ✓ tests/unit/editor-stage-runtime.test.ts (13 tests) 1189ms
   ✓ useEditorProjectSync > flushes a pending debounced save on window blur and hidden visibilitychange 1039ms
stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'smart-cut' returns 404 for another project editorProject
{"ts":"2026-06-22T15:11:15.312+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"7f75de30-3e15-47d5-a2e4-c5acdd1883e4","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'caption' returns 404 for another project editorProject
{"ts":"2026-06-22T15:11:15.314+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"1bfd7870-857f-44a4-80d6-4dd0fc1dd0bc","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/caption","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'enhance restore' returns 404 for another project editorProject
{"ts":"2026-06-22T15:11:15.314+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"c970dc5a-e635-48b9-84a1-27434b77e548","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'enhance smart crop' returns 404 for another project editorProject
{"ts":"2026-06-22T15:11:15.314+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"8f14fefb-61ed-48fb-91c1-376117a642ac","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'voice-optimize durationSeconds' returns 404 for another project editorProject
{"ts":"2026-06-22T15:11:15.315+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"9861f0ff-1cae-43da-bb78-54e8dd792cc1","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'voice-optimize maxSeconds fallback' returns 404 for another project editorProject
{"ts":"2026-06-22T15:11:15.315+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"c07bec07-6c6f-4b4b-9e83-16fc415e18c0","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'transition' returns 404 for another project editorProject
{"ts":"2026-06-22T15:11:15.315+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"3d55f46d-87fa-4cf2-a902-80fc2ce69c07","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/transition","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:246:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > smart-cut returns 400 and does not enqueue when the episode has no video panels
{"ts":"2026-06-22T15:11:15.326+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"SMART_CUT_NO_VIDEO_PANELS","requestId":"f40814f2-b0af-4835-be17-b058ddb7227e","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"SMART_CUT_NO_VIDEO_PANELS","stack":"ApiError: SMART_CUT_NO_VIDEO_PANELS\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/smart-cut/route.ts:31:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:205:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:318:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > smart-cut propagates insufficient balance from task submission as 402
{"ts":"2026-06-22T15:11:15.327+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Insufficient balance","requestId":"3855df51-6377-4505-b98b-04a562b2f8f2","projectId":"project-1","errorCode":"INSUFFICIENT_BALANCE","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"Insufficient balance","stack":"ApiError: Insufficient balance\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:340:42\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runFiles (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1262:5)\n    at startTests (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1271:3)\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/vitest/dist/chunks/runBaseTests.3qpJUEJM.js:126:11\n    at withEnv (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/vitest/dist/chunks/runBaseTests.3qpJUEJM.js:90:5)","code":"INSUFFICIENT_BALANCE"}}

 ✓ tests/integration/api/editor-ai-routes.test.ts (32 tests) 185ms
 ✓ tests/unit/worker/editor-smart-cut-task-handler.test.ts (6 tests) 5ms

 Test Files  3 passed (3)
      Tests  51 passed (51)
   Start at  15:11:12
   Duration  2.82s (transform 340ms, setup 12ms, collect 478ms, tests 1.38s, environment 299ms, prepare 98ms)

```
