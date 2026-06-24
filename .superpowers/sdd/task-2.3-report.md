# Task 2.3 自动字幕报告

## 状态
DONE

## 实现决策
- 选择 A：不依赖 `@twick/workflow` 的 caption runtime API。原因是 POC 已发现该包运行时导出与 `.d.ts` 子路径声明不一致，MVP 用本地纯函数更稳定、可单测、避免类型解析坑。
- 字幕来源：直接使用 `NovelPromotionVoiceLine.content`，不做 Whisper/ASR 转写。
- 时间轴：每条可用 voice line 生成一条 caption element，按 voice line 顺序累加 `audioDuration` / `audioMedia.durationMs` / 默认 2s 排布。
- 样式：复用 `voiceLineToCaptionElement` 默认样式（32px、白色填充、黑色描边、居中）。`CaptionStylePanel` 当前是 MVP 占位/说明面板，暂不编辑样式。

## 字幕生成逻辑
- `src/lib/twick/project-builder.ts`
  - 新增 `buildCaptionTrack`：把 voice line 文本转换为 Twick `caption` track，元素结构为 `type: 'caption'`、`t`、`s`、`e`、`props`、`metadata`。
  - 新增 `mergeCaptionTrackIntoProject`：保留现有非字幕轨道，替换已有 caption track，再写入新的 caption track。
  - 新增 `applyCaptionsToProject`：组合构建和合并，返回 `captionCount` 与 `totalDurationSeconds`。
- 不重建整个 editor project；只读取现有 `projectData`，替换/新增 caption track 后保存。

## Worker / 计费
- 新增 handler：`src/lib/workers/handlers/editor-caption-task-handler.ts`
  - 解析 `episodeId` / `editorProjectId`。
  - 校验 editor project 归属 episode。
  - 读取 `novelPromotionVoiceLine` 的真实字段：`content`、`audioDuration`、`audioMedia.durationMs`、`speaker`。
  - 空字幕保护：没有可生成字幕时抛 `CAPTION_NO_VOICE_LINES`，不更新 project，交给 `withTaskLifecycle` 退款/回滚。
  - 成功后更新 `NovelPromotionEditorProject.projectData` 并 `version + 1`。
- Worker 注册：`src/lib/workers/text.worker.ts` 增加 `TASK_TYPE.EDITOR_AI_CAPTION` case。
- 计费量：handler 返回 `actualQuantity = max(0.01, totalDurationSeconds / 60)`，让结算按实际字幕覆盖分钟数执行；路由预冻结仍按前端估算 `durationMinutes`，最低 0.01 分钟。

## API 路由
- `src/app/api/novel-promotion/[projectId]/editor/ai/caption/route.ts`
  - 复用 Task 2.2 的 `createEditorAiRoute` 模式。
  - taskType: `EDITOR_AI_CAPTION`。
  - billingItem: `editor_caption_generate`。
  - beforeSubmit 查询 voice lines，拒绝无文本/全空白内容，返回 `CAPTION_NO_VOICE_LINES`。
  - dedupeKey 使用 `_shared.ts` 默认逻辑（requestId 优先，否则 body hash）。

## 前端
- 新增 `CaptionPanel.tsx`，结构照搬 `SmartCutPanel.tsx`：
  - 发起前 `await flushProjectSave()`。
  - POST `/api/novel-promotion/${projectId}/editor/ai/caption`。
  - 提交 `durationMinutes` 作为预冻结估算。
  - 使用 SSE + 2.5s polling fallback 监听任务完成。
  - 完成后 invalidate tasks 并 `reloadProject()`。
- `RightPanel.tsx` 将原 captions 占位卡替换为真实 `CaptionPanel`。
- 新增 `CaptionStylePanel.tsx` 占位，说明默认样式与后续编辑范围。
- 中英文 i18n 已补充。

