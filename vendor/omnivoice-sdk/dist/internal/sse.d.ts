import type { SseEvent } from "../types.js";
/**
 * Parse a Server-Sent Events stream into an async iterable of typed events.
 *
 * The OmniVoice backend emits one JSON object per `data:` frame (no `event:`
 * line, no `id:`). This parser handles multi-line `data:` (RFC 8.5) for
 * forward-compat, ignores comments, and skips empty / non-JSON frames so a
 * stray ping doesn't break the iterator.
 */
export declare function parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent>;
//# sourceMappingURL=sse.d.ts.map