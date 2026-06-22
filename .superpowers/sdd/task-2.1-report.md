# Task 2.1 Report: Twick Editor AI Task Types + Billing + API Skeletons

## Status
DONE_WITH_CONCERNS

## Real infrastructure used

### Task types
- Real definition: `src/lib/task/types.ts`
- Real constant: `TASK_TYPE` object with `TaskType = (typeof TASK_TYPE)[keyof typeof TASK_TYPE]`
- Added:
  - `EDITOR_AI_SMART_CUT = 'editor_ai_smart_cut'`
  - `EDITOR_AI_CAPTION = 'editor_ai_caption'`
  - `EDITOR_AI_ENHANCE = 'editor_ai_enhance'`
  - `EDITOR_AI_VOICE_OPTIMIZE = 'editor_ai_voice_optimize'`
  - `EDITOR_RENDER = 'editor_render'`
  - `EDITOR_AI_TRANSITION = 'editor_ai_transition'` (deviation: added because transition route must submit an async/free task and Task 2.6 later needs a handler target)

### Task submission
- Real API: `src/lib/task/submitter.ts`
- Signature:
  `submitTask({ userId, locale, projectId, episodeId?, type, targetType, targetId, payload?, dedupeKey?, priority?, maxAttempts?, billingInfo?, requestId? })`
- Important behavior: for billable task types, `submitTask` computes default billing via `buildDefaultTaskBillingInfo(type, payload)` before enqueue; enqueue failure calls `rollbackTaskBillingForTask` and returns an API error.
- Queue routing: `src/lib/task/queues.ts`; editor AI skeleton tasks use default text queue, `EDITOR_RENDER` is routed to video queue.

### Billing
- Real task billing API:
  - `prepareTaskBilling(task)` in `src/lib/billing/service.ts` freezes balance in ENFORCE mode.
  - `settleTaskBilling(task, options?)` confirms charge.
  - `rollbackTaskBilling(task)` / submitter compensation rolls back frozen balance.
  - Low-level ledger: `freezeBalance(userId, amount, options?)` in `src/lib/billing/ledger.ts`.
- Added billing catalog: `src/lib/billing/items.ts`
- Added task policy integration: `src/lib/billing/task-policy.ts`
- Prices used from brief examples:
  - `editor_smart_cut`: per use, `0.05`
  - `editor_caption_generate`: per minute, `0.02`
  - `editor_ai_enhance_smart_crop`: per second, `0.01`
  - `editor_ai_enhance_restore`: per second, `0.015`
  - `editor_export`: per minute, `0.01`
- `EDITOR_AI_VOICE_OPTIMIZE` reuses existing voice billing (`index-tts2`, seconds), matching the Phase 2.4 plan note to reuse voice generation billing.
- `transition` is free: route submits `billingInfo: null`; task type is intentionally not in `BILLABLE_TASK_TYPES`.

### Auth/error pattern
- Followed Task 1.3 editor route pattern from `src/app/api/novel-promotion/[projectId]/editor/route.ts`:
  - `apiHandler`
  - `getAuthSession`
  - `ApiError`
  - `project.findFirst({ id, userId })` for multi-tenant isolation
  - `novelPromotionEditorProject.findFirst` joined through episode → novelPromotionProject → projectId

## Routes implemented
Created shared helper plus 5 route skeletons:
- `src/app/api/novel-promotion/[projectId]/editor/ai/_shared.ts`
- `src/app/api/novel-promotion/[projectId]/editor/ai/smart-cut/route.ts`
- `src/app/api/novel-promotion/[projectId]/editor/ai/caption/route.ts`
- `src/app/api/novel-promotion/[projectId]/editor/ai/enhance/route.ts`
- `src/app/api/novel-promotion/[projectId]/editor/ai/voice-optimize/route.ts`
- `src/app/api/novel-promotion/[projectId]/editor/ai/transition/route.ts`

Each route:
1. Authenticates user.
2. Verifies `projectId` belongs to `userId`.
3. Verifies `episodeId` + `editorProjectId` belongs to the project.
4. Builds billing metadata for billable routes; transition is free.
5. Calls real `submitTask`.
6. Returns `{ data: { taskId } }`.

