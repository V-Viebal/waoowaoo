import type { BlobLike } from "../types.js";
/** Normalize a BlobLike into a `Blob` the platform's FormData accepts. */
export declare function toBlob(input: BlobLike, contentType?: string): Promise<Blob>;
/** Build a multipart/form-data body, omitting null/undefined fields. */
export declare function buildFormData(fields: Record<string, string | number | boolean | null | undefined | {
    blob: BlobLike;
    filename: string;
    contentType?: string;
}>): Promise<FormData>;
/** Read an entire response body into Uint8Array — works in browser, Node, Bun. */
export declare function readBody(res: Response): Promise<Uint8Array>;
/** Strip trailing slash so we can do `${baseUrl}/path` cleanly. */
export declare function normalizeBaseUrl(url: string): string;
/** Parse one numeric header, falling back to NaN-safe defaults. */
export declare function numHeader(res: Response, name: string, fallback?: number): number;
//# sourceMappingURL=http.d.ts.map