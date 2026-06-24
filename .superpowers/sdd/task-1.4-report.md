# Task 1.4 Report: Editor Stage Runtime Core

## 状态
DONE

## 实现文件
- `src/lib/novel-promotion/stages/editor-stage-runtime/types.ts`
- `src/lib/novel-promotion/stages/editor-stage-runtime/useEditorStageDataLoader.ts`
- `src/lib/novel-promotion/stages/editor-stage-runtime/useEditorProjectSync.ts`
- `src/lib/novel-promotion/stages/editor-stage-runtime-core.tsx`
- `tests/unit/editor-stage-runtime.test.ts`

## 真实 hook/API/字段适配
- `useStoryboards` 真实签名：`useStoryboards(episodeId: string | null)`。
  - 返回 `StoryboardData`，结构为 `{ groups: StoryboardGroup[] }`。
  - panel 字段使用：`panel.id`、`panel.videoMedia?.id`、`panel.videoMedia?.durationMs`、`panel.motionPrompt`、`panel.voiceText`。
  - 没有 brief 中的 `storyboard.panels` / `videoMediaObjectId` 字段；实际按 `groups[].panels[]` 和 `videoMedia.id` 映射到 Twick `videoMediaObjectId`。
- `useVoiceLines` 真实签名是 `useVoiceLines(episodeId: string | null)`，但它调用的 `/api/novel-promotion/episodes/${episodeId}/voice-lines` 当前不存在；因此 editor runtime 改用现有可用的 `useMatchedVoiceLines(projectId, episodeId)`。
  - 返回类型声明为 `{ voiceLines: MatchedVoiceLine[] }`，真实 API 会通过 `withVoiceLineMedia` 附带 `audioMedia/media`。
  - 映射字段使用：`line.id`、`line.content`、`line.speaker`、`line.audioDuration`、`line.audioMedia?.id || line.media?.id`。
  - 只把有 media object id 的配音行映射为 Twick `VoiceLineSource`，避免用普通 URL 冒充 `mediaobj://`。
- `buildInitialProject` 真实签名：`buildInitialProject(panels: PanelVideoSource[], voiceLines: VoiceLineSource[], options: BuildProjectOptions)`，返回 `TwickTimelineProject`；options 使用 `width/height/includeAudio/includeCaptions`。
- editor API 真实格式：
  - `GET /api/novel-promotion/[projectId]/editor?episodeId=...` 返回 `{ data: editorProject | null }`。
  - `PUT` body 为 `{ episodeId, projectData, version }`，成功返回 `{ data: editorProject }`。
  - 冲突由 `ApiError('CONFLICT', { currentVersion })` 返回 409。

## React Query 模式
- 项目使用 `@tanstack/react-query` v5 (`^5.90.20`)。
- 没有使用 brief 里的 `useQuery.onSuccess`；改为 `useEffect` 监听 `editorProjectQuery.data/error/isLoading` 完成本地 project 初始化。
- mutation 仍使用 v5 支持的 `onMutate/onSuccess/onError`。

## 自动保存/乐观锁
- `updateProjectData` 更新本地 Twick project 后调度 1s debounce 自动保存。
- `saveNow` 会取消 pending debounce 并立即保存当前本地 project。
- 初次无 editorProject 且已有视频素材时，调用 `buildInitialProject(...)` 构建初始 Twick project 并立即保存，初始 version 为 0；服务端创建后返回 version 1。
- 成功保存后用服务端返回 version 更新本地版本，并记录 `lastSavedAt`。
- 409 冲突时状态置为 `conflict`，保存 `currentVersion`，暂停后续自动保存；`reloadProject` 重新加载服务端数据，`forceSave` 使用当前服务端版本再次提交本地数据覆盖。