## 复用 Task 2.2 模式
- Handler 的 payload 解析、project 查询、progress 上报、`assertTaskActive`、更新 project/version、返回 `actualQuantity`。
- 路由的 `createEditorAiRoute`、billing、dedupe、beforeSubmit 空数据校验。
- 前端的 flush、提交任务、SSE 完成刷新、polling fallback、错误显示。

## 测试命令与输出

### 1. 初次尝试
命令：
```bash
npm run test:unit -- tests/unit/lib/twick/project-builder.test.ts tests/unit/worker/editor-caption-task-handler.test.ts tests/unit/worker/editor-smart-cut-task-handler.test.ts tests/integration/api/editor-ai-routes.test.ts
```
输出：
```text
Exit code 1
npm error Missing script: "test:unit"
npm error
npm error To see a list of scripts, run:
npm error   npm run
npm error A complete log of this run can be found in: /Users/xiaomao/.npm/_logs/2026-06-22T07_27_26_121Z-debug-0.log
```

### 2. 相关测试
命令：
```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/lib/twick/project-builder.test.ts tests/unit/worker/editor-caption-task-handler.test.ts tests/unit/worker/editor-smart-cut-task-handler.test.ts tests/integration/api/editor-ai-routes.test.ts
```
最终输出摘要：
```text
RUN  v2.1.9 /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor

✓ tests/integration/api/editor-ai-routes.test.ts (33 tests) 227ms
✓ tests/unit/worker/editor-smart-cut-task-handler.test.ts (6 tests) 6ms
✓ tests/unit/worker/editor-caption-task-handler.test.ts (5 tests) 5ms
✓ tests/unit/lib/twick/project-builder.test.ts (7 tests) 4ms

Test Files  4 passed (4)
Tests  51 passed (51)
Start at  15:31:29
Duration  1.55s (transform 282ms, setup 16ms, collect 374ms, tests 242ms, environment 0ms, prepare 150ms)
```
说明：integration route 测试中预期 404/400/402 分支会打印 error 日志；断言均通过。

### 3. 需求指定过滤 typecheck
命令：
```bash
npm run typecheck 2>&1 | grep -iE "caption|editor.*handler|Caption"
```
输出：
```text

```
说明：无 caption/editor handler 相关 TypeScript 诊断。

### 4. 全量 typecheck
命令：
```bash
npm run typecheck
```
输出：
```text
Exit code 1

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
tests/unit/storyboard-images/grid-video-prompt.test.ts(100,9): error TS1117: An object literal cannot have multiple properties with the same name.
tests/unit/storyboard-images/grid-video-prompt.test.ts(126,11): error TS1117: An object literal cannot have multiple properties with the same name.
```
说明：全量 typecheck 失败来自既有测试依赖/断言类型与 grid-video-prompt 重复字段问题；过滤 typecheck 无本任务相关错误。


## 修复轮次

### 4 个 Important 修复
1. handler 版本竞态：`editor-caption-task-handler.ts` 写回改为 `updateMany({ where: { id, version } })` 乐观锁；版本冲突时最多 3 次重读最新 `projectData` 并重新替换 caption track，避免覆盖用户/其他标签页新编辑。
2. 字幕时间轴错位：`project-builder.ts` 生成字幕前扫描现有 audio track，按 `element.metadata.voiceLineId` 读取真实 `s/e`；命中的 voice line 字幕对齐音频实际位置，未命中继续使用顺序 fallback。
3. nullable content 空校验：caption route 的 beforeSubmit 改为 `typeof line.content === 'string' && line.content.trim().length > 0`，全空/nullable 返回 400 `CAPTION_NO_VOICE_LINES`，不再 TypeError 500。
4. 预冻结时长低估：caption route 服务端查询 voice lines 的 `audioDuration` / `audioMedia.durationMs` / 2s fallback 计算 `durationMinutes` 并合并到 effective body；`_shared.ts` 使用 effective body 构造 billingInfo/payload/dedupe；`task-policy.ts` 对 editor caption 支持 0.01 分钟最小量，保证默认 task billing 与 route 的分钟级计费一致，不再强制抬到 1 分钟。