## Error/rollback behavior
- Insufficient balance is handled by real `submitTask`/`prepareTaskBilling`: task is marked failed and `ApiError('INSUFFICIENT_BALANCE')` returns 402.
- Enqueue failure rollback is handled by real `submitTask`: `rollbackTaskBillingForTask` is called after `markTaskEnqueueFailed`; compensation failure becomes `BILLING_COMPENSATION_FAILED` / internal error.
- Route skeletons do not manually freeze/rollback; they use the project’s task billing pipeline as `generate-video` does.

## Tests

### Commands run
1. Initial mistaken command:
   - `npm run test:unit -- --run tests/integration/api/editor-ai-routes.test.ts tests/unit/billing/service.test.ts`
   - Output: failed because package has no `test:unit` script.
2. Broad script attempt:
   - `npm run test:integration:api -- --run tests/integration/api/editor-ai-routes.test.ts && npm run test:billing:unit -- --run tests/unit/billing/service.test.ts`
   - Output: first script expanded to all `tests/integration/api`; not used as final focused evidence.
3. Focused tests:
   - `npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/integration/api/editor-ai-routes.test.ts tests/unit/billing/service.test.ts`
   - Output: `Test Files 2 passed (2)`, `Tests 31 passed (31)`.
4. Requested filtered typecheck:
   - `npx tsc --noEmit 2>&1 | grep -iE "editor/ai|task-type|billing" || true`
   - Output: no matching errors after fix.
5. Full typecheck:
   - `npx tsc --noEmit`
   - Output: fails on pre-existing unrelated test issues in `tests/unit/components/art-style-library/ArtStyleEditor.test.tsx` (`@testing-library/react` / matcher types) and `tests/unit/storyboard-images/grid-video-prompt.test.ts` duplicate object properties.
6. Guards:
   - `npm run check:test-tasktype-coverage`
   - Output: OK `taskTypes=47`.
   - `npm run check:test-route-coverage`
   - Output: fails on pre-existing unrelated missing route catalog entries (`admin/config-center/art-styles/*`, `art-styles/*`, `asset-hub/voice-clone`, `character/.../recommend-voice-instruct`, `providers/omnivoice/health`). New editor AI routes were added to the catalog.
7. Whitespace check:
   - `git diff --check`
   - Output: no issues.

### Test coverage added
- `tests/integration/api/editor-ai-routes.test.ts`
  - smart-cut: 401, other project 404, normal returns `{ data: { taskId } }`, insufficient balance 402.
  - transition: 401, other project 404, normal returns `{ data: { taskId } }` with `billingInfo: null`.
- `tests/unit/billing/service.test.ts`
  - editor smart-cut task billing freezes, settles, and rolls back using configured item price.

## Brief deviations / concerns
1. Added `EDITOR_AI_TRANSITION` even though brief listed only 5 new task constants. Reason: the transition route is required to submit a task and Task 2.6 later references a transition worker handler; keeping it free/non-billable preserves the brief’s billing requirement.
2. Route-level `billingInfo` is passed, but for billable task types the real `submitTask` prefers `buildDefaultTaskBillingInfo(type, payload)`. Therefore the real source of billing truth is `src/lib/billing/task-policy.ts`; the route billing object is mostly redundant but harmless and useful for mocks/tests.
3. Editor fixed-price billing uses the existing task billing shape (`apiType: 'text'`, `model: billingItem`, `maxFrozenCost`) to avoid expanding global provider pricing API types. This works because `prepareTaskBilling` honors `quotedCost` before provider/model resolution.
4. Full typecheck and route coverage guard still have unrelated pre-existing failures; the requested filtered typecheck has no matching errors.

## 修复轮次

### 状态
DONE

