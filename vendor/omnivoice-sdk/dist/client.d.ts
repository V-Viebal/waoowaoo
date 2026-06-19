import type { ClientOptions, SseEvent } from "./types.js";
import { DesignAPI } from "./design.js";
import { DubAPI } from "./dub.js";
/**
 * Error thrown by every SDK call when the backend returns a non-2xx response.
 *
 * `body` is the parsed JSON `{ "detail": "..." }` FastAPI emits on validation
 * + business errors; for binary endpoints it's the decoded UTF-8 body. The
 * raw `Response` is exposed for callers that need headers (rate-limit signals,
 * routing notices, etc.).
 */
export declare class OmniVoiceError extends Error {
    readonly status: number;
    readonly statusText: string;
    readonly body: unknown;
    readonly response: Response;
    constructor(message: string, response: Response, body: unknown);
}
/**
 * The OmniVoice Studio SDK client.
 *
 * Boot the backend first (`scripts/run.sh` or `scripts/start-backend.sh`);
 * then either:
 *
 * ```ts
 * const ov = new OmniVoice();                           // localhost:3900
 * const ov = new OmniVoice({ baseUrl: "http://my-host:3900" });
 * await ov.health();                                    // sanity check
 * ```
 *
 * The two main surfaces are `client.design` (voice design + cloning + TTS)
 * and `client.dub` (the video → transcribe → translate → re-voice pipeline).
 * Low-level helpers below (`request`, `streamTask`) cover anything the
 * higher-level wrappers don't.
 */
export declare class OmniVoice {
    readonly baseUrl: string;
    readonly design: DesignAPI;
    readonly dub: DubAPI;
    private readonly _fetch;
    private readonly _headers;
    private readonly _timeoutMs?;
    constructor(opts?: ClientOptions);
    /** GET /health — quick check the server is up. */
    health(): Promise<{
        status: string;
        device: string;
        version: string;
    }>;
    /**
     * Low-level request helper. Throws OmniVoiceError on non-2xx.
     *
     * Default response handling: parses JSON when the server says so, otherwise
     * returns the raw `Response` and lets the caller stream it (used by /generate
     * which returns audio/wav, and the SSE endpoints).
     */
    request<T = unknown>(path: string, init?: RequestInit & {
        responseType?: "json" | "raw";
    }): Promise<T>;
    /**
     * Subscribe to /tasks/stream/{task_id} and yield each SSE event. The
     * generator returns when the server closes the stream (after `done` /
     * `error` / `cancelled`). Pass an `AbortSignal` to disconnect early.
     */
    streamTask(taskId: string, opts?: {
        afterSeq?: number;
        signal?: AbortSignal;
    }): AsyncGenerator<SseEvent>;
    /**
     * Wait for a task to reach a terminal SSE event.
     *
     * Matches the FastAPI dub pipeline's emission contract: `done` ends a
     * successful run, `error` and `cancelled` end an unsuccessful one, and
     * `ready` ends the prep stage (returned for /dub/upload + /dub/ingest-url).
     * Calls `onEvent` for *every* event so progress UIs can hook in cheaply.
     */
    waitForTask(taskId: string, opts?: {
        until?: (e: SseEvent) => boolean;
        onEvent?: (e: SseEvent) => void;
        signal?: AbortSignal;
        afterSeq?: number;
    }): Promise<SseEvent>;
}
//# sourceMappingURL=client.d.ts.map