### 测试补充
- handler：补版本变更后重读重合并、不丢用户 overlay 的用例；补按 audio element `s/e` 对齐字幕用例。
- route：补 `content: null`/空白返回 400 的用例。
- 计费：补前端传 0.01 时服务端按 DB 音频时长覆盖预冻结量的用例；同步验证 payload/billing quantity。
- project-builder：补 audio range lookup + sequential fallback 的字幕排布用例。

### smart-cut 影响
- `buildInitialProject` 未改动；`buildCaptionTrack` 的显式 `startTime/endTime` 只影响 caption 生成路径。
- `editor-smart-cut-task-handler.test.ts` 在指定测试命令中通过，未发现 smart-cut 回归。

### 测试命令与完整输出

命令：
```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/lib/twick/project-builder.test.ts tests/unit/worker/editor-caption-task-handler.test.ts tests/unit/worker/editor-smart-cut-task-handler.test.ts tests/integration/api/editor-ai-routes.test.ts --reporter=dot
```
输出：
```text
[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v2.1.9 /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'smart-cut' returns 404 for another project editorProject
{"ts":"2026-06-22T16:52:26.740+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"62ccd4dc-de1e-45b6-8cc8-b6cdecb378b0","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":2,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:254:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'caption' returns 404 for another project editorProject
{"ts":"2026-06-22T16:52:26.748+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"66d31e6d-f852-4057-8ae8-2cb92b5272bc","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/caption","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:254:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'enhance restore' returns 404 for another project editorProject
{"ts":"2026-06-22T16:52:26.749+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"d7f8ec4b-6d02-4ded-9c21-ce6d0eb83265","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:254:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'enhance smart crop' returns 404 for another project editorProject
{"ts":"2026-06-22T16:52:26.750+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"e8bf4205-0e3c-405a-8533-8f9ccbacf628","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:254:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'voice-optimize durationSeconds' returns 404 for another project editorProject
{"ts":"2026-06-22T16:52:26.750+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"4e7ce38e-d9c7-4f7b-94c5-23213eeb4fd9","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:254:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'voice-optimize maxSeconds fallback' returns 404 for another project editorProject
{"ts":"2026-06-22T16:52:26.750+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"56f447fa-dff8-45f6-a085-960d55b7119e","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:254:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'transition' returns 404 for another project editorProject
{"ts":"2026-06-22T16:52:26.751+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"5d22bd19-1236-43f0-9a02-4d74ee86321c","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/transition","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:175:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:199:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:254:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > smart-cut returns 400 and does not enqueue when the episode has no video panels
{"ts":"2026-06-22T16:52:26.773+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"SMART_CUT_NO_VIDEO_PANELS","requestId":"361cf55b-f4b3-4a13-aa6c-4e32edd33679","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"SMART_CUT_NO_VIDEO_PANELS","stack":"ApiError: SMART_CUT_NO_VIDEO_PANELS\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/smart-cut/route.ts:31:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:205:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:329:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > caption returns 400 and does not enqueue when the episode has no voice-line text
{"ts":"2026-06-22T16:52:26.775+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"CAPTION_NO_VOICE_LINES","requestId":"c5e390a8-77ef-4f29-a5a6-23a737f671b6","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/caption","errorType":"ApiError"},"error":{"name":"ApiError","message":"CAPTION_NO_VOICE_LINES","stack":"ApiError: CAPTION_NO_VOICE_LINES\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/caption/route.ts:39:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:205:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:353:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > caption returns 400 instead of 500 when all voice-line content is nullable or blank
{"ts":"2026-06-22T16:52:26.777+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"CAPTION_NO_VOICE_LINES","requestId":"cd0da844-9ab6-4c64-8249-e0b6ecb7ddde","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/caption","errorType":"ApiError"},"error":{"name":"ApiError","message":"CAPTION_NO_VOICE_LINES","stack":"ApiError: CAPTION_NO_VOICE_LINES\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/caption/route.ts:39:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:205:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:385:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > smart-cut propagates insufficient balance from task submission as 402
{"ts":"2026-06-22T16:52:26.780+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Insufficient balance","requestId":"14dc6574-63e4-4ac1-b8c4-c3217f38c05b","projectId":"project-1","errorCode":"INSUFFICIENT_BALANCE","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"Insufficient balance","stack":"ApiError: Insufficient balance\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:426:42\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runFiles (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1262:5)\n    at startTests (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1271:3)\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/vitest/dist/chunks/runBaseTests.3qpJUEJM.js:126:11\n    at withEnv (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/vitest/dist/chunks/runBaseTests.3qpJUEJM.js:90:5)","code":"INSUFFICIENT_BALANCE"}}

 ✓ tests/integration/api/editor-ai-routes.test.ts (35 tests) 447ms
   ✓ editor AI route skeletons > 'smart-cut' returns 401 when unauthenticated 362ms
 ✓ tests/unit/worker/editor-caption-task-handler.test.ts (7 tests) 13ms
 ✓ tests/unit/worker/editor-smart-cut-task-handler.test.ts (6 tests) 8ms
 ✓ tests/unit/lib/twick/project-builder.test.ts (8 tests) 5ms

 Test Files  4 passed (4)
      Tests  56 passed (56)
   Start at  16:52:25
   Duration  2.54s (transform 531ms, setup 30ms, collect 614ms, tests 472ms, environment 1ms, prepare 263ms)
```

