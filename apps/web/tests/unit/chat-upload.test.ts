import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activeUploadCount, createUploadService, readUploadBody, withUploadDeadline } from "../../src/lib/chat/upload.server";
import { UPLOAD_EXPIRY_MS, UPLOAD_FILE_BYTES, UPLOAD_REQUEST_BYTES } from "../../src/lib/chat/upload-policy";
import { publicRow } from "../../src/lib/chat/runtime/public-frame.server";
import { uploadHarness, pdf, pdfBytes, scope, NOW } from "../fixtures/chat/upload-harness";

const signal = () => new AbortController().signal;
afterEach(() => { expect(activeUploadCount()).toBe(0); vi.useRealTimers(); });

describe("Task 4 ingest through the real bookkeeping helpers", () => {
  it("accepts a real PNG, re-encodes with native Bun.Image and hashes ORIGINAL bytes", async () => {
    const h = uploadHarness();
    const bytes = readFileSync("tests/fixtures/chat/bedroom-map.png");
    h.deps.normalise = async input => new Uint8Array(execFileSync("bun", ["--no-install", "tests/integration/chat-image.ts", "--encode"], { input, timeout: 10_000, maxBuffer: UPLOAD_FILE_BYTES }));
    let sent: Uint8Array | undefined;
    h.provider.upload.mockImplementation(async input => { sent = input; expect(Buffer.from(input).subarray(8, 12).toString()).toBe("WEBP"); return "original-file"; });
    const result = await createUploadService(h.deps).ingest(scope, new File([bytes], "booking.png", { type: "text/plain" }), signal());
    expect(result).toMatchObject({ mimeType: "image/webp", filename: "attachment.webp" });
    expect(h.uploads[0]?.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(sent?.every(byte => byte === 0)).toBe(true);
  });
  it("caps the longest edge at 1600, never upscales, normalizes EXIF and rejects corrupt images in REAL Bun", () => {
    const result = JSON.parse(execFileSync("bun", ["--no-install", "tests/integration/chat-image.ts"], { encoding: "utf8", timeout: 10_000 }));
    expect(result).toMatchObject({ capped: { width: 1600, height: 1200, format: "webp" }, small: { width: 80, height: 60 }, oriented: { width: 60, height: 80 }, corruptRejected: true });
  });
  it("accepts a .png-named PDF via file-type without invoking image normalization", async () => {
    const h = uploadHarness();
    h.provider.upload.mockImplementation(async bytes => { expect(bytes).toEqual(pdfBytes); return "original-file"; });
    expect(await h.service.ingest(scope, pdf("lie.png", "image/png"), signal())).toMatchObject({ mimeType: "application/pdf", filename: "attachment.pdf" });
    expect(h.deps.normalise).not.toHaveBeenCalled();
  });
  it("rejects unsupported magic bytes even when extension and Content-Type both claim PNG", async () => {
    const h = uploadHarness();
    await expect(h.service.ingest(scope, new File(["<html>secret</html>"], "image.png", { type: "image/png" }), signal())).rejects.toMatchObject({ code: "invalid", status: 415 });
    expect(h.uploads).toHaveLength(0); expect(h.provider.upload).not.toHaveBeenCalled();
  });
  it("rejects a corrupt image before creating a reservation or provider object", async () => {
    const h = uploadHarness(); h.deps.normalise = vi.fn(async () => { throw new Error("decoder internal ABC123"); });
    const file = new File([readFileSync("tests/fixtures/chat/bedroom-map.png").subarray(0, 33)], "bad.png");
    await expect(createUploadService(h.deps).ingest(scope, file, signal())).rejects.toMatchObject({ code: "invalid" });
    expect(h.uploads).toHaveLength(0);
  });
  it("rejects files over exactly 10 MiB before reading them", async () => {
    const h = uploadHarness(); const file = new File([new Uint8Array(UPLOAD_FILE_BYTES + 1)], "big.pdf");
    const read = vi.spyOn(file, "arrayBuffer");
    await expect(h.service.ingest(scope, file, signal())).rejects.toMatchObject({ status: 413, code: "size" });
    expect(read).not.toHaveBeenCalled(); expect(h.uploads).toHaveLength(0);
  });
  it("accepts the inclusive 10 MiB file boundary", async () => {
    const h = uploadHarness(); const bytes = new Uint8Array(UPLOAD_FILE_BYTES); bytes.set(pdfBytes);
    expect(await h.service.ingest(scope, new File([bytes], "max.pdf"), signal())).toMatchObject({ sizeBytes: UPLOAD_FILE_BYTES });
  });
  it("reserves NULL fileId and completes only after original upload and mount both succeed", async () => {
    const h = uploadHarness();
    h.provider.upload.mockImplementation(async () => { expect(h.uploads[0]).toMatchObject({ status: "pending", fileId: null }); return "original-file"; });
    h.provider.mount.mockImplementation(async (_session, _file, path) => {
      expect(h.uploads[0]).toMatchObject({ status: "uploaded", fileId: "original-file", mountedFileId: null });
      return { id: "resource-id", file_id: "mounted-file", mount_path: path };
    });
    const result = await h.service.ingest(scope, pdf(), signal());
    expect(h.uploads[0]).toMatchObject({ id: result.uploadId, status: "mounted", fileId: "original-file", mountedFileId: "mounted-file", sessionResourceId: "resource-id", mountPath: `/${result.uploadId}.pdf` });
    expect(JSON.stringify(result)).not.toMatch(/original-file|mounted-file|resource-id|ABC123|secret/);
  });
  it("keeps an explicit retryable NULL reservation after failed upload, with no half-mounted row", async () => {
    const h = uploadHarness(); h.provider.upload.mockRejectedValueOnce(new Error("sk-secret booking ABC123"));
    await expect(h.service.ingest(scope, pdf(), signal())).rejects.toMatchObject({ code: "failed" });
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0]).toMatchObject({ status: "pending", fileId: null, mountedFileId: null, sessionResourceId: null, extractionResult: { uploadOutcome: "failed" } });
    expect(await h.service.ingest(scope, pdf(), signal())).toHaveProperty("uploadId", h.uploads[0]!.id);
    expect(h.uploads[0]?.status).toBe("mounted");
  });
  it("compensates a failed mount and records confirmed original deletion", async () => {
    const h = uploadHarness(); h.provider.mount.mockRejectedValueOnce(new Error("internal failure"));
    await expect(h.service.ingest(scope, pdf(), signal())).rejects.toMatchObject({ code: "failed" });
    expect(h.provider.deleteFile).toHaveBeenCalledWith("original-file", expect.any(AbortSignal));
    expect(h.uploads[0]).toMatchObject({ status: "deleted", originalFileDeletedAt: NOW, deletedFromAnthropicAt: NOW });
    expect(h.provider.deleteFile.mock.calls[0]![1].aborted).toBe(true);
  });
  it("retries failed copy cleanup without declaring the entire upload deleted early", async () => {
    const h = uploadHarness(); await h.service.ingest(scope, pdf(), signal());
    const row = await h.deps.loadUpload(scope, String(h.uploads[0]!.id));
    h.provider.deleteFile.mockRejectedValueOnce(new Error("network"));
    expect(await h.service.cleanup(row!, "session", signal())).toBe(false);
    expect(h.uploads[0]?.deletedFromAnthropicAt).toBeNull();
    expect(h.uploads[0]?.sessionResourceDeletedAt).toEqual(NOW);
    expect(await h.service.cleanup((await h.deps.loadUpload(scope, row!.id))!, "session", signal())).toBe(true);
    expect(h.provider.deleteResource).toHaveBeenCalledTimes(1);
    expect(h.uploads[0]?.deletedFromAnthropicAt).toEqual(NOW);
  });
  it("compensates both provider copies when final mount bookkeeping fails", async () => {
    const h = uploadHarness(); const attach = h.writes.attachUploadResource; let calls = 0;
    vi.spyOn(h.writes, "attachUploadResource").mockImplementation(async input => {
      if (++calls === 2) throw new Error("DB temporary failure");
      return attach(input);
    });
    await expect(h.service.ingest(scope, pdf(), signal())).rejects.toMatchObject({ code: "failed" });
    expect(h.uploads[0]).toMatchObject({ status: "deleted", fileId: "original-file", mountedFileId: "mounted-file", sessionResourceId: "resource-id" });
    expect(h.provider.deleteFile.mock.calls.map(call => call[0])).toEqual(["mounted-file", "original-file"]);
  });
  it("discovers and cleans a mount accepted before its response was lost", async () => {
    const h = uploadHarness(); h.provider.mount.mockRejectedValue(new Error("response lost"));
    h.provider.findMount.mockImplementation(async (_session, path) => ({ id: "resource-id", file_id: "mounted-file", mount_path: path }));
    await expect(h.service.ingest(scope, pdf(), signal())).rejects.toMatchObject({ code: "failed" });
    expect(h.uploads[0]).toMatchObject({ status: "deleted", mountedFileId: "mounted-file", sessionResourceId: "resource-id" });
  });
  it("retains cleanup identities when an ambiguous mount cannot yet be discovered", async () => {
    const h = uploadHarness(); h.provider.mount.mockRejectedValue(new Error("response lost")); h.provider.findMount.mockRejectedValue(new Error("network unavailable"));
    await expect(h.service.ingest(scope, pdf(), signal())).rejects.toMatchObject({ code: "failed" });
    expect(h.uploads[0]).toMatchObject({ status: "uploaded", fileId: "original-file", deletedFromAnthropicAt: null });
    expect(h.provider.deleteFile).not.toHaveBeenCalled();
  });
  it("deduplicates renamed bytes in the same conversation without a second upload", async () => {
    const h = uploadHarness(); const first = await h.service.ingest(scope, pdf(), signal());
    expect(await h.service.ingest(scope, pdf("renamed.pdf"), signal())).toEqual(first);
    expect(h.provider.upload).toHaveBeenCalledTimes(1);
  });
  it("rejects cross-conversation sha256 without leaking another conversation's IDs or metadata", async () => {
    const h = uploadHarness(); const first = await h.service.ingest(scope, pdf(), signal());
    let error: unknown;
    try { await h.service.ingest({ ...scope, conversationId: "other" }, pdf(), signal()); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: "duplicate", status: 409 });
    expect(String(error)).not.toMatch(new RegExp(`${first.uploadId}|original-file|mounted-file|resource-id|ABC123`));
    expect(String(error)).toContain("Retry in the original conversation"); expect(h.uploads).toHaveLength(1);
  });
  it("rejects use exactly at 24 hours and cleans expired duplicates", async () => {
    const h = uploadHarness(); const result = await h.service.ingest(scope, pdf(), signal());
    h.deps.now = () => NOW.getTime() + UPLOAD_EXPIRY_MS;
    const service = createUploadService(h.deps);
    await expect(service.message(scope, "Read", result.uploadId)).rejects.toMatchObject({ code: "expired" });
    await expect(service.ingest(scope, pdf(), signal())).rejects.toMatchObject({ code: "expired" });
    expect(h.uploads[0]?.status).toBe("deleted");
  });
  it("creates and attaches an empty draft session before upload and reuses the draft request key", async () => {
    const h = uploadHarness();
    h.provider.draft.mockImplementation(async () => { expect(h.conversations).toHaveLength(3); expect(h.uploads).toHaveLength(0); return "new-session"; });
    const first = await h.service.draft("trip", "draft-key", signal());
    expect(await h.service.draft("trip", "draft-key", signal())).toEqual(first);
    expect(h.provider.draft).toHaveBeenCalledTimes(1);
    expect(h.conversations.at(-1)).toMatchObject({ agentSessionId: "new-session", runtimeStatus: "waiting" });
  });
  it("gates concurrent uploads synchronously and releases the lock after failure", async () => {
    const h = uploadHarness(); let release!: () => void;
    h.provider.upload.mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); return "original-file"; });
    const first = h.service.ingest(scope, pdf(), signal());
    while (!release) await new Promise(resolve => setImmediate(resolve));
    await expect(h.service.ingest(scope, pdf(), signal())).rejects.toMatchObject({ code: "busy" });
    release(); await first;
  });
  it("does not mount or write after request cancellation and wipes retained buffers", async () => {
    const h = uploadHarness(); const controller = new AbortController(); let buffer: Uint8Array | undefined;
    h.provider.upload.mockImplementation(async bytes => { buffer = bytes; controller.abort(); return "original-file"; });
    await expect(h.service.ingest(scope, pdf(), controller.signal)).rejects.toMatchObject({ code: "failed" });
    expect(h.provider.mount).not.toHaveBeenCalled(); expect(h.uploads[0]?.status).toBe("deleted");
    expect(buffer?.every(byte => byte === 0)).toBe(true);
  });
  it("adds only the owned generated path to the ordinary message and returns a safe public attachment label", async () => {
    const h = uploadHarness(); const result = await h.service.ingest(scope, pdf(), signal());
    const message = await h.service.message(scope, "Read this", result.uploadId);
    expect(message.text).toContain(`/mnt/session/uploads/${result.uploadId}.pdf`);
    await expect(h.service.message({ ...scope, conversationId: "other" }, "Read", result.uploadId)).rejects.toMatchObject({ code: "failed" });
    const privateUpload = { id: result.uploadId, sizeBytes: 10, filename: "Name ABC123 sk-secret.pdf", mimeType: "application/pdf", fileId: "secret-id" };
    const row = publicRow({ id: "message", seq: 0, type: "user_message", payload: { text: message.text, upload: privateUpload } });
    expect(row.payload).toEqual({ text: "Read this", upload: { filename: "attachment.pdf", mimeType: "application/pdf" } });
  });
});

