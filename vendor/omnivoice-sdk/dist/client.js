import { normalizeBaseUrl } from "./internal/http.js";
import { parseSse } from "./internal/sse.js";
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
export class OmniVoiceError extends Error {
    status;
    statusText;
    body;
    response;
    constructor(message, response, body) {
        super(message);
        this.name = "OmniVoiceError";
        this.status = response.status;
        this.statusText = response.statusText;
        this.body = body;
        this.response = response;
    }
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
export class OmniVoice {
    baseUrl;
    design;
    dub;
    _fetch;
    _headers;
    _timeoutMs;
    constructor(opts = {}) {
        this.baseUrl = normalizeBaseUrl(opts.baseUrl ?? "http://127.0.0.1:3900");
        this._fetch = opts.fetch ?? globalThis.fetch?.bind(globalThis);
        this._headers = { ...(opts.headers ?? {}) };
        this._timeoutMs = opts.timeoutMs;
        if (typeof this._fetch !== "function") {
            throw new Error("globalThis.fetch is missing. Pass `fetch: customFetch` in the constructor or run on Node ≥ 18.");
        }
        this.design = new DesignAPI(this);
        this.dub = new DubAPI(this);
    }
    /** GET /health — quick check the server is up. */
    async health() {
        return this.request("/health");
    }
    /**
     * Low-level request helper. Throws OmniVoiceError on non-2xx.
     *
     * Default response handling: parses JSON when the server says so, otherwise
     * returns the raw `Response` and lets the caller stream it (used by /generate
     * which returns audio/wav, and the SSE endpoints).
     */
    async request(path, init = {}) {
        const { responseType = "json", headers, signal, ...rest } = init;
        const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
        const controller = this._timeoutMs ? new AbortController() : null;
        if (controller) {
            // Chain the user's AbortSignal with our timeout.
            if (signal)
                signal.addEventListener("abort", () => controller.abort(signal.reason));
            setTimeout(() => controller.abort(new Error(`Request timed out after ${this._timeoutMs}ms`)), this._timeoutMs);
        }
        const merged = {
            ...rest,
            headers: { ...this._headers, ...headers },
            signal: controller?.signal ?? signal ?? null,
        };
        // Bun's fetch enforces a 5-minute idle timeout by default — wrong for TTS
        // jobs (cold model loads + first-segment audioseal download routinely run
        // 5-10 min). Disabling here is a runtime-safe no-op on Node/Deno/browsers,
        // which ignore unknown RequestInit keys.
        if (this._timeoutMs === undefined) {
            merged.timeout = false;
        }
        const res = await this._fetch(url, merged);
        if (!res.ok) {
            let body = undefined;
            const ct = res.headers.get("content-type") ?? "";
            try {
                body = ct.includes("application/json") ? await res.json() : await res.text();
            }
            catch {
                body = undefined;
            }
            const detail = (body && typeof body === "object" && "detail" in body && body.detail) ||
                res.statusText ||
                "request failed";
            throw new OmniVoiceError(`${res.status} ${path}: ${String(detail)}`, res, body);
        }
        if (responseType === "raw")
            return res;
        if (res.status === 204)
            return undefined;
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("application/json"))
            return (await res.json());
        // Non-JSON success: hand back the Response so the caller can decide.
        return res;
    }
    /**
     * Subscribe to /tasks/stream/{task_id} and yield each SSE event. The
     * generator returns when the server closes the stream (after `done` /
     * `error` / `cancelled`). Pass an `AbortSignal` to disconnect early.
     */
    async *streamTask(taskId, opts = {}) {
        const qs = opts.afterSeq ? `?after_seq=${opts.afterSeq}` : "";
        const init = {
            headers: { ...this._headers, accept: "text/event-stream" },
            signal: opts.signal,
        };
        // SSE streams are intentionally long-lived; same Bun-timeout caveat.
        init.timeout = false;
        const res = await this._fetch(`${this.baseUrl}/tasks/stream/${encodeURIComponent(taskId)}${qs}`, init);
        if (!res.ok || !res.body) {
            const text = await res.text().catch(() => "");
            throw new OmniVoiceError(`SSE ${taskId}: ${res.status} ${text}`, res, text);
        }
        yield* parseSse(res.body);
    }
    /**
     * Wait for a task to reach a terminal SSE event.
     *
     * Matches the FastAPI dub pipeline's emission contract: `done` ends a
     * successful run, `error` and `cancelled` end an unsuccessful one, and
     * `ready` ends the prep stage (returned for /dub/upload + /dub/ingest-url).
     * Calls `onEvent` for *every* event so progress UIs can hook in cheaply.
     */
    async waitForTask(taskId, opts = {}) {
        const terminal = opts.until ?? ((e) => e.type === "done" || e.type === "error" || e.type === "cancelled" || e.type === "ready");
        let last;
        for await (const evt of this.streamTask(taskId, { afterSeq: opts.afterSeq, signal: opts.signal })) {
            last = evt;
            opts.onEvent?.(evt);
            if (terminal(evt)) {
                if (evt.type === "error") {
                    throw new OmniVoiceError(`Task ${taskId} failed: ${evt.detail ?? evt.error ?? "unknown error"}`, 
                    // synthetic Response so callers that catch on .status don't NPE
                    new Response(null, { status: 500, statusText: "task error" }), evt);
                }
                return evt;
            }
        }
        if (!last)
            throw new Error(`Task ${taskId}: stream closed without any events`);
        return last;
    }
}
//# sourceMappingURL=client.js.map