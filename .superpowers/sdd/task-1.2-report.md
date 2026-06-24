# Task 1.2 Report: Twick Adapter Layer

## Implemented files and functions

- `src/lib/twick/types.ts`
  - Defines business input types: `PanelVideoSource`, `VoiceLineSource`, `MediaObjRef`.
  - Re-exports/minimally aliases Twick SDK types: `TwickTimelineProject`, `TwickTrack`, `TwickTimelineElement` from `@twick/timeline` `ProjectJSON` / `TrackJSON` / `ElementJSON`.
  - Adds narrowed media/caption element helper types for adapter outputs.

- `src/lib/twick/media-url-resolver.ts`
  - `isMediaObjRef(src)`
  - `toMediaObjRef(mediaObjectId)`
  - `extractMediaObjectId(ref)`
  - `resolveMediaUrl(ref)`
  - `resolveMediaUrls(refs)`

- `src/lib/twick/asset-adapter.ts`
  - `panelToVideoElement(panel, startSec)`
  - `voiceLineToAudioElement(voiceLine, startSec)`
  - `voiceLineToCaptionElement(voiceLine, startSec)`

- `src/lib/twick/project-builder.ts`
  - `buildInitialProject(panels, voiceLines, options)`

- `src/lib/twick/ai-patch-adapter.ts`
  - Minimal Phase-2 placeholder: `TwickAiPatch`, `applyTwickAiPatch(project, patch)`.

## Real Twick data structure used

Confirmed from `node_modules/@twick/timeline/dist/src/types.d.ts` and constants:

- Project root is `ProjectJSON` with `tracks`, `version`, optional `backgroundColor`, `metadata`, `assets`, `watermark`.
- There is no top-level `width`, `height`, `fps`, or `duration` in `ProjectJSON`; builder stores those adapter-level values under `metadata.custom`.
- Elements use `s` and `e` for timeline start/end seconds.
- Media URL is stored in `element.props.src`.
- Audio volume is stored in `element.props.volume`.
- Media trim/start offset is represented as `element.props.time`.
- Transition shape is top-level `transition?: { toElementId, duration, kind }`.
- Captions use Twick `caption` type; generated caption text is stored in top-level `t` with styling in `props`.

## Media URL resolution decision

Reused existing media service behavior instead of constructing MinIO URLs directly:

- `src/lib/media/service.ts#getMediaObjectById(id)` maps real `MediaObject` rows with `publicId` and `storageKey` into a `MediaRef`.
- `MediaRef.url` is the existing playable media route `/m/<publicId>` produced by the service.
- `resolveMediaUrl('mediaobj://<id>')` resolves by `getMediaObjectById(id)` and returns `mediaObject.url`.
- External/non-`mediaobj://` URLs are returned unchanged.

This avoids relying on the incorrect brief fields (`bucket`/`path`) and matches the actual `MediaObject` fields (`publicId`/`storageKey`).

## Tests

Added tests:

- `tests/unit/lib/twick/media-url-resolver.test.ts`
- `tests/unit/lib/twick/asset-adapter.test.ts`
- `tests/unit/lib/twick/project-builder.test.ts`
- `tests/unit/lib/twick/ai-patch-adapter.test.ts`

TDD notes:

- Initial RED run failed because the target modules did not exist.
- Additional caption structure test was changed to match Twick constants (`caption` + `t`) and failed before updating implementation.

Command run:

```bash
npx vitest run tests/unit/lib/twick/ --reporter=dot
```

Final result:

```text
Test Files  4 passed (4)
Tests  18 passed (18)
```

Also ran:

```bash
npm run typecheck
```

It failed on pre-existing/unrelated test type issues in:

- `tests/unit/components/art-style-library/ArtStyleEditor.test.tsx` missing `@testing-library/react` / jest-dom matcher types.
- `tests/unit/storyboard-images/grid-video-prompt.test.ts` duplicate object literal properties.

No Twick adapter type errors were reported before those existing errors.

## Deviations from brief and reasons

- Did not implement the brief's assumed `{ width, height, fps, duration }` Project root because Twick `ProjectJSON` does not support those top-level fields.
- Did not use `start` / `duration` / top-level `src` / top-level `volume`; real Twick elements require `s` / `e` / `props.src` / `props.volume`.
- Did not call a guessed `getSignedUrl(bucket, path)` because real `MediaObject` rows use `publicId` and `storageKey`; existing service already provides playable `/m/<publicId>` URLs.
- Caption output uses Twick `caption` element/track type and top-level `t`, not a custom `caption`/`text` style object from the brief.