命令：
```bash
npx tsc --noEmit 2>&1 | grep -iE "caption|editor.*handler|Caption|project-builder"
```
输出：
```text
(no output)
```
说明：grep exit code 为 1，表示没有匹配到 caption/editor handler/project-builder 相关 TypeScript 诊断。


## 修复轮次 2

### 统一冻结/结算来源
- 新增 `src/lib/twick/caption-duration.ts` 共享纯函数：统一把 DB voice lines 转成 caption sources，并按 editor project audio track 中 `metadata.voiceLineId` 匹配 `s/e` 计算字幕覆盖时长。
- `project-builder.applyCaptionsToProject` 复用同一个 audio range 对齐函数生成 caption track；worker 继续以生成后的 caption 覆盖时长作为 `actualQuantity`。
- caption route 的 `beforeSubmit` 现在读取已校验归属的 `editorProject.projectData`，使用同一套 voiceLineId/audio `s/e` 逻辑估算冻结量。
- 冻结秒数取 `max(DB/fallback voice-line duration sum, editor timeline matched duration sum)`；当用户把 editor audio element 拉长到大于 DB 音频时长时，预冻结量覆盖 worker 实际结算量，避免系统性低估。
- 未增加额外安全余量；当前保证来自同一共享函数 + max(DB, editor timeline)。仍保留已知 concern：冻结后、worker 执行前如果用户继续拉长 audio timeline，仍可能产生时间差窗口。

### 测试补充
- 共享时长计算单测：命中 editor audio、未命中 DB/fallback、混合命中/未命中。
- route 集成测试：editor audio `(e-s)` 大于 DB 音频时，提交冻结 `durationMinutes` 使用 editor timeline，验证 freeze>=actual 的低估路径被消除。
- worker 单测：实际结算量来自与 caption placement 相同的 editor audio timeline。

### 测试命令与完整输出

