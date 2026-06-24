# Task 1.5 Report: Editor Stage UI

## Implemented components

- `components/editor/EditorStage.tsx`
  - Wraps the editor UI with `EditorStageRuntimeProvider`.
  - Resolves editor dimensions from workspace `videoRatio`, defaulting to 720×1280.
- `components/editor/EditorStageShell.tsx`
  - Adds the visible editor container and top save-status bar.
- `components/editor/TwickEditor.tsx`
  - Integrates `@twick/video-editor` `VideoEditor` with `LivePlayerProvider > TimelineProvider > VideoEditor`.
  - Imports required CSS: `@twick/video-editor/dist/video-editor.css` and `@twick/timeline/dist/timeline.css`.
  - Injects custom `leftPanel` and `rightPanel` React nodes.
- `components/editor/SaveStatusIndicator.tsx`
  - Shows loading/saving/saved/error/conflict states.
  - Exposes conflict actions: reload and force save.
- `components/editor/left-panel/*`
  - Video, image, voice, and BGM tabs.
  - Video and voice assets come from `useEditorStageRuntime()` (`panelVideos`, `voiceLineSources`).
  - Clicking a video/voice asset appends it to the shared Twick timeline.
- `components/editor/right-panel/RightPanel.tsx`
  - Adds Phase 1 placeholder tabs for AI tools and properties.
  - Reads selected item and track count from `useTimelineContext()`.

## VideoEditor integration

The brief's `TwickStudio` design was intentionally not used. The implementation follows the POC and `twick-api-findings.md`:

```tsx
<LivePlayerProvider>
  <TimelineProvider contextId="..." initialData={projectData} resolution={{ width, height }}>
    <VideoEditor leftPanel={<AssetPanel />} rightPanel={<RightPanel />} editorConfig={...} />
  </TimelineProvider>
</LivePlayerProvider>
```

`VideoEditor` is used as the center editor because it supports custom `leftPanel`/`rightPanel` injection. `TwickStudio` was avoided because its native left/right panels cannot be hidden.

## Timeline ↔ runtime sync

- Runtime `projectData` is passed into `TimelineProvider.initialData`.
- A `TimelineRuntimeSync` component is mounted inside `TimelineProvider`.
- It reads `present` via `useTimelineContext()` and compares serialized project JSON with the last synced snapshot.
- When `present` changes after user/editor operations, it calls `runtime.updateProjectData(present)`.
- `updateProjectData` is provided by Task 1.4 runtime and already performs debounced autosave (1s) plus conflict handling.
- `TimelineProvider` is keyed by `editorProjectId`, `projectVersion`, and dimensions so reload/conflict refreshes remount with fresh server data.

## Stage routing/navigation

- `WorkspaceStageContent.tsx` now renders `EditorStage` when `currentStage === 'editor'` and an episode is selected.
- Capsule navigation (`useWorkspaceStageNavigation.ts`) now enables the editor stage instead of marking it coming soon.
- Legacy `StageNavigation.tsx` also includes an editor item.
- Root valid stage list already contained `editor`, so no change was needed there.

## i18n

Added editor UI copy to:

- `messages/zh/novel-promotion.json`
- `messages/en/novel-promotion.json`

Added legacy stage labels to:

- `messages/zh/stages.json`
- `messages/en/stages.json`

## Typecheck

Command run:

```bash
npx tsc --noEmit 2>&1 | grep -iE "editor/|EditorStage|TwickEditor|WorkspaceStageContent"
```

Result: no matching type errors after fixes.

During verification, existing/new API route type errors in `src/app/api/novel-promotion/[projectId]/editor/route.ts` were surfaced by the targeted grep because the path contains `editor`. They were fixed by narrowing `version`, asserting `projectData`, and casting to `Prisma.InputJsonValue` at Prisma write sites.

## Deviations from brief

- Used `@twick/video-editor` `VideoEditor`, not `@twick/studio` `TwickStudio`, per POC/API warning.
- The left panel is injected directly into `VideoEditor`; the shell does not render a separate external left/right column because `VideoEditor` owns the layout slots.
- Image and BGM asset tabs are Phase 1 placeholders because runtime currently exposes generated videos and voice lines, not standalone image/BGM sources.
- AI tools and property editing are placeholders for Phase 2.

## 修复轮次

### Important 1：冲突后刷新不重载 timeline

- 采用方案 A：在 editor runtime 中新增 `reloadRevision`，`reloadFromServer()` 成功拉取服务端 editor project 后递增。
- `TwickEditor` 的 `TimelineProvider` key 现在包含 `projectReloadRevision`，即使服务端 `version` 与冲突时记录的 `currentVersion` 相同，点击刷新后也会 remount 并重新应用 `initialData`。
- `reloadFromServer()` 会取消 pending debounce、清除 conflict/save error、用 refetch 返回的服务端 `projectData/version/updatedAt` 直接更新本地 runtime state；由于 `TimelineRuntimeSync` remount 时的 `initialSerialized` 来自同一份 server data，初始 present 不会被当成本地编辑立刻回写。
- 新增 `tests/unit/editor-stage-runtime.test.ts` 覆盖相同 version reload 仍替换 `projectData` 并递增 `reloadRevision`。

### Important 2：重复添加素材导致 element id 冲突

- `panelToVideoElement()` 和 `voiceLineToAudioElement()` 现在为每个 timeline element 实例生成唯一 id：`video-${panelId}-${...}` / `audio-${voiceLineId}-${...}`。
- 原始 `panelId` / `voiceLineId` 继续保留在 `metadata` 中，供来源追踪使用。
- `buildInitialProject()` 仍复用 adapter，初始构建也获得唯一 element id。
- 已调整 Task 1.2 adapter 单测断言：不再断言固定 id，改为断言 id 前缀包含源素材 id，并新增重复调用唯一性断言。

### 测试

```bash
npx vitest run tests/unit/lib/twick/ --reporter=dot
```

结果：4 个 test files passed，20 个 tests passed。

```bash
npx vitest run tests/unit/editor-stage-runtime.test.ts --reporter=dot
```

结果：1 个 test file passed，7 个 tests passed。

```bash
npx tsc --noEmit 2>&1 | grep -iE "editor/|asset-adapter|TwickEditor|VideoAssetList|VoiceAssetList"
```

结果：无输出，即目标路径/文件无匹配 type errors。
