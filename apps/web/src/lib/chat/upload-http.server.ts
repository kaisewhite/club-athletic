import { z } from "zod";
import { conversationScope } from "./runtime/runtime.server";
import { createUploadLimiter } from "./upload-rate-limit.server";
import { cleanupExpiredUploads, readUploadBody, UploadError, uploadService, withUploadDeadline } from "./upload.server";
import { UPLOAD_ERRORS } from "./upload-policy";

const limiter = createUploadLimiter();
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const uploadRouteDeps = {
  scope: conversationScope, service: uploadService, limiter,
  cleanup: cleanupExpiredUploads,
};
export async function handleUploadRequest(request: Request, deps = uploadRouteDeps): Promise<Response> {
  const json = (value: unknown, status = 200, extra?: HeadersInit) => Response.json(value, { status, headers: { "Cache-Control": "no-store", ...extra } });
  try {
    if (request.method !== "POST") return json({ ok: false }, 405, { Allow: "POST" });
    const origin = request.headers.get("Origin");
    if (origin && new URL(origin).origin !== new URL(request.url).origin) return json({ ok: false }, 403);
    const contentType = request.headers.get("Content-Type") ?? "";
    const draft = contentType.toLowerCase().startsWith("application/json");
    if (!draft && !/^multipart\/form-data;\s*boundary=/i.test(contentType)) throw new UploadError("invalid", 415);
    // The existing Express adapter overwrites this header from the socket.
    const retry = deps.limiter.take(`${draft ? "draft" : "file"}:${request.headers.get("x-club-chat-client") ?? "shared-public"}`);
    if (retry) return json({ ok: false, code: "limited", error: UPLOAD_ERRORS.limited }, 429, { "Retry-After": String(retry) });
    return await withUploadDeadline(request.signal, 90_000, async signal => {
      // Use the deadline for the body reader as well as provider requests.
      const boundedRequest = new Request(request, { signal });
      const bytes = await readUploadBody(boundedRequest, draft ? 1024 : undefined);
      try {
        if (draft) {
          const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
          z.object({ draft: z.literal(true) }).strict().parse(body);
          const requestId = key.parse(request.headers.get("Idempotency-Key"));
          const scope = await deps.scope("");
          return json({ ok: true, ...await deps.service().draft(scope.tripId, requestId, signal) }, 201);
        }
        const form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData();
        if ([...form.keys()].some(name => name !== "file" && name !== "conversationId") || form.getAll("file").length !== 1 || form.getAll("conversationId").length !== 1) throw new UploadError("invalid");
        const file = form.get("file");
        if (!file || typeof file === "string") throw new UploadError("invalid");
        const conversationId = key.parse(form.get("conversationId"));
        const scope = await deps.scope(conversationId);
        await deps.cleanup(signal);
        const uploaded = await deps.service().ingest(scope, file, signal);
        return json({ ok: true, ...uploaded }, 201);
      } finally { bytes.fill(0); }
    });
  } catch (error) {
    const known = error instanceof UploadError ? error : error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError ? new UploadError("invalid") : new UploadError("failed", 503);
    return json({ ok: false, code: known.code, error: known.message }, known.status);
  } finally {
    if (request.body && !request.body.locked) await request.body.cancel().catch(() => {});
  }
}
