import type { CreateProfileInput, GenerateSpeechInput, GenerateSpeechResult, Personality, VoiceProfile } from "./types.js";
import type { OmniVoice } from "./client.js";
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
export declare class DesignAPI {
    private readonly client;
    constructor(client: OmniVoice);
    /** GET /personalities — built-in instruct presets (narrator, news_anchor, …). */
    listPersonalities(): Promise<Personality[]>;
    /** GET /profiles — every saved voice (clone + design). */
    listProfiles(): Promise<VoiceProfile[]>;
    /** GET /profiles/{id} — full row, or null when missing. */
    getProfile(profileId: string): Promise<VoiceProfile | null>;
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
    createProfile(input: CreateProfileInput): Promise<{
        id: string;
        name: string;
        kind: "clone" | "design";
    }>;
    /** PUT /profiles/{id} — patch one or more editable fields. */
    updateProfile(profileId: string, patch: Partial<Pick<VoiceProfile, "name" | "instruct" | "language" | "personality" | "ref_text">>): Promise<VoiceProfile>;
    /** DELETE /profiles/{id}. */
    deleteProfile(profileId: string): Promise<void>;
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
    generateSpeech(input: GenerateSpeechInput): Promise<GenerateSpeechResult>;
}
//# sourceMappingURL=design.d.ts.map