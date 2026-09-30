import { getEventListeners } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleUploadRequest } from "../../src/lib/chat/upload-http.server";
import { createUploadLimiter } from "../../src/lib/chat/upload-rate-limit.server";
import { UPLOAD_FILE_BYTES, UPLOAD_REQUEST_BYTES } from "../../src/lib/chat/upload-policy";
import { uploadHarness, pdf, scope } from "../fixtures/chat/upload-harness";

const deps = () => { const h = uploadHarness(); return { h, route: { scope: async (conversationId: string) => ({ ...scope, conversationId }), service: () => h.service, limiter: createUploadLimiter(), cleanup: vi.fn(async () => {}) } }; };
async function multipart(file = pdf(), extra?: (form: FormData) => void) {
  const form = new FormData(); form.set("file", file); form.set("conversationId", scope.conversationId); extra?.(form);
  // Undici's synthetic FormData encoder can enqueue after its body is cancelled.
  // Finish that producer first, then give the route the already-encoded bytes it
  // would receive over HTTP. Preserve the encoder's matching boundary header.
  const encoded = new Response(form);
  return new Request("https://trip.test/api/chat/uploads", {
    method: "POST", body: await encoded.arrayBuffer(), headers: encoded.headers,
  });
}
afterEach(() => { vi.useRealTimers(); });
describe("upload resource route", () => {
  it.each(["rate-limited", "validation-error", "body-error", "provider-error", "success"] as const)("owns the request stream and releases listeners/timers after %s", async outcome => {
    vi.useFakeTimers();
    const { h, route } = deps();
    // A network request arrives as encoded bytes, not a live FormData encoder.
    const form = new FormData(); form.set("file", pdf()); form.set("conversationId", scope.conversationId);
    const encoded = new Response(form);
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    const cancel = vi.fn(); let offset = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.length) { controller.close(); return; }
        const end = Math.min(offset + 64, bytes.length);
        controller.enqueue(bytes.slice(offset, end)); offset = end;
      },
      cancel,
    }, { highWaterMark: 0 });
    const headers = new Headers({ "Content-Type": encoded.headers.get("Content-Type")! });
    if (outcome === "validation-error") headers.set("Content-Type", "text/plain");
    if (outcome === "body-error") headers.set("Content-Length", String(UPLOAD_REQUEST_BYTES + 1));
    if (outcome === "rate-limited") for (let i = 0; i < 3; i++) route.limiter.take("file:shared-public");
    if (outcome === "provider-error") h.provider.upload.mockRejectedValueOnce(new Error("fixture provider failure"));
    const request = new Request("https://trip.test/api/chat/uploads", { method: "POST", body, headers, duplex: "half" } as RequestInit);
    const added = vi.spyOn(request.signal, "addEventListener");
    const removed = vi.spyOn(request.signal, "removeEventListener");
    try {
      const response = await handleUploadRequest(request, route);
      expect(response.status).toBe({ "rate-limited": 429, "validation-error": 415, "body-error": 413, "provider-error": 503, success: 201 }[outcome]);
      expect(request.body).toBe(body);
      expect(body.locked).toBe(false);
      if (["rate-limited", "validation-error", "body-error"].includes(outcome)) {
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(offset).toBeLessThan(bytes.length);
      } else {
        expect(offset).toBe(bytes.length);
      }
      // Demonstrate EOF/cancellation and release the inspection reader as well.
      const reader = body.getReader();
      try { expect((await reader.read()).done).toBe(true); } finally { reader.releaseLock(); }
      expect(body.locked).toBe(false);
      for (const [event, listener] of added.mock.calls) {
        if (event === "abort") expect(removed.mock.calls.some(call => call[0] === event && call[1] === listener)).toBe(true);
      }
      expect(getEventListeners(request.signal, "abort")).toHaveLength(0);
      for (const call of h.provider.upload.mock.calls) {
        expect(call[3].aborted).toBe(true);
        expect(getEventListeners(call[3], "abort")).toHaveLength(0);
      }
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      bytes.fill(0); added.mockRestore(); removed.mockRestore();
    }
  });
  it("returns only application IDs and safe display metadata", async () => {
    const { h, route } = deps(); const result = await handleUploadRequest(await multipart(), route);
    expect(result.status).toBe(201); expect(result.headers.get("Cache-Control")).toBe("no-store");
    const value = await result.json();
    expect(value).toMatchObject({ ok: true, filename: "attachment.pdf", conversationId: scope.conversationId });
    expect(JSON.stringify(value)).not.toMatch(/original-file|mounted-file|resource-id|secret|ABC123/);
    expect(h.uploads).toHaveLength(1);
  });
  it("creates an idempotent draft without parsing multipart or uploading", async () => {
    const { h, route } = deps();
    const request = () => new Request("https://trip.test/api/chat/uploads", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "draft-key" }, body: JSON.stringify({ draft: true }) });
    const first = await (await handleUploadRequest(request(), route)).json();
    expect(await (await handleUploadRequest(request(), route)).json()).toEqual(first);
    expect(h.provider.upload).not.toHaveBeenCalled(); expect(h.provider.draft).toHaveBeenCalledTimes(1);
  });
  it("does not leak raw provider diagnostics through an error detail", async () => {
    const { h, route } = deps(); h.provider.upload.mockRejectedValue(new Error("PrismaClient secret sk-secret PNR ABC123 Jane Doe"));
    const response = await handleUploadRequest(await multipart(), route);
    expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/PrismaClient|sk-secret|ABC123|Jane Doe/);
  });
  it.each(["fileId", "mountPath", "purpose", "uploadId"])("rejects browser-supplied transport field %s", async name => {
    const { h, route } = deps(); const result = await handleUploadRequest(await multipart(pdf(), form => form.set(name, "forged")), route);
    expect(result.status).toBe(400); expect(h.provider.upload).not.toHaveBeenCalled();
  });
  it("rejects two attachments and two conversation IDs", async () => {
    for (const duplicate of ["file", "conversationId"]) {
      const { route } = deps(); const result = await handleUploadRequest(await multipart(pdf(), form => form.append(duplicate, duplicate === "file" ? pdf() : "other")), route);
      expect(result.status).toBe(400);
    }
  });
  it("enforces both real multipart body and single-file limits", async () => {
    const { route } = deps();
    expect((await handleUploadRequest(await multipart(new File([new Uint8Array(UPLOAD_FILE_BYTES + 1)], "big.pdf")), route)).status).toBe(413);
    expect((await handleUploadRequest(await multipart(new File([new Uint8Array(UPLOAD_REQUEST_BYTES + 1)], "big.pdf")), route)).status).toBe(413);
  });
  it("rejects cross-origin mutations, GET and malformed multipart", async () => {
    const { route } = deps();
    const other = await multipart(); other.headers.set("Origin", "https://evil.test");
    expect((await handleUploadRequest(other, route)).status).toBe(403);
    expect((await handleUploadRequest(new Request("https://trip.test/api/chat/uploads"), route)).status).toBe(405);
    expect((await handleUploadRequest(new Request("https://trip.test/api/chat/uploads", { method: "POST", body: "bad", headers: { "Content-Type": "multipart/form-data; boundary=x" } }), route)).status).toBe(400);
  });
  it("uses the upload bucket and returns Retry-After without provider traffic", async () => {
    const { h, route } = deps();
    for (let i = 0; i < 3; i++) expect((await handleUploadRequest(await multipart(), route)).status).toBe(201);
    const response = await handleUploadRequest(await multipart(), route);
    expect(response.status).toBe(429); expect(response.headers.get("Retry-After")).toBe("60"); expect(h.provider.upload).toHaveBeenCalledTimes(1);
  });
  it("releases the deadline and request abort listener after success and errors", async () => {
    vi.useFakeTimers(); const { route } = deps(); const request = await multipart(); const remove = vi.spyOn(request.signal, "removeEventListener");
    await handleUploadRequest(request, route);
    expect(vi.getTimerCount()).toBe(0); expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    const request2 = await multipart(new File(["invalid"], "fake.png"));
    await handleUploadRequest(request2, route); expect(vi.getTimerCount()).toBe(0);
  });
});
