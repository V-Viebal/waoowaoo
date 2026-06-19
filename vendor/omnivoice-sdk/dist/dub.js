import { buildFormData, readBody } from "./internal/http.js";
/**
 * The full video-dubbing pipeline.
 *
 * The backend splits dubbing into a four-step asynchronous pipeline because
 * each stage can take minutes and the UI streams progress per stage:
 *
 *   1. **Upload / ingest URL** → the server unpacks the media, runs Demucs
 *      to separate vocals from music, and emits a `ready` SSE event when the
 *      job is ready to transcribe.
 *   2. **Transcribe** → WhisperX produces timestamped segments and detects the
 *      source language. The /dub/transcribe endpoint streams segments via
 *      `segments` events and ends with `done`.
 *   3. **Translate** → segments → target language (offline NLLB, or online
 *      OpenAI/Ollama/Google when configured). Returns synchronously.
 *   4. **Generate** → diffuses TTS for each segment, mixes back over the
 *      music bed, and emits `done` with the rendered language tracks. The
 *      mixed video/audio is fetched via `download(jobId)`.
 *
 * The high-level `dubVideo()` helper at the bottom of this file walks the
 * whole pipeline; the individual methods let callers compose differently
 * (e.g. dub from a pre-made SRT, regenerate one segment, swap target lang).
 */
