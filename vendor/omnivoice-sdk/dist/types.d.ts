/**
 * Public types — mirrors the OmniVoice Studio backend schemas as of v0.3.7.
 *
 * Endpoints documented at http://127.0.0.1:3900/docs (live OpenAPI).
 * Anything marked `// server-extra` is a key the server may add but the
 * SDK doesn't depend on — kept in `[k: string]: unknown` so additions in
 * future versions don't break callers.
 */
/** A built-in personality preset returned by GET /personalities. */
export interface Personality {
    id: string;
    name: string;
    /** The instruct prompt the engine will condition on. */
    instruct: string;
    description?: string;
    icon?: string;
    attrs?: Record<string, string>;
    script?: string;
    /** Path under the backend (prefix with the API URL) when present. */
    preview_url?: string;
    language?: string;
    [k: string]: unknown;
}
/** A persisted voice profile (clone or design) — GET /profiles. */
export interface VoiceProfile {
    id: string;
    name: string;
    /** "clone" — owns a reference recording. "design" — driven by instruct/vd_states. */
    kind: "clone" | "design";
    language: string;
    instruct: string;
    ref_text: string;
    ref_audio_path: string | null;
    personality: string;
    seed: number | null;
    vd_states: string | null;
    is_locked?: 0 | 1 | boolean;
    locked_audio_path?: string | null;
    created_at: number;
    [k: string]: unknown;
}
/** Body of POST /profiles — choose `kind` exactly. */
export type CreateProfileInput = {
    kind: "clone";
    name: string;
    /** Reference audio file: 3-10 sec mono ≥ -15 dBFS works best. */
    refAudio: BlobLike;
    refAudioFilename?: string;
    refText?: string;
    instruct?: string;
    language?: string;
    seed?: number;
    personality?: string;
} | {
    kind: "design";
    name: string;
    /** JSON-serializable design states (gender, age, accent, …). */
    vdStates: Record<string, unknown>;
    instruct?: string;
    refText?: string;
    language?: string;
    seed?: number;
    personality?: string;
};
/** A cross-runtime "blob-ish" payload accepted by the SDK. */
export type BlobLike = Blob | ArrayBuffer | ArrayBufferView | Uint8Array | {
    read: () => Promise<Uint8Array>;
};
/** Input shape for the synthesis call. */
export interface GenerateSpeechInput {
    text: string;
    /** ISO 639 like "en"/"es"/"zh", a full name like "English", or "Auto". */
    language?: string;
    /** Drive the voice from a saved profile. Mutually-useful with `instruct`. */
    profileId?: string;
    /** Drive the voice from a transient reference audio (cloning, no save). */
    refAudio?: BlobLike;
    refAudioFilename?: string;
    refText?: string;
    /** Free-form voice-design prompt (used when no profile/ref). */
    instruct?: string;
    /** 8 = draft · 16 = balanced (default) · 32 = quality. */
    numStep?: number;
    guidanceScale?: number;
    /** 1.0 = native; 0.5–2.0 typical. */
    speed?: number;
    durationSec?: number;
    denoise?: boolean;
    postprocessOutput?: boolean;
    /** Output color preset — default "broadcast". See GET /engines/effects/presets. */
    effectPreset?: string;
    seed?: number;
    /** Override the active TTS backend for this call only. */
    engine?: string;
    /** 0 disables long-text chunking. */
    maxChunkChars?: number;
    crossfadeMs?: number;
}
/** Result of a /generate call — WAV bytes plus headers the server returned. */
export interface GenerateSpeechResult {
    /** Raw 16-bit mono WAV bytes (24 kHz when OmniVoice is the active backend). */
    audio: Uint8Array;
    /** "audio/wav" or whatever the server set. */
    contentType: string;
    audioId: string;
    audioPath: string;
    audioDurationSec: number;
    generationTimeSec: number;
    seed: number | null;
    /** "cpu_fallback" / "accelerated_with_caveat" / null. */
    routingStatus: string | null;
    routingReason: string | null;
}
export interface DubUploadResult {
    job_id: string;
    /** Subscribe to /tasks/stream/{task_id}; wait for the `ready` event. */
    task_id: string;
    filename: string;
}
/** A single transcribed/translated segment — same shape as the backend's DubSegment. */
export interface DubSegment {
    /** Stable id once the segment is in the job ("seg_0", …) — not required for first /dub/generate. */
    id?: string;
    start: number;
    end: number;
    text: string;
    /** Per-segment voice prompt; falls back to the request-level `instruct`. */
    instruct?: string;
    /** Pin this segment to a saved voice profile. */
    profile_id?: string;
    speed?: number;
    gain?: number;
    target_lang?: string;
    direction?: string;
    effect_preset?: string;
}
export interface TranslateRequest {
    segments: Array<{
        id: string;
        text: string;
        target_lang?: string;
        direction?: string;
        slot_seconds?: number;
    }>;
    target_lang: string;
    source_lang?: string;
    /** "google" (default), "openai", "ollama", "nllb". */
    provider?: string;
    job_id?: string;
    /** "fast" (default) | "high". */
    quality?: string;
    glossary?: Array<Record<string, unknown>>;
    dialect?: string;
}
export interface TranslateResult {
    translated: Array<{
        id: string;
        text: string;
        error?: string;
    }>;
    target_lang: string;
    source_lang?: string;
    [k: string]: unknown;
}
export interface DubGenerateRequest {
    segments: DubSegment[];
    language?: string;
    /** ISO 639-1 (e.g. "en"), or "und" if unset. */
    language_code?: string;
    instruct?: string;
    num_step?: number;
    guidance_scale?: number;
    speed?: number;
    segment_ids?: string[];
    /** Set to a list of segment ids to regenerate only those (rest are reused from disk). */
    regen_only?: string[];
    preview?: boolean;
    /** "time_stretch" | "speed_only" | "none" — fits TTS into the source slot. */
    slot_fit?: string;
    /** "concise" (default) | "stretch_video" | "strict_slot" | "smart_fit". */
    timing_strategy?: "concise" | "stretch_video" | "strict_slot" | "smart_fit";
}
/** SSE event the dub pipeline emits. The server uses tagged unions of type. */
export type SseEvent = {
    type: "ready";
    [k: string]: unknown;
} | {
    type: "start";
    duration: number;
    chunks: number;
    chunk_s: number;
    [k: string]: unknown;
} | {
    type: "progress";
    current: number;
    total: number;
    text?: string;
    [k: string]: unknown;
} | {
    type: "segments";
    [k: string]: unknown;
} | {
    type: "warning";
    segment?: number;
    message?: string;
    [k: string]: unknown;
} | {
    type: "error";
    segment?: number;
    error?: string;
    detail?: string;
    [k: string]: unknown;
} | {
    type: "assembling";
} | {
    type: "final";
    [k: string]: unknown;
} | {
    type: "ping";
} | {
    type: "cancelled";
    [k: string]: unknown;
} | {
    type: "done";
    segments_processed?: number;
    tracks?: string[];
    sync_scores?: number[];
    fit_status?: unknown;
    timing_strategy?: string;
    [k: string]: unknown;
} | ({
    type: string;
} & Record<string, unknown>);
export interface ClientOptions {
    /** Backend root, e.g. http://127.0.0.1:3900. Trailing slash is normalized. */
    baseUrl?: string;
    /**
     * Fetch override. Defaults to globalThis.fetch (Node ≥ 18, modern browsers,
     * Bun, Deno). Pass `node-fetch` here on Node ≤ 16.
     */
    fetch?: typeof fetch;
    /** Per-request headers (e.g. Tailscale auth, reverse proxies). */
    headers?: Record<string, string>;
    /** Request timeout in ms. Default: none (long jobs run forever). */
    timeoutMs?: number;
}
//# sourceMappingURL=types.d.ts.map