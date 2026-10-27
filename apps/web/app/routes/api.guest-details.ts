import { createTextLimiter } from "../../src/lib/chat/rate-limit.server";
import { GuestDetailsNameMatchError, saveGuestDetails } from "../../src/lib/db/guest-submissions.server";
import { guestDetailsSubmissionSchema } from "../../src/lib/guest-details-schema";

const MAX_BODY_BYTES = 8 * 1024;
const writeLimiter = createTextLimiter();

async function readBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

function rateLimitKey(request: Request) {
  // The load balancer appends the connecting address to this header.
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return `guest-details:${forwarded || "direct"}`;
}

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") return Response.json({ ok: false, error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) return Response.json({ ok: false, error: "Request origin is not allowed." }, { status: 403 });
    } catch {
      return Response.json({ ok: false, error: "Request origin is not allowed." }, { status: 403 });
    }
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return Response.json({ ok: false, error: "Expected a JSON payload." }, { status: 415 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: "Form submission is too large." }, { status: 413 });
  }
  const retryAfter = writeLimiter.take(rateLimitKey(request));
  if (retryAfter > 0) return Response.json({ ok: false, error: "Too many submissions. Try again shortly." }, { status: 429, headers: { "Retry-After": String(retryAfter) } });

  const raw = await readBody(request);
  if (raw === null) return Response.json({ ok: false, error: "Form submission is too large." }, { status: 413 });
  let payload: unknown;
  try { payload = JSON.parse(raw); }
  catch { return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 }); }
  if (typeof payload === "object" && payload !== null && "website" in payload && typeof payload.website === "string" && payload.website.trim()) {
    return Response.json({ ok: true, created: false });
  }
  if (typeof payload === "object" && payload !== null && "website" in payload) delete (payload as { website?: unknown }).website;

  const parsed = guestDetailsSubmissionSchema.safeParse(payload);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !(field in fieldErrors)) fieldErrors[field] = issue.message;
    }
    return Response.json({ ok: false, error: "Check the highlighted fields.", fieldErrors }, { status: 400 });
  }

  const { submissionId, ...details } = parsed.data;
  try {
    const result = await saveGuestDetails({ submissionId, details });
    return Response.json({ ok: true, created: result.created, duplicate: result.duplicate }, { status: 200 });
  } catch (error) {
    if (error instanceof GuestDetailsNameMatchError) return Response.json({ ok: false, error: error.message }, { status: 409 });
    console.error("Guest details submission failed.", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ ok: false, error: "We couldn’t save your details. Try again in a moment." }, { status: 503 });
  }
}

export function loader() {
  return Response.json({ ok: false, error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
}
