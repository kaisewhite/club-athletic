import { z } from "zod";
import { createTextLimiter } from "../../src/lib/chat/rate-limit.server";
import { GuestNotFoundError, updateGuestDietaryNotes } from "../../src/lib/db/guest-writes.server";

export const dietaryUpdateSchema = z.object({
  guestId: z.string().trim().min(1).max(128),
  dietaryNotes: z.string().max(500).transform((value) => value.trim()).transform((value) => value || null),
}).strict();

// Three existing text buckets combine to a 30-write burst and 30 writes/minute.
const writeLimiters = [createTextLimiter(), createTextLimiter(), createTextLimiter()];
let nextBucket = 0;

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") return Response.json({ ok: false, error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
  let payload: unknown;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) payload = await request.json();
    else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      payload = { guestId: form.get("guestId"), dietaryNotes: form.get("dietaryNotes") };
    } else return Response.json({ ok: false, error: "Expected JSON or form data." }, { status: 400 });
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const parsed = dietaryUpdateSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ ok: false, error: "Invalid dietary notes." }, { status: 400 });
  const limiter = writeLimiters[nextBucket]!;
  nextBucket = (nextBucket + 1) % writeLimiters.length;
  if (limiter.take("guest-dietary-writes") > 0) return Response.json({ ok: false, error: "Too many updates. Try again shortly." }, { status: 429 });
  try {
    const dietaryNotes = await updateGuestDietaryNotes(parsed.data);
    return Response.json({ ok: true, dietaryNotes });
  } catch (error) {
    if (error instanceof GuestNotFoundError) return Response.json({ ok: false, error: "Guest not found." }, { status: 404 });
    throw error;
  }
}

export function loader() {
  return Response.json({ ok: false, error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
}
