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
