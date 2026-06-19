/**
 * Cross-runtime helpers — Node ≥ 18, browsers, Bun, and Deno all expose
 * `Blob`, `FormData`, and `fetch` natively. The SDK only relies on those
 * three globals plus the standard `ReadableStream`/`TextDecoder`.
 */
const _Blob = globalThis.Blob ?? (() => {
    throw new Error("globalThis.Blob is missing. Polyfill it (e.g. `import { Blob } from 'node:buffer'`) or run on Node ≥ 18.");
})();
const _FormData = globalThis.FormData ?? (() => {
    throw new Error("globalThis.FormData is missing — the SDK targets Node ≥ 18, modern browsers, Bun, and Deno.");
})();
/** Normalize a BlobLike into a `Blob` the platform's FormData accepts. */
export async function toBlob(input, contentType = "application/octet-stream") {
    if (input instanceof _Blob)
        return input;
    // Cast through `BlobPart` — TS sees `Uint8Array<ArrayBufferLike>` which
    // includes SharedArrayBuffer; the runtime accepts both. Buffer/ArrayBuffer
    // are fine too. The intermediate Uint8Array copy is for ArrayBufferView,
    // since slicing a non-contiguous view through Blob() needs the byte range.
    if (input instanceof Uint8Array)
        return new _Blob([input], { type: contentType });
    if (input instanceof ArrayBuffer)
        return new _Blob([input], { type: contentType });
    if (ArrayBuffer.isView(input)) {
        const view = input;
        const copy = new Uint8Array(view.byteLength);
        copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
        return new _Blob([copy], { type: contentType });
    }
    if (typeof input.read === "function") {
        const bytes = await input.read();
        return new _Blob([bytes], { type: contentType });
    }
    throw new TypeError("Unsupported audio input. Pass Blob, Uint8Array, ArrayBuffer, ArrayBufferView, or { read: () => Promise<Uint8Array> }.");
}
/** Build a multipart/form-data body, omitting null/undefined fields. */
export async function buildFormData(fields) {
    const fd = new _FormData();
    for (const [key, value] of Object.entries(fields)) {
        if (value === null || value === undefined)
            continue;
        if (typeof value === "object" && value !== null && "blob" in value) {
            const blob = await toBlob(value.blob, value.contentType ?? "application/octet-stream");
            fd.append(key, blob, value.filename);
        }
        else {
            fd.append(key, String(value));
        }
    }
    return fd;
}
/** Read an entire response body into Uint8Array — works in browser, Node, Bun. */
export async function readBody(res) {
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
}
/** Strip trailing slash so we can do `${baseUrl}/path` cleanly. */
export function normalizeBaseUrl(url) {
    return url.replace(/\/+$/, "");
}
/** Parse one numeric header, falling back to NaN-safe defaults. */
export function numHeader(res, name, fallback = 0) {
    const v = res.headers.get(name);
    if (!v)
        return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}
//# sourceMappingURL=http.js.map