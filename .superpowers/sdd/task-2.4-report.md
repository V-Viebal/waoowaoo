# Task 2.4 Report: AI 配音优化（Voice Optimize）

## 状态
DONE_WITH_CONCERNS

## 复用现有语音生成代码
- 复用并轻量重构 `src/lib/voice/generate-voice-line.ts`：抽出 `synthesizeVoiceLineAudio()`，仍由原 `generateVoiceLine()` 调用，保持现有 voice line 生成行为。
- Voice Optimize handler 调用同一套 provider 选择、音色绑定解析、Bailian/OmniVoice/FAL IndexTTS2 TTS 生成、上传存储逻辑。
- 生成后的音频通过 `ensureMediaObjectFromStorageKey()` 建立 `MediaObject`，timeline 使用 `mediaobj://<id>`。

## Handler / Worker / Route
- 新增 `src/lib/workers/handlers/editor-voice-optimize-task-handler.ts`
  - 校验 `episodeId` / `editorProjectId` / `voiceLineId`。
  - 读取原 voice line 的 `content/speaker/emotionPrompt/emotionStrength`，MVP 支持直接编辑文案与 speaker 后重新生成。
  - 不修改原 `NovelPromotionVoiceLine`，只创建新的 editor asset 并替换 timeline audio element。
  - 使用 `updateMany({ id, version })` 乐观锁，冲突后最多重读重做 3 次，保留用户并发编辑。
  - 返回 `actualQuantity/actualSeconds`，由 worker lifecycle 按实际秒数结算；失败走现有 rollback。
- 更新 `src/lib/workers/voice.worker.ts`
  - `EDITOR_AI_VOICE_OPTIMIZE` 注册到 voice worker。
- 更新 `src/lib/task/queues.ts`
  - `EDITOR_AI_VOICE_OPTIMIZE` 路由到 voice queue，避免落到 text worker。
- 更新 `src/app/api/novel-promotion/[projectId]/editor/ai/voice-optimize/route.ts`
  - 增加 `voiceLineId` 必填和 episode 内归属校验。
  - 校验文案非空。
  - 计费秒数优先用客户端 `durationSeconds/maxSeconds`，无则回退 DB 音频时长或文本估算。

## 替换 element 逻辑
- 新增纯函数 `replaceVoiceOptimizeAudioElement()`：`src/lib/twick/voice-optimize.ts`
  - 仅匹配 `type === 'audio'` 且 `metadata.voiceLineId` 符合（可再限定 `selectedElementId`）的元素。
  - 替换 `props.src` 为 `mediaobj://新MediaObjectId`。
  - 按新音频时长更新 `e = s + duration`；如设置 speed，则 duration 除以 speed，并写入 `props.playbackRate`。
  - 更新 project metadata custom.duration。
  - 不改无关 track/element。

## 前端
- 新增 `VoiceOptimizePanel.tsx`
  - 复用 `CaptionPanel` / `SmartCutPanel` 的模式：提交前 `flushProjectSave()`，提交后订阅 SSE + 轮询 fallback，完成后 `reloadProject()`。
  - 从 Twick `useTimelineContext()` 获取选中元素，要求选中 timeline audio element 且有 `metadata.voiceLineId`。
  - 支持直接编辑文案、speaker、speed 后重新生成。
- `RightPanel.tsx` 接入 `VoiceOptimizePanel`，替换原 AI polish 占位的一部分。
- 中英文 i18n 已补充。

## 计费
- 沿用现有 `buildDefaultTaskBillingInfo()` 中 `EDITOR_AI_VOICE_OPTIMIZE -> buildVoiceTaskInfo()`：`apiType: voice`、`model: index-tts2`、`unit: second`。
- route 不传 editor billing item，`submitTask()` 会按 task type 重新生成默认 voice billing info。
- handler 返回 `actualQuantity`，worker lifecycle 使用现有 `settleTaskBilling()`；失败自动 rollback。

## MVP 范围 / Concern
- MVP 未接 LLM 自动改写文案；当前是“直接编辑文案 + 重新生成”，保留了后端 payload 结构，后续可在 handler 生成前接入 LLM 改写。
- “换音色” MVP 通过修改 speaker 来复用项目内已有 speaker/角色音色绑定；未做独立音色 picker。
- “调语速” 当前通过 timeline `playbackRate` 和显示时长对齐实现；未对 TTS provider 请求做原生语速参数（现有 provider 封装未暴露统一 speed 参数）。
- Full `npx tsc --noEmit` 存在仓库既有无关测试类型错误（ArtStyleEditor testing-library/jest-dom 类型、grid-video-prompt 重复属性），但要求的 filtered typecheck 已无 voice optimize/editor handler 相关错误。

