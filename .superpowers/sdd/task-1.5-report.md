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
