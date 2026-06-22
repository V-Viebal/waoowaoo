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
