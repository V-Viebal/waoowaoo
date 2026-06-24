# Task 3.2 Report: Export settings panel + status display

## Implementation

- Added `useEditorExport` in `src/lib/novel-promotion/stages/editor-stage-runtime/useEditorExport.ts`.
  - Flushes editor project save before export.
  - POSTs to `/api/novel-promotion/[projectId]/editor/render` with `episodeId`, `editorProjectId`, `settings`, and `requestId`.
  - Polls GET `/api/novel-promotion/[projectId]/editor/render?taskId=...` as fallback/status refresh.
  - Subscribes to workspace task SSE events when available.
  - Handles `PROCESSING`, `DONE`, `FAILED`, cancelled, retry, and DELETE cancellation.
  - Handles 409 as a dedicated concurrency conflict state/message.

- Added `ExportPanel` in `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/editor/ExportPanel.tsx`.
  - Resolution presets: 720p and 1080p.
  - FPS options: 24/30/60.
  - Format options: mp4/webm.
  - Bitrate input.
  - Progress bar and status text.
  - Cancel, retry, and download actions.

- Wired export entry into `EditorStageShell` toolbar.

- Added i18n strings in:
  - `messages/zh/novel-promotion.json`
  - `messages/en/novel-promotion.json`

## Render API contract used

Confirmed actual Task 3.1 route structure:

- POST `/api/novel-promotion/[projectId]/editor/render`
  - Body: `episodeId`, `editorProjectId`, `settings { width, height, fps, bitrate, format }`, `requestId`.
  - Response: `data.taskId`, `data.status`, `data.settings`, duration fields.
  - 409 means an active editor render already exists.

- GET `/api/novel-promotion/[projectId]/editor/render?taskId=...`
  - Response: `data.task` and `data.editorProject`.
  - Uses `task.status`/`task.progress` plus `editorProject.renderStatus` and `editorProject.renderOutputMediaObjectId`.

- DELETE `/api/novel-promotion/[projectId]/editor/render?taskId=...`
  - Cancels queued/processing task.

## Progress / download / cancel decisions

- Progress is taken from SSE `payload.progress` when available and from GET task `progress` on polling fallback.
- Completion uses worker task result `outputUrl` when present and `renderOutputMediaObjectId` from `editorProject` for display.
- Download URL is the MediaObject route returned by the worker as `outputUrl` (`/m/<publicId>`). The hook also preserves `renderOutputMediaObjectId` for status display.
- Cancel calls DELETE on the render route with the active taskId.
- 409 displays the localized “existing export in progress” message.

## Tests / typecheck

### Command

```bash
npm test -- tests/unit/editor-export-hook.test.ts
```

### Output

```text
npm error Missing script: "test"
npm error
npm error To see a list of scripts, run:
npm error   npm run
npm error A complete log of this run can be found in: /Users/xiaomao/.npm/_logs/2026-06-23T07_35_32_746Z-debug-0.log
```

### Command

```bash
npx vitest run tests/unit/editor-export-hook.test.ts
```

### Output

```text
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

 RUN  v2.1.9 /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor

 ✓ tests/unit/editor-export-hook.test.ts (4 tests) 13ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  15:35:37
   Duration  654ms (transform 54ms, setup 6ms, collect 56ms, tests 13ms, environment 305ms, prepare 34ms)
```

### Command

```bash
npx tsc --noEmit 2>&1 | grep -iE "export|Export|editor"
```

### Output

```text
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
```

### Command

```bash
npx tsc --noEmit --pretty false 2>&1 | rg "useEditorExport|ExportPanel|EditorStageShell|editor-export-hook"
```

### Output

```text

```

### Command

```bash
npx vitest run tests/unit/editor-export-hook.test.ts tests/unit/editor-stage-runtime.test.ts
```

