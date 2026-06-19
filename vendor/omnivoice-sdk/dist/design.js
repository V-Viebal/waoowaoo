import { buildFormData, numHeader, readBody } from "./internal/http.js";
/**
 * Voice design + cloning + TTS surface.
 *
 * Three primitives covering the studio side of OmniVoice:
 *   1. List built-in personalities (presets the UI calls "personalities").
 *   2. Create a voice profile (clone from audio, or design from `vd_states`).
 *   3. Synthesize speech — directly with an instruct, or via a saved profile.
 *
 * Profiles persist in SQLite at `omnivoice_data/`; once created they're
 * addressable by `id` from any process pointing at the same backend.
 */
export class DesignAPI {
    client;
    constructor(client) {
        this.client = client;
    }
    /** GET /personalities — built-in instruct presets (narrator, news_anchor, …). */
    async listPersonalities() {
        return this.client.request("/personalities");
    }
    /** GET /profiles — every saved voice (clone + design). */
    async listProfiles() {
        return this.client.request("/profiles");
    }
    /** GET /profiles/{id} — full row, or null when missing. */
    async getProfile(profileId) {
        try {
            return await this.client.request(`/profiles/${encodeURIComponent(profileId)}`);
        }
        catch (err) {
            if (err && typeof err === "object" && "status" in err && err.status === 404) {
                return null;
            }
            throw err;
        }
    }
    /**
     * POST /profiles — create a saved voice.
     *
     * Two flavours:
     *   - **clone**: provide a `refAudio` clip (3-10 s mono ≥ -15 dBFS works
     *     best). The model uses it as a speaker embedding for any future
     *     synthesis through this profile id.
     *   - **design**: provide `vdStates` (a JSON object with the user's
     *     gender / age / accent / dialect picks). The backend renders a
     *     deterministic identity sample with seed 42 and stores it as the
     *     profile's reference, so the voice is stable across runs.
     *
     * Both return `{ id, name, kind }`. The id is what you pass to
     * `generateSpeech({ profileId })` later.
     */
    async createProfile(input) {
        const fields = {
            name: input.name,
            ref_text: input.refText ?? "",
            instruct: input.instruct ?? "",
            language: input.language ?? "Auto",
            seed: input.seed,
            personality: input.personality ?? "",
            kind: input.kind,
        };
        if (input.kind === "clone") {
            fields.ref_audio = {
                blob: input.refAudio,
                filename: input.refAudioFilename ?? "ref.wav",
                contentType: "audio/wav",
            };
        }
        else {
            fields.vd_states = JSON.stringify(input.vdStates ?? {});
        }
        const body = await buildFormData(fields);
        return this.client.request("/profiles", {
            method: "POST",
            body,
        });
    }
    /** PUT /profiles/{id} — patch one or more editable fields. */
    async updateProfile(profileId, patch) {
        return this.client.request(`/profiles/${encodeURIComponent(profileId)}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(patch),
        });
    }
    /** DELETE /profiles/{id}. */
    async deleteProfile(profileId) {
        await this.client.request(`/profiles/${encodeURIComponent(profileId)}`, { method: "DELETE" });
    }
    /**
     * POST /generate — synthesize one chunk of speech.
     *
     * Returns the raw WAV bytes plus the response headers OmniVoice attaches:
     * `audio_id`, `seed`, `audio_duration_sec`, `generation_time_sec`, and
     * routing notices (e.g. "cpu_fallback") set when the host lacks the
     * accelerator the engine prefers.
     *
     * Three calling modes:
     *   - `{ text, profileId }` — drive from a saved profile (clone or design).
     *   - `{ text, refAudio, refText? }` — one-shot clone without saving.
     *   - `{ text, instruct }` — voice design from a free-form prompt.
     *
     * Long input is chunked at sentence boundaries and crossfaded (`maxChunkChars`,
     * default 800; pass 0 to disable).
     */
    async generateSpeech(input) {
        const fields = {
            text: input.text,
            language: input.language,
            ref_text: input.refText,
            instruct: input.instruct,
            duration: input.durationSec,
            num_step: input.numStep,
            guidance_scale: input.guidanceScale,
            speed: input.speed,
            denoise: input.denoise,
            postprocess_output: input.postprocessOutput,
            profile_id: input.profileId,
            seed: input.seed,
            effect_preset: input.effectPreset,
            engine: input.engine,
            max_chunk_chars: input.maxChunkChars,
            crossfade_ms: input.crossfadeMs,
        };
        if (input.refAudio) {
            fields.ref_audio = {
                blob: input.refAudio,
                filename: input.refAudioFilename ?? "ref.wav",
                contentType: "audio/wav",
            };
        }
        const body = await buildFormData(fields);
        // /generate streams audio/wav — request raw and read the bytes ourselves
        // so we can also pull the X-* headers the server sets.
        const res = await this.client.request("/generate", {
            method: "POST",
            body,
            responseType: "raw",
        });
        const audio = await readBody(res);
        const seedHeader = res.headers.get("X-Seed");
        return {
            audio,
            contentType: res.headers.get("content-type") ?? "audio/wav",
            audioId: res.headers.get("X-Audio-Id") ?? "",
            audioPath: res.headers.get("X-Audio-Path") ?? "",
            audioDurationSec: numHeader(res, "X-Audio-Duration", 0),
            generationTimeSec: numHeader(res, "X-Gen-Time", 0),
            seed: seedHeader ? Number(seedHeader) || null : null,
            routingStatus: res.headers.get("X-OmniVoice-Routing"),
            routingReason: res.headers.get("X-OmniVoice-Routing-Reason"),
        };
    }
}
//# sourceMappingURL=design.js.map