## 测试命令 + 完整输出

### Targeted tests
Command:
```bash
npx vitest run tests/unit/twick/voice-optimize.test.ts tests/unit/worker/editor-voice-optimize-task-handler.test.ts tests/unit/worker/voice-worker.test.ts tests/unit/task/queues.test.ts tests/unit/billing/task-policy.test.ts tests/unit/voice/generate-voice-line.test.ts tests/unit/providers/omnivoice/generate-voice-line.test.ts tests/integration/api/editor-ai-routes.test.ts
```
Output summary:
```text
RUN  v2.1.9 /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor

✓ tests/integration/api/editor-ai-routes.test.ts (38 tests) 1341ms
✓ tests/unit/worker/editor-voice-optimize-task-handler.test.ts (5 tests) 6ms
✓ tests/unit/worker/voice-worker.test.ts (5 tests) 11ms
✓ tests/unit/voice/generate-voice-line.test.ts (3 tests) 4ms
✓ tests/unit/providers/omnivoice/generate-voice-line.test.ts (2 tests) 4ms
✓ tests/unit/billing/task-policy.test.ts (8 tests) 17ms
✓ tests/unit/twick/voice-optimize.test.ts (3 tests) 3ms
✓ tests/unit/task/queues.test.ts (1 test) 1ms

Test Files  8 passed (8)
Tests  65 passed (65)
```
Notes: output also includes existing Vite CJS deprecation warning, OmniVoice sourcemap missing-source warnings, and expected API error logs for negative route cases.

### Required filtered typecheck
Command:
```bash
npx tsc --noEmit 2>&1 | grep -iE "voice-optimize|VoiceOptimize|editor.*handler"
```
Output:
```text
(Bash completed with no output)
```

### Full typecheck
Command:
```bash
npx tsc --noEmit
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


## 修复轮次

### 状态
DONE

### 修复说明
1. Critical 计费低估 / 免费结果
   - route 端不再优先信任客户端 `durationSeconds`。现在归一化为 `max(clientDurationSeconds, clientMaxSeconds, dbAudioDurationSeconds, estimateVoiceLineMaxSeconds(newContent))`，并 `ceil` 到整秒写入 payload 的 `durationSeconds/maxSeconds`。
   - `src/lib/billing/task-policy.ts` 的 voice 秒数从 `Math.floor` 改为 `Math.ceil`；`EDITOR_AI_VOICE_OPTIMIZE` 优先消费 route 写入的 `maxSeconds`，避免 `durationSeconds` 小数或旧片段时长压低冻结金额。
   - 已确认 `withTaskLifecycle()` 的结算时机是 handler 返回后自动 `settleTaskBilling()`，即原先若 handler 先写 timeline 再结算，存在扣费失败但 timeline 已替换风险。本轮通过“足额预冻结 + handler 持久化前保险检查”处理：handler 在创建 `EditorAsset` / 更新 timeline 前计算 `actualSeconds = ceil(generated duration)`，若 `actualSeconds > payload.maxSeconds` 直接失败，不持久化 asset/timeline；正常路径因 route 上界冻结覆盖实际结算，不会出现余额不足导致结算失败后白嫖 timeline 的情况。
2. Important 新音频覆盖相邻元素
   - `replaceVoiceOptimizeAudioElement()` 增加同 track 后续 audio element 起点检测。新 `e` 若超过下一个同轨 audio 的 `s`，抛出 `VOICE_OPTIMIZE_DURATION_OVERLAP`，不写 timeline。
   - 前端补充 overlap 错误本地化提示，提示用户缩短文案或调整时间轴。
3. Minor 后端空文案 / 空 speaker 保护
   - route 和 handler 区分“字段缺失”和“显式传空”。`content`/`text` 显式空白返回 `VOICE_OPTIMIZE_EMPTY_TEXT`；`speaker` 显式空白返回 `VOICE_OPTIMIZE_EMPTY_SPEAKER`。仅字段缺失时才 fallback 到原 voice line。
4. Minor dedupeKey 去掉 Date.now/requestId
   - voice optimize route 自定义 dedupeKey：`editorProjectId:selectedElementId:contentHash:speakerHash:speed`，不包含 `requestId` / `Date.now()`；`requestId` 仍保留为 trace。

### 对现有 voice 生成影响
- 未修改共享 `synthesizeVoiceLineAudio()` / `generateVoiceLine()` 的 provider 调用路径，只在 editor voice optimize route、billing policy、handler 持久化前检查与 timeline 替换逻辑上收敛；现有 voice line 生成测试保持通过。

### 测试命令 + 完整输出
Command:
```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/twick/voice-optimize.test.ts tests/unit/worker/editor-voice-optimize-task-handler.test.ts tests/unit/billing/task-policy.test.ts tests/integration/api/editor-ai-routes.test.ts tests/unit/worker/voice-worker.test.ts tests/unit/voice/generate-voice-line.test.ts --reporter=dot
```
Output:
```text
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

 RUN  v2.1.9 /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor

Sourcemap for "/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/vendor/omnivoice-sdk/dist/index.js" points to missing source files
Sourcemap for "/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/vendor/omnivoice-sdk/dist/client.js" points to missing source files
Sourcemap for "/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/vendor/omnivoice-sdk/dist/internal/http.js" points to missing source files
Sourcemap for "/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/vendor/omnivoice-sdk/dist/internal/sse.js" points to missing source files
Sourcemap for "/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/vendor/omnivoice-sdk/dist/design.js" points to missing source files
Sourcemap for "/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/vendor/omnivoice-sdk/dist/dub.js" points to missing source files
stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'smart-cut' returns 404 for another project editorProject
{"ts":"2026-06-22T17:57:17.025+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"c5897118-817d-4ee9-b665-7193f1ea7511","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":1,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:266:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'caption' returns 404 for another project editorProject
{"ts":"2026-06-22T17:57:17.027+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"eadb41b9-abe8-4276-942e-d1cc3bcaea1f","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/caption","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:266:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'enhance restore' returns 404 for another project editorProject
{"ts":"2026-06-22T17:57:17.027+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"746ff037-449a-4a22-b38a-c4b1f39b3578","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:266:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'enhance smart crop' returns 404 for another project editorProject
{"ts":"2026-06-22T17:57:17.028+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"7f7e35d8-2b03-451b-a499-e0e05f6f4518","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/enhance","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:266:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'voice-optimize durationSeconds' returns 404 for another project editorProject
{"ts":"2026-06-22T17:57:17.028+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"98156a9f-8e86-406b-be9a-f0174c365a85","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:266:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'voice-optimize maxSeconds fallback' returns 404 for another project editorProject
{"ts":"2026-06-22T17:57:17.029+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"c2e11ab0-290f-4e63-8b51-80fcb0ecc81a","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:266:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > 'transition' returns 404 for another project editorProject
{"ts":"2026-06-22T17:57:17.029+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Resource not found","requestId":"77547b67-ea2f-4888-ac4e-190b3c98bb7d","projectId":"project-1","errorCode":"NOT_FOUND","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/transition","errorType":"ApiError"},"error":{"name":"ApiError","message":"Resource not found","stack":"ApiError: Resource not found\n    at requireOwnedEditorProject (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:177:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:201:27\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:266:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"NOT_FOUND"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > smart-cut returns 400 and does not enqueue when the episode has no video panels
{"ts":"2026-06-22T17:57:17.039+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"SMART_CUT_NO_VIDEO_PANELS","requestId":"38c3a136-9a67-4e9d-873e-e0657a60054d","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"SMART_CUT_NO_VIDEO_PANELS","stack":"ApiError: SMART_CUT_NO_VIDEO_PANELS\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/smart-cut/route.ts:31:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:345:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > caption returns 400 and does not enqueue when the episode has no voice-line text
{"ts":"2026-06-22T17:57:17.040+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"CAPTION_NO_VOICE_LINES","requestId":"8c4ae8ed-3444-41e7-a91b-f6d7088b27f9","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/caption","errorType":"ApiError"},"error":{"name":"ApiError","message":"CAPTION_NO_VOICE_LINES","stack":"ApiError: CAPTION_NO_VOICE_LINES\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/caption/route.ts:40:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:369:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > caption returns 400 instead of 500 when all voice-line content is nullable or blank
{"ts":"2026-06-22T17:57:17.040+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"CAPTION_NO_VOICE_LINES","requestId":"f58c5986-c2b1-48d4-b8f0-6930cdacf250","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/caption","errorType":"ApiError"},"error":{"name":"ApiError","message":"CAPTION_NO_VOICE_LINES","stack":"ApiError: CAPTION_NO_VOICE_LINES\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/caption/route.ts:40:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:403:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > voice-optimize returns 400 and does not enqueue when voiceLineId is missing
{"ts":"2026-06-22T17:57:17.041+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"voiceLineId is required","requestId":"db7ad7ac-9a21-48b4-831e-a486705691e6","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"voiceLineId is required","stack":"ApiError: voiceLineId is required\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/voice-optimize/route.ts:58:13)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:45\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:419:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > voice-optimize returns 400 and does not enqueue for an invalid voiceLineId
{"ts":"2026-06-22T17:57:17.041+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"VOICE_OPTIMIZE_NO_VOICE_LINE","requestId":"04a8fb46-2a94-4029-957d-38a99067d93f","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"VOICE_OPTIMIZE_NO_VOICE_LINE","stack":"ApiError: VOICE_OPTIMIZE_NO_VOICE_LINE\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/voice-optimize/route.ts:74:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:436:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > voice-optimize returns 400 when content is explicitly blank and does not fall back to the original voice line
{"ts":"2026-06-22T17:57:17.042+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"VOICE_OPTIMIZE_EMPTY_TEXT","requestId":"3e767d11-9933-4b11-9818-10edaea70fe5","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"VOICE_OPTIMIZE_EMPTY_TEXT","stack":"ApiError: VOICE_OPTIMIZE_EMPTY_TEXT\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/voice-optimize/route.ts:81:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:464:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > voice-optimize returns 400 when speaker is explicitly blank and does not fall back to the original voice line
{"ts":"2026-06-22T17:57:17.042+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"VOICE_OPTIMIZE_EMPTY_SPEAKER","requestId":"38ac0305-1956-47cb-8fe3-ef4e4677a8eb","projectId":"project-1","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/voice-optimize","errorType":"ApiError"},"error":{"name":"ApiError","message":"VOICE_OPTIMIZE_EMPTY_SPEAKER","stack":"ApiError: VOICE_OPTIMIZE_EMPTY_SPEAKER\n    at Object.beforeSubmit (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/voice-optimize/route.ts:84:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts:207:32\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:480:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-ai-routes.test.ts > editor AI route skeletons > smart-cut propagates insufficient balance from task submission as 402
{"ts":"2026-06-22T17:57:17.045+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Insufficient balance","requestId":"fe420ae0-9557-467f-a09b-ec24210f9aa2","projectId":"project-1","errorCode":"INSUFFICIENT_BALANCE","retryable":false,"durationMs":0,"details":{"method":"POST","path":"/api/novel-promotion/project-1/editor/ai/smart-cut","errorType":"ApiError"},"error":{"name":"ApiError","message":"Insufficient balance","stack":"ApiError: Insufficient balance\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-ai-routes.test.ts:618:42\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)\n    at runFiles (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1262:5)\n    at startTests (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1271:3)\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/vitest/dist/chunks/runBaseTests.3qpJUEJM.js:126:11\n    at withEnv (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/vitest/dist/chunks/runBaseTests.3qpJUEJM.js:90:5)","code":"INSUFFICIENT_BALANCE"}}

 ✓ tests/integration/api/editor-ai-routes.test.ts (42 tests) 426ms
 ✓ tests/unit/worker/editor-voice-optimize-task-handler.test.ts (8 tests) 7ms
 ✓ tests/unit/worker/voice-worker.test.ts (5 tests) 13ms
 ✓ tests/unit/voice/generate-voice-line.test.ts (3 tests) 4ms
 ✓ tests/unit/twick/voice-optimize.test.ts (4 tests) 3ms
 ✓ tests/unit/billing/task-policy.test.ts (8 tests) 21ms

 Test Files  6 passed (6)
      Tests  70 passed (70)
   Start at  17:57:15
   Duration  2.57s (transform 412ms, setup 23ms, collect 452ms, tests 473ms, environment 1ms, prepare 247ms)


```

### Required filtered typecheck
Command:
```bash
npx tsc --noEmit 2>&1 | grep -iE "voice-optimize|VoiceOptimize|editor.*handler|task-policy"
```
Output:
```text
(Bash completed with no output)
```

### Concern
- 当前“不白嫖”方案依赖 route 预估上界足够覆盖实际 TTS，并在 handler 对 `actualSeconds > maxSeconds` 做最终保险；若 provider 极端生成超出文本估算上界，任务会失败且不替换 timeline，但已生成的临时音频 MediaObject 可能存在。MVP 未实现自动扩充冻结后再持久化，也未自动推移同轨后续音频。