### Output

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

 ✓ tests/unit/editor-stage-runtime.test.ts (14 tests) 1218ms
   ✓ useEditorProjectSync > flushes a pending debounced save on window blur and hidden visibilitychange 1038ms
 ✓ tests/unit/editor-export-hook.test.ts (4 tests) 13ms

 Test Files  2 passed (2)
      Tests  18 passed (18)
   Start at  15:36:02
   Duration  2.34s (transform 134ms, setup 7ms, collect 288ms, tests 1.23s, environment 384ms, prepare 58ms)
```

## Concerns

- The requested broad typecheck command still reports pre-existing unrelated test type issues in `tests/unit/components/art-style-library/ArtStyleEditor.test.tsx` and `tests/unit/editor-stage-runtime.test.ts`. A narrower grep for the changed export files returned no errors.
- The adjacent existing editor runtime test emits React `act(...)` warnings but still passes.


## 修复轮次

### 状态提升与关闭/重开保持

- 将 `useEditorExport` 从 `ExportPanel` 内提升到 `EditorStageShell`，`ExportPanel` 现在只通过 props 接收 `exportRuntime`、禁用原因和关闭回调。
- 因为 `EditorStageShell` 不随导出面板关闭而卸载，`activeTaskId`、SSE 订阅、轮询状态、进度、取消能力和完成下载信息会在关闭/重开面板之间保持。
- `ExportPanel` 本地只保留导出表单 UI 状态（分辨率/FPS/格式/码率），运行中状态由 shell 层 hook 持有。

### 进行中导出恢复

- `useEditorProjectSync` 现在从 `/editor?episodeId=...` 响应保留 `renderStatus`、`renderTaskId`、`renderOutputMediaObjectId`、`renderSettings`，并通过 editor runtime context 暴露给 `EditorStageShell`。
- `useEditorExport` 新增 `initialRenderState`：编辑器加载到 `renderStatus=PROCESSING + renderTaskId` 时，会采纳该 taskId 并立即 `pollStatus(renderTaskId)`，恢复进度/取消能力。
- 读了 render route：POST 409 已通过 `ApiError` flattened raw details 返回 `taskId`，同时也位于 `error.details.taskId`。前端现在会从 409 payload 采纳 active taskId 并恢复轮询，而不是仅进入 failed conflict 状态。

### TrackJSON 修复

- `tests/unit/editor-stage-runtime.test.ts` 的 TrackJSON fixture 补充 `name: 'Main video'`，修复 `TrackJSON` 必填 `name` 的 TS2741。

### 测试 / typecheck

#### Command

```bash
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/editor-export-hook.test.ts tests/unit/editor-stage-runtime.test.ts --reporter=dot
```

#### Output

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
An update to HookHarness inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://react.dev/link/wrap-tests-with-act

 ✓ tests/unit/editor-stage-runtime.test.ts (14 tests) 1217ms
   ✓ useEditorProjectSync > flushes a pending debounced save on window blur and hidden visibilitychange 1036ms
 ✓ tests/unit/editor-export-hook.test.ts (6 tests) 26ms

 Test Files  2 passed (2)
      Tests  20 passed (20)
   Start at  16:17:58
   Duration  2.63s (transform 165ms, setup 11ms, collect 298ms, tests 1.24s, environment 539ms, prepare 117ms)
```

#### Command

```bash
npx tsc --noEmit 2>&1 | grep -iE "editor-stage-runtime.test|TrackJSON|export|Export"
```

#### Output

```text

```

确认：过滤 typecheck 输出为空，`editor-stage-runtime.test` / `TrackJSON` / export 相关错误已消失。

#### Additional full typecheck command

```bash
npx tsc --noEmit
```

#### Output

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

### Concerns

- `tests/unit/editor-stage-runtime.test.ts` 仍有既有 React `act(...)` warning，但目标测试通过。
- 全量 `npx tsc --noEmit` 仍失败于既有无关测试类型问题：`ArtStyleEditor.test.tsx` 缺 `@testing-library/react` / jest-dom matcher 类型，以及 `grid-video-prompt.test.ts` 重复属性。按本轮要求过滤 `editor-stage-runtime.test|TrackJSON|export|Export` 后无输出，确认本轮目标 typecheck 回归已消失。