export class DubAPI {
    client;
    constructor(client) {
        this.client = client;
    }
    // ── Step 1: ingest ────────────────────────────────────────────────────
    /**
     * POST /dub/upload — upload a video or audio file.
     *
     * Returns immediately with `{ job_id, task_id }`. Subscribe to the task
     * stream and wait for the `ready` event before transcribing.
     */
    async upload(input) {
        const body = await buildFormData({
            video: { blob: input.media, filename: input.filename, contentType: "application/octet-stream" },
            job_id: input.jobId,
            input_type: input.inputType ?? "video",
        });
        return this.client.request("/dub/upload", { method: "POST", body });
    }
    /** POST /dub/ingest-url — yt-dlp pulls the media; same return shape as upload(). */
    async ingestUrl(input) {
        return this.client.request("/dub/ingest-url", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: input.url, job_id: input.jobId, input_type: input.inputType ?? "video" }),
        });
    }
    // ── Step 2: transcribe ───────────────────────────────────────────────
    /**
     * POST /dub/transcribe/{job_id} — fire-and-forget; returns `{ task_id }`.
     * Subscribe to the task stream and collect `segments` events.
     */
    async startTranscribe(jobId) {
        return this.client.request(`/dub/transcribe/${encodeURIComponent(jobId)}`, { method: "POST" });
    }
    /**
     * Helper: run transcribe end-to-end and return all detected segments.
     *
     * Walks the SSE stream until `done`. Pass `onEvent` to surface progress
     * to a UI without inspecting `SseEvent` shapes yourself.
     */
    async transcribe(jobId, opts = {}) {
        const { task_id } = await this.startTranscribe(jobId);
        const events = [];
        let segments = [];
        let sourceLang;
        for await (const evt of this.client.streamTask(task_id, { signal: opts.signal })) {
            events.push(evt);
            opts.onEvent?.(evt);
            if (evt.type === "segments") {
                const evtSegs = evt.segments;
                if (Array.isArray(evtSegs))
                    segments = evtSegs;
                const lang = evt.language;
                if (lang)
                    sourceLang = lang;
            }
            else if (evt.type === "error") {
                throw Object.assign(new Error(`transcribe failed: ${evt.detail ?? evt.error ?? "unknown"}`), { event: evt });
            }
            else if (evt.type === "done") {
                break;
            }
        }
        return { segments, sourceLang, raw: events };
    }
    // ── Step 3: translate ────────────────────────────────────────────────
    /** POST /dub/translate — synchronous; uses the configured provider. */
    async translate(req) {
        return this.client.request("/dub/translate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(req),
        });
    }
    // ── Step 4: generate (TTS + mix) ─────────────────────────────────────
    /** POST /dub/generate/{job_id} — fire the TTS run. Returns `{ task_id }`. */
    async startGenerate(jobId, req) {
        return this.client.request(`/dub/generate/${encodeURIComponent(jobId)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(req),
        });
    }
    /** Run /dub/generate end-to-end and return the final `done` event. */
    async generate(jobId, req, opts = {}) {
        const { task_id } = await this.startGenerate(jobId, req);
        return this.client.waitForTask(task_id, {
            until: (e) => e.type === "done" || e.type === "error" || e.type === "cancelled",
            onEvent: opts.onEvent,
            signal: opts.signal,
        });
    }
    // ── Step 5: download ─────────────────────────────────────────────────
    /**
     * GET /dub/download/{job_id} — fetch the muxed output (video by default,
     * audio-only when no video track is present).
     *
     * Pass `lang` to pick a specific target track when the job has multiple.
     */
    async download(jobId, opts = {}) {
        const qs = new URLSearchParams();
        if (opts.lang)
            qs.set("lang", opts.lang);
        if (opts.preserveBg !== undefined)
            qs.set("preserve_bg", String(opts.preserveBg));
        const url = `/dub/download/${encodeURIComponent(jobId)}${qs.size ? `?${qs.toString()}` : ""}`;
        const res = await this.client.request(url, { responseType: "raw" });
        const cd = res.headers.get("content-disposition") ?? "";
        // FastAPI's FileResponse uses RFC 6266 filename* or filename=
        const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
        const filename = match ? decodeURIComponent(match[1]) : `${jobId}.mp4`;
        return {
            filename,
            bytes: await readBody(res),
            contentType: res.headers.get("content-type") ?? "application/octet-stream",
        };
    }
    /** GET /dub/download-audio/{job_id}. */
    async downloadAudio(jobId, opts = {}) {
        const qs = new URLSearchParams();
        if (opts.lang)
            qs.set("lang", opts.lang);
        if (opts.preserveBg !== undefined)
            qs.set("preserve_bg", String(opts.preserveBg));
        const url = `/dub/download-audio/${encodeURIComponent(jobId)}${qs.size ? `?${qs.toString()}` : ""}`;
        const res = await this.client.request(url, { responseType: "raw" });
        const cd = res.headers.get("content-disposition") ?? "";
        const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
        const filename = match ? decodeURIComponent(match[1]) : `${jobId}.wav`;
        return {
            filename,
            bytes: await readBody(res),
            contentType: res.headers.get("content-type") ?? "application/octet-stream",
        };
    }
    /** GET /dub/tracks/{job_id} — list rendered language tracks for a job. */
    async listTracks(jobId) {
        return this.client.request(`/dub/tracks/${encodeURIComponent(jobId)}`);
    }
    /** POST /dub/abort/{job_id} — cancel any running tasks for this job. */
    async abort(jobId) {
        return this.client.request(`/dub/abort/${encodeURIComponent(jobId)}`, { method: "POST" });
    }
    // ── Convenience: full pipeline in one call ───────────────────────────
    /**
     * Run the full pipeline: upload → wait for ready → transcribe → translate
     * → generate. Returns the final job id and the final SSE `done` event so
     * the caller can pull the file via {@link download}.
     *
     * `onStage` fires once per pipeline phase; `onEvent` fires for every SSE
     * frame. Either is enough for a progress bar.
     */
    async dubVideo(input) {
        const stage = (s) => input.onStage?.(s);
        stage("uploading");
        const upload = await this.upload({
            media: input.media,
            filename: input.filename,
            inputType: input.inputType,
        });
        // Wait for the prep pipeline to finish (Demucs, scene detect, …).
        await this.client.waitForTask(upload.task_id, {
            until: (e) => e.type === "ready" || e.type === "error" || e.type === "cancelled",
            onEvent: input.onEvent,
            signal: input.signal,
        });
        stage("ready");
        stage("transcribing");
        const tx = await this.transcribe(upload.job_id, { onEvent: input.onEvent, signal: input.signal });
        if (!tx.segments.length) {
            throw new Error("transcribe returned no segments — the source audio may be silent or unrecognised");
        }
        stage("translating");
        const tr = await this.translate({
            segments: tx.segments.map((s, i) => ({
                id: s.id ?? `seg_${i}`,
                text: s.text,
                slot_seconds: Math.max(0, s.end - s.start),
            })),
            target_lang: input.targetLang,
            source_lang: input.sourceLang ?? tx.sourceLang,
            provider: input.translateProvider,
            job_id: upload.job_id,
        });
        // Stitch translated text back onto the original timing.
        const byId = new Map(tr.translated.map((t) => [t.id, t.text]));
        const dubSegs = tx.segments.map((s, i) => ({
            id: s.id ?? `seg_${i}`,
            start: s.start,
            end: s.end,
            text: byId.get(s.id ?? `seg_${i}`) ?? s.text,
            profile_id: input.profileId,
            instruct: input.instruct,
        }));
        stage("generating");
        const done = await this.generate(upload.job_id, {
            segments: dubSegs,
            language: input.targetLang,
            // `language_code` is the 2-letter ISO; the backend defaults "und"
            // when missing, but a real code makes the dub track filename + UI
            // labels meaningful. Leave it to callers when they have one.
            instruct: input.instruct ?? "",
            num_step: input.numStep,
            timing_strategy: input.timingStrategy,
            segment_ids: dubSegs.map((s) => s.id).filter(Boolean),
        }, { onEvent: input.onEvent, signal: input.signal });
        stage("done");
        return { jobId: upload.job_id, done };
    }
}
//# sourceMappingURL=dub.js.map