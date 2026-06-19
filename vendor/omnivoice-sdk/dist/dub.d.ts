import type { BlobLike, DubGenerateRequest, DubSegment, DubUploadResult, SseEvent, TranslateRequest, TranslateResult } from "./types.js";
import type { OmniVoice } from "./client.js";
/**
 * The full video-dubbing pipeline.
 *
 * The backend splits dubbing into a four-step asynchronous pipeline because
 * each stage can take minutes and the UI streams progress per stage:
 *
 *   1. **Upload / ingest URL** → the server unpacks the media, runs Demucs
 *      to separate vocals from music, and emits a `ready` SSE event when the
 *      job is ready to transcribe.
 *   2. **Transcribe** → WhisperX produces timestamped segments and detects the
 *      source language. The /dub/transcribe endpoint streams segments via
 *      `segments` events and ends with `done`.
 *   3. **Translate** → segments → target language (offline NLLB, or online
 *      OpenAI/Ollama/Google when configured). Returns synchronously.
 *   4. **Generate** → diffuses TTS for each segment, mixes back over the
 *      music bed, and emits `done` with the rendered language tracks. The
 *      mixed video/audio is fetched via `download(jobId)`.
 *
 * The high-level `dubVideo()` helper at the bottom of this file walks the
 * whole pipeline; the individual methods let callers compose differently
 * (e.g. dub from a pre-made SRT, regenerate one segment, swap target lang).
 */
export declare class DubAPI {
    private readonly client;
    constructor(client: OmniVoice);
    /**
     * POST /dub/upload — upload a video or audio file.
     *
     * Returns immediately with `{ job_id, task_id }`. Subscribe to the task
     * stream and wait for the `ready` event before transcribing.
     */
    upload(input: {
        media: BlobLike;
        filename: string;
        /** "video" (default) or "audio". Audio jobs skip scene detect + mux. */
        inputType?: "video" | "audio";
        /** Reuse an existing job_id (e.g. resume a partial job). */
        jobId?: string;
    }): Promise<DubUploadResult>;
    /** POST /dub/ingest-url — yt-dlp pulls the media; same return shape as upload(). */
    ingestUrl(input: {
        url: string;
        jobId?: string;
        inputType?: "video" | "audio";
    }): Promise<DubUploadResult>;
    /**
     * POST /dub/transcribe/{job_id} — fire-and-forget; returns `{ task_id }`.
     * Subscribe to the task stream and collect `segments` events.
     */
    startTranscribe(jobId: string): Promise<{
        task_id: string;
    }>;
    /**
     * Helper: run transcribe end-to-end and return all detected segments.
     *
     * Walks the SSE stream until `done`. Pass `onEvent` to surface progress
     * to a UI without inspecting `SseEvent` shapes yourself.
     */
    transcribe(jobId: string, opts?: {
        onEvent?: (e: SseEvent) => void;
        signal?: AbortSignal;
    }): Promise<{
        segments: DubSegment[];
        sourceLang?: string;
        raw: SseEvent[];
    }>;
    /** POST /dub/translate — synchronous; uses the configured provider. */
    translate(req: TranslateRequest): Promise<TranslateResult>;
    /** POST /dub/generate/{job_id} — fire the TTS run. Returns `{ task_id }`. */
    startGenerate(jobId: string, req: DubGenerateRequest): Promise<{
        task_id: string;
    }>;
    /** Run /dub/generate end-to-end and return the final `done` event. */
    generate(jobId: string, req: DubGenerateRequest, opts?: {
        onEvent?: (e: SseEvent) => void;
        signal?: AbortSignal;
    }): Promise<SseEvent>;
    /**
     * GET /dub/download/{job_id} — fetch the muxed output (video by default,
     * audio-only when no video track is present).
     *
     * Pass `lang` to pick a specific target track when the job has multiple.
     */
    download(jobId: string, opts?: {
        lang?: string;
        preserveBg?: boolean;
    }): Promise<{
        filename: string;
        bytes: Uint8Array;
        contentType: string;
    }>;
    /** GET /dub/download-audio/{job_id}. */
    downloadAudio(jobId: string, opts?: {
        lang?: string;
        preserveBg?: boolean;
    }): Promise<{
        filename: string;
        bytes: Uint8Array;
        contentType: string;
    }>;
    /** GET /dub/tracks/{job_id} — list rendered language tracks for a job. */
    listTracks(jobId: string): Promise<unknown>;
    /** POST /dub/abort/{job_id} — cancel any running tasks for this job. */
    abort(jobId: string): Promise<{
        aborted: boolean;
        had_active_procs: boolean;
    }>;
    /**
     * Run the full pipeline: upload → wait for ready → transcribe → translate
     * → generate. Returns the final job id and the final SSE `done` event so
     * the caller can pull the file via {@link download}.
     *
     * `onStage` fires once per pipeline phase; `onEvent` fires for every SSE
     * frame. Either is enough for a progress bar.
     */
    dubVideo(input: {
        media: BlobLike;
        filename: string;
        /** Source language hint — omit to auto-detect via WhisperX. */
        sourceLang?: string;
        /** Target language full name, e.g. "Spanish" or "English". */
        targetLang: string;
        /** Translation provider override; defaults to backend's configured one. */
        translateProvider?: string;
        /** Voice profile to apply to every segment. Mutually-exclusive-ish with `instruct`. */
        profileId?: string;
        /** Instruct prompt applied per segment when no profile id is set. */
        instruct?: string;
        /** TTS quality: 8 = draft, 16 = balanced (default), 32 = quality. */
        numStep?: number;
        /** Slot-fitting strategy. "concise" (default) | "stretch_video" | "strict_slot" | "smart_fit". */
        timingStrategy?: DubGenerateRequest["timing_strategy"];
        inputType?: "video" | "audio";
        onStage?: (stage: "uploading" | "ready" | "transcribing" | "translating" | "generating" | "done") => void;
        onEvent?: (e: SseEvent) => void;
        signal?: AbortSignal;
    }): Promise<{
        jobId: string;
        done: SseEvent;
    }>;
}
//# sourceMappingURL=dub.d.ts.map