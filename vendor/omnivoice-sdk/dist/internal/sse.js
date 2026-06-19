/**
 * Parse a Server-Sent Events stream into an async iterable of typed events.
 *
 * The OmniVoice backend emits one JSON object per `data:` frame (no `event:`
 * line, no `id:`). This parser handles multi-line `data:` (RFC 8.5) for
 * forward-compat, ignores comments, and skips empty / non-JSON frames so a
 * stray ping doesn't break the iterator.
 */
export async function* parseSse(stream) {
    const decoder = new TextDecoder("utf-8");
    const reader = stream.getReader();
    let buffer = "";
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            // SSE separates events with a blank line. Split off complete events.
            let separatorIdx;
            // Accept both LF and CRLF line endings.
            const SEPARATOR_RE = /\r?\n\r?\n/;
            while ((separatorIdx = buffer.search(SEPARATOR_RE)) !== -1) {
                const rawEvent = buffer.slice(0, separatorIdx);
                const match = buffer.slice(separatorIdx).match(SEPARATOR_RE);
                const sepLen = match ? match[0].length : 2;
                buffer = buffer.slice(separatorIdx + sepLen);
                const dataLines = [];
                for (const line of rawEvent.split(/\r?\n/)) {
                    if (!line || line.startsWith(":"))
                        continue; // comment / heartbeat
                    if (line.startsWith("data:")) {
                        // RFC: strip exactly one leading space if present.
                        dataLines.push(line.slice(5).replace(/^ /, ""));
                    }
                    // event:/id:/retry: are not used by the OmniVoice backend.
                }
                if (!dataLines.length)
                    continue;
                const data = dataLines.join("\n").trim();
                if (!data)
                    continue;
                try {
                    yield JSON.parse(data);
                }
                catch {
                    // Backend can't legitimately emit non-JSON, but tolerate it.
                    yield { type: "raw", data };
                }
            }
        }
        // Flush any final pending event without a trailing blank line — edge case
        // where the connection closes mid-frame.
        const trailing = buffer.trim();
        if (trailing.startsWith("data:")) {
            const data = trailing.slice(5).trim();
            try {
                yield JSON.parse(data);
            }
            catch {
                // ignore
            }
        }
    }
    finally {
        try {
            reader.releaseLock();
        }
        catch {
            // already released
        }
    }
}
//# sourceMappingURL=sse.js.map