命令（targeted tests）：
```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/lib/twick/project-builder.test.ts tests/unit/worker/editor-caption-task-handler.test.ts tests/unit/worker/editor-smart-cut-task-handler.test.ts tests/integration/api/editor-ai-routes.test.ts --reporter=dot
```
退出码：0
输出：
```text
[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v2.1.9 /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'smart-cut' returns 404 for another project editorProject
{"ts":"2026-06-22T17:09:32.552+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"27e84bc7-e4ee-4ccd-a991-63b4c82c1d67","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:259:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'caption' returns 404 for another project editorProject
{"ts":"2026-06-22T17:09:32.554+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"d8414c1b-e802-411f-b1d7-a49d37836969","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/caption","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:259:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'enhance restore' returns 404 for another project editorProject
{"ts":"2026-06-22T17:09:32.554+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"1c6c8aa7-e06e-4da3-ab64-1d393fa9afcf","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:259:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'enhance smart crop' returns 404 for another project editorProject
{"ts":"2026-06-22T17:09:32.555+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"11855d22-20c3-4aa7-863e-fc522768babe","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:259:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'voice-optimize durationSeconds' returns 404 for another project editorProject
{"ts":"2026-06-22T17:09:32.555+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"b1b7c064-590e-4b9c-8395-a0bff97a823f","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:259:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'voice-optimize maxSeconds fallback' returns 404 for another project editorProject
{"ts":"2026-06-22T17:09:32.555+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"05bad977-1d74-495b-b5b0-9057ac76c8fb","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:259:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'transition' returns 404 for another project editorProject
{"ts":"2026-06-22T17:09:32.556+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"cee5a06c-d8d2-44be-a8b6-2f1192d7b67b","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/transition","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:259:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > smart-cut returns 400 and does not enqueue when the episode has no video panels
{"ts":"2026-06-22T17:09:32.564+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"SMART_CUT_NO_VIDEO_PANELS","requestId":"8e5c9e4b-495b-4373-9c96-809ba7506bbb","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"SMART_CUT_NO_VIDEO_PANELS","stack":"ApiError: SMART_CUT_NO_VIDEO_PANELS\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/smart-cut/route.ts:31:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:334:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > caption returns 400 and does not enqueue when the episode has no voice-line text
{"ts":"2026-06-22T17:09:32.565+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"CAPTION_NO_VOICE_LINES","requestId":"beeaa0f3-9c9c-482b-a4e8-9003056f74cc","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/caption","errorType":"ApiError"},"error":{"name":"ApiError","message":"CAPTION_NO_VOICE_LINES","stack":"ApiError: CAPTION_NO_VOICE_LINES\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/caption/route.ts:40:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:358:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > caption returns 400 instead of 500 when all voice-line content is nullable or blank
{"ts":"2026-06-22T17:09:32.566+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"CAPTION_NO_VOICE_LINES","requestId":"f35b0dcc-64a4-4f6d-9e79-ba5f596bbb52","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/caption","errorType":"ApiError"},"error":{"name":"ApiError","message":"CAPTION_NO_VOICE_LINES","stack":"ApiError: CAPTION_NO_VOICE_LINES\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/caption/route.ts:40:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:392:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > smart-cut propagates insufficient balance from task submission as 402
{"ts":"2026-06-22T17:09:32.567+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Insufficient balance","requestId":"e087f5aa-18c7-4e48-9855-e163a56df585","projectId":"project-1","errorCode":"INSUFFICIENT_BALANCE","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"Insufficient balance","stack":"ApiError: Insufficient balance\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:473:42\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runFiles (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1262:5)\n    at startTests (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1271:3)\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/vitest/dist/chunks/runBaseTests.3qpJUEJM.js:126:11\n    at withEnv (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/vitest/dist/chunks/runBaseTests.3qpJUEJM.js:90:5)","code":"INSUFFICIENT_BALANCE"}}

 ✓ tests/integration/api/editor-ai-routes.test.ts (36 tests) 177ms
 ✓ tests/unit/worker/editor-caption-task-handler.test.ts (8 tests) 5ms
 ✓ tests/unit/lib/twick/project-builder.test.ts (11 tests) 4ms
 ✓ tests/unit/worker/editor-smart-cut-task-handler.test.ts (6 tests) 5ms

 Test Files  4 passed (4)
      Tests  61 passed (61)
   Start at  17:09:31
   Duration  1.28s (transform 236ms, setup 8ms, collect 308ms, tests 192ms, environment 0ms, prepare 118ms)

```

命令（targeted typecheck）：
```bash
npx tsc --noEmit 2>&1 | grep -iE "caption|editor.*handler|project-builder|_shared"
```
退出码：1
输出：
```text
(no output)
```