## 测试
- Command: `npx vitest run /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/unit/editor-stage-runtime.test.ts --reporter=dot`
- Output: `1 passed (1), 3 tests passed (3)`；仅有 Vite CJS Node API deprecation warning。
- 覆盖：storyboard -> `PanelVideoSource[]` 映射、matched voice line -> `VoiceLineSource[]` 映射、debounce helper 行为。
- 未测：完整 React hook 与真实 API 自动保存流程。原因：需要 React Query Provider、登录态 API、服务端数据库状态，偏集成/端到端；本任务按要求先抽纯函数覆盖核心可测逻辑。

## Typecheck
- Command: `npx tsc --noEmit 2>&1 | grep -i "editor-stage-runtime"`
- Output: no output，表示新增 editor-stage-runtime 相关文件无类型错误（项目可能仍有其他无关类型错误，按任务要求只过滤本模块）。

## 与 brief 偏差
- Provider 按现有 runtime 风格提供 `useEditorStageRuntime` + `EditorStageRuntimeProvider`，并额外暴露 `isFetchingData/dataError/hasVideoPanels/editorProjectId/saveError/reloadAssets` 以便 Phase 1.5 UI 使用。
- 数据加载没有使用 brief 中错误推测的 `useStoryboards(projectId, episodeId)` 与 `useVoiceLines(projectId, episodeId)`；改为真实 `useStoryboards(episodeId)` 和 `useMatchedVoiceLines(projectId, episodeId)`。
- `forceSave` 未发送 `version: -1`，因为真实 API 校验 version 必须为非负整数；冲突后使用服务端 `currentVersion` 重提本地 project 实现覆盖。


## 修复轮次

### 状态
DONE

### 修复内容
- 初始化竞态/缺音频轨：`useEditorStageDataLoader` 现在额外返回 `isLoaded`，`editor-stage-runtime-core.tsx` 将其作为 `isAssetDataLoaded` 传入 `useEditorProjectSync`。`useEditorProjectSync` 只有在 editor project 查询完成且 storyboards + matched voice lines 均加载完成后才会初始化；因此 voiceLines 仍在加载时不会用空 `voiceLineSources` 调 `buildInitialProject`，能区分「voice 为空」与「voice 尚未加载完」。
- 失焦/隐藏/卸载保存：`createDebouncedAction` 增加 `flush()`/`hasPending()`，hook 内监听 `window.blur`、`document.visibilitychange(hidden)`、`window.pagehide`，有 pending debounce 时立即 flush 保存。cleanup 也会尝试 flush pending save，而不是静默 cancel；并通过 pending/in-flight refs 避免重复保存和保存中重入。
- 空素材 loading：当 editor project 不存在、素材加载完成且 `panelVideos.length === 0` 时，设置 `status='idle'`、`projectData=null`，并标记当前 key 已初始化，避免 UI 永久 loading。

### 测试
Command: `npx vitest run tests/unit/editor-stage-runtime.test.ts --reporter=dot`

Output:
```text
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

 RUN  v2.1.9 /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor

 ✓ tests/unit/editor-stage-runtime.test.ts (6 tests) 1133ms
   ✓ useEditorProjectSync > flushes a pending debounced save on window blur and hidden visibilitychange 1062ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  12:09:33
   Duration  5.21s (transform 762ms, setup 64ms, collect 1.11s, tests 1.13s, environment 1.19s, prepare 204ms)
```

覆盖：保留原 3 个映射/debounce 测试；新增 hook 级测试覆盖 voiceLines 晚加载竞态、blur/visibilitychange flush、空视频素材进入 idle。

### Typecheck
Command: `npx tsc --noEmit 2>&1 | grep -i "editor-stage-runtime"`

Output: no output（未发现 editor-stage-runtime 相关类型错误）。

### 依赖/范例确认
- 已 grep：项目当前没有 `@testing-library/react` 依赖，`npm ls @testing-library/react --depth=0` 输出 empty；因此没有使用 `renderHook`，改用 React 19 `createRoot` + `act` 自建 hook harness 做 hook 级测试。
- 已 grep：未发现现成 `visibilitychange`/`pagehide` 封装可复用。
