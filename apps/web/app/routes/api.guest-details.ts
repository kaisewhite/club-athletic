import { createTextLimiter } from "../../src/lib/chat/rate-limit.server";
import { GuestDetailsNameMatchError, GuestDetailsRoomFullError, saveGuestDetails, saveGuestDetailsField } from "../../src/lib/db/guest-submissions.server";
import { guestDetailsSubmissionSchema } from "../../src/lib/guest-details-schema";

const MAX_BODY_BYTES = 8 * 1024;
const writeLimiter = createTextLimiter();
const autosaveLimiter = createTextLimiter(Date.now, 10_000, 120, 1_000);

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
  const raw = await readBody(request);
  if (raw === null) return Response.json({ ok: false, error: "Form submission is too large." }, { status: 413 });
  let payload: unknown;
  try { payload = JSON.parse(raw); }
  catch { return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 }); }
  const autosave = typeof payload === "object" && payload !== null && "kind" in payload && payload.kind === "field";
  const retryAfter = (autosave ? autosaveLimiter : writeLimiter).take(rateLimitKey(request));
  if (retryAfter > 0) return Response.json({ ok: false, error: "Too many submissions. Try again shortly." }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  if (typeof payload === "object" && payload !== null && "website" in payload && typeof payload.website === "string" && payload.website.trim()) {
    return Response.json({ ok: false, error: "We couldn’t verify this submission. Refresh the form and try again." }, { status: 400 });
  }
  if (typeof payload === "object" && payload !== null && "website" in payload) delete (payload as { website?: unknown }).website;

  if (autosave) {
    const candidate = payload as Record<string, unknown>;
    const allowed = ["firstName", "lastName", "phone", "venmoHandle", "instagramHandle", "dietaryNotes", "favoriteCocktails", "roomId"];
    const maxLengths: Record<string, number> = { firstName: 80, lastName: 80, phone: 64, venmoHandle: 100, instagramHandle: 100, dietaryNotes: 500, favoriteCocktails: 300, roomId: 100 };
    if (typeof candidate.submissionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.submissionId)
      || typeof candidate.field !== "string" || !allowed.includes(candidate.field)
      || typeof candidate.value !== "string" || candidate.value.length > (maxLengths[String(candidate.field)] ?? 0) || /[\p{Cc}\p{Cf}]/u.test(candidate.value)) {
      return Response.json({ ok: false, error: "Check this answer and try again." }, { status: 400 });
    }
    try {
      await saveGuestDetailsField({ submissionId: candidate.submissionId, field: candidate.field as Parameters<typeof saveGuestDetailsField>[0]["field"], value: candidate.value });
      return Response.json({ ok: true }, { status: 200 });
    } catch (error) {
      console.error("Guest details autosave failed.", error instanceof Error ? error.name : "Unknown error");
      return Response.json({ ok: false, error: "We couldn’t save this answer. Your text is still here; try again." }, { status: 503 });
    }
  }

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
    if (error instanceof GuestDetailsRoomFullError) return Response.json({ ok: false, code: "ROOM_FULL", error: error.message }, { status: 409 });
    console.error("Guest details submission failed.", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ ok: false, error: "We couldn’t save your details. Try again in a moment." }, { status: 503 });
  }
}

export function loader() {
  return Response.json({ ok: false, error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
}