describe("bounded stream ownership", () => {
  function request(chunks: Uint8Array[], headers?: HeadersInit) {
    const cancel = vi.fn(); let i = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (i < chunks.length) controller.enqueue(chunks[i++]!); else controller.close(); }, cancel });
    return { request: new Request("https://trip.test/api/chat/uploads", { method: "POST", body: stream, headers, duplex: "half" } as RequestInit), cancel, stream };
  }
  it.each([true, false])("rejects >11 MiB multipart (declared=%s) and unlocks/cancels the reader", async declared => {
    const value = request([new Uint8Array(UPLOAD_REQUEST_BYTES), new Uint8Array(1), new Uint8Array(1)], declared ? { "Content-Length": String(UPLOAD_REQUEST_BYTES + 1) } : undefined);
    await expect(readUploadBody(value.request)).rejects.toMatchObject({ code: "body", status: 413 });
    expect(value.stream.locked).toBe(false); expect(value.cancel).toHaveBeenCalledTimes(1);
  });
  it("accepts exactly 11 MiB and zeros consumed chunks", async () => {
    const chunk = new Uint8Array(UPLOAD_REQUEST_BYTES).fill(7); const value = request([chunk]);
    const bytes = await readUploadBody(value.request);
    expect(bytes.byteLength).toBe(UPLOAD_REQUEST_BYTES); expect(bytes[0]).toBe(7);
    expect(chunk.every(byte => byte === 0)).toBe(true); expect(value.stream.locked).toBe(false); bytes.fill(0);
  });
  it("cancels a stalled read on abort and removes its listener", async () => {
    const controller = new AbortController(); const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const req = new Request("https://trip.test", { method: "POST", body: stream, signal: controller.signal, duplex: "half" } as RequestInit);
    const remove = vi.spyOn(req.signal, "removeEventListener");
    const reading = readUploadBody(req); controller.abort();
    await expect(reading).rejects.toThrow(); expect(cancel).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
  it.each([false, true])("disposes deadline timer, controller and parent listener on failure=%s", async fail => {
    vi.useFakeTimers(); const parent = new AbortController(); const remove = vi.spyOn(parent.signal, "removeEventListener"); let child!: AbortSignal;
    const run = withUploadDeadline(parent.signal, 1000, async signal => { child = signal; if (fail) throw new Error("failure"); return 42; });
    if (fail) await expect(run).rejects.toThrow("failure"); else expect(await run).toBe(42);
    expect(child.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0); expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