### 修复 1：editor 固定价结算不再走 text usage / text model pricing
- `TaskBillingInfo.apiType` 增加 `editor`，`unit` 增加 `minute`，editor 固定价项从源头不再伪装成 `apiType: 'text'`。
- `buildEditorTaskInfo` / route 侧 editor billingInfo 使用 catalog 定义的真实单位：smart-cut = `call`，caption = `minute`，enhance/render = `second`/`minute`。
- `resolveTaskActual` 在 text usage 分支之前识别 editor billing item（`apiType === 'editor'` 或 `metadata.billingItem` 命中 `BILLING_ITEMS`），按 `calculateBillingItemCost(billingItem, actualQuantity || quotedQuantity)` 结算：
  - caption/smart-cut worker 即使收集到 LLM `textUsage`，也只按 editor catalog 固定价确认扣费。
  - enhance/render worker 返回 `actualSeconds`/`actualQuantity` 时，按 editor catalog 单价 × 实际用量结算，不再尝试解析 `editor_*` 为 text model。
- 非 editor 分支保留原有 text/voice/image/video/lip-sync 逻辑；text usage override 只继续适用于真实 `apiType: 'text'` 的任务。

### 修复 2：5 个 editor AI 路由稳定 dedupeKey
- `createEditorAiRoute` 统一生成 `dedupeKey`：`editor-ai:${action}:${editorProjectId}:${requestId 或输入hash}`。
- requestId 优先级：body 中显式 `requestId`（客户端短期幂等）优先，其次 `x-request-id` / API request id；都没有时使用稳定 JSON 输入 hash。
- `submitTask` 的真实语义已确认：`dedupeKey` 传入 `createTask`，已有 active task 且 job alive 时返回 `{ deduped: true }`，不会创建新 task，也不会再次执行 `prepareTaskBilling` 冻结余额；terminal task 会释放 key 允许重新创建。
- billingKey 仍用于冻结 idempotency metadata；重复提交防重复建任务/冻结依赖 submitter 的 `dedupeKey`，不会被 `buildDefaultTaskBillingInfo` 覆盖。

### 修复 3：测试覆盖补全
- `tests/integration/api/editor-ai-routes.test.ts` 改为 table-driven，覆盖 smart-cut、caption、enhance restore、enhance smart-crop、voice-optimize durationSeconds、voice-optimize maxSeconds fallback、transition。
- 覆盖每个路由的：task type、payload、dedupeKey、401、project 越权 404、editorProject 越权 404。
- 覆盖计费映射：caption durationMinutes、enhance restore/smart_crop + durationSeconds、voice-optimize durationSeconds/maxSeconds、smart-cut 按次、transition `billingInfo: null` 且 default task billing 为 null。
- 增加重复 requestId 提交测试：两次 route 调用传同一 `dedupeKey`，由 `submitTask` 幂等返回同一 taskId。
- `tests/unit/billing/service.test.ts` 增加 editor catalog settlement 回归：
  - caption 带大量 textUsage 仍按固定每分钟价结算。
  - enhance 返回 actualSeconds 时按 editor catalog 单价 × 实际秒数结算，并不会走 text model 解析。

### 命令与完整输出

#### Focused tests
Command:
`npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/integration/api/editor-ai-routes.test.ts tests/unit/billing/service.test.ts --reporter=dot`

Output:
```text
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

 RUN  v2.1.9 /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor

 ✓ tests/unit/billing/service.test.ts (26 tests) 44ms
 ✓ tests/integration/api/editor-ai-routes.test.ts (30 tests) 248ms

 Test Files  2 passed (2)
      Tests  56 passed (56)
   Start at  13:13:25
   Duration  1.44s (transform 337ms, setup 8ms, collect 436ms, tests 291ms, environment 0ms, prepare 101ms)
```
Note: passing tests intentionally emit billing overage/rollback and route 404/402 logs on stderr for covered error paths; no test failures.

#### Requested filtered typecheck
Command:
`npx tsc --noEmit 2>&1 | grep -iE "editor/ai|task-policy|billing/service|billing/items|_shared"`

Output:
```text

```
No matching errors.

#### Full typecheck guard
Command:
`npx tsc --noEmit`

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
These are pre-existing unrelated failures outside touched editor/billing paths; requested filtered typecheck is clean.

### 对现有 billing 逻辑影响
- text/voice/image/video/lip-sync 的 `resolveTaskActual` 分支未改变语义。
- 只新增 editor catalog 分支，且在 textUsage 分支前短路 editor item，避免 editor fixed-price 被 text usage 覆盖。
- Voice optimize 继续复用现有 voice billing policy。
