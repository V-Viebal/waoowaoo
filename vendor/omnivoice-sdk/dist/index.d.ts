/**
 * OmniVoice Studio TypeScript SDK.
 *
 * ```ts
 * import { OmniVoice } from "@omnivoice/sdk";
 *
 * const ov = new OmniVoice({ baseUrl: "http://127.0.0.1:3900" });
 * await ov.health();
 *
 * const tts = await ov.design.generateSpeech({
 *   text: "Hello from OmniVoice.",
 *   instruct: "warm middle-aged narrator",
 *   numStep: 16,
 * });
 * // tts.audio is a Uint8Array of WAV bytes — write to disk, stream, etc.
 * ```
 */
export { OmniVoice, OmniVoiceError } from "./client.js";
export { DesignAPI } from "./design.js";
export { DubAPI } from "./dub.js";
export type { BlobLike, ClientOptions, CreateProfileInput, DubGenerateRequest, DubSegment, DubUploadResult, GenerateSpeechInput, GenerateSpeechResult, Personality, SseEvent, TranslateRequest, TranslateResult, VoiceProfile, } from "./types.js";
//# sourceMappingURL=index.d.ts.map