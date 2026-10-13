import { z } from "zod";
import { createTextLimiter } from "../../src/lib/chat/rate-limit.server";
import { createGuestWithDietaryNotes, GuestAlreadyExistsError } from "../../src/lib/db/guest-writes.server";

export const guestCreateSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  dietaryNotes: z.string().max(500).transform((value) => value.trim()).transform((value) => value || null),
  instagramUrl: z.string().trim().max(2048).url().refine((value) => /^https:\/\/(www\.)?instagram\.com\//i.test(value), "Enter an Instagram profile URL."),
}).strict();

const writeLimiter = createTextLimiter();

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") return Response.json({ ok: false, error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
  let payload: unknown;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) payload = await request.json();
    else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      payload = { firstName: form.get("firstName"), lastName: form.get("lastName"), dietaryNotes: form.get("dietaryNotes"), instagramUrl: form.get("instagramUrl") };
    } else return Response.json({ ok: false, error: "Expected JSON or form data." }, { status: 400 });
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const parsed = guestCreateSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ ok: false, error: "Enter your name and a valid Instagram profile URL." }, { status: 400 });
  if (writeLimiter.take("guest-create-writes") > 0) return Response.json({ ok: false, error: "Too many sign-ups. Try again shortly." }, { status: 429 });
  try {
    const guest = await createGuestWithDietaryNotes(parsed.data);
    return Response.json({ ok: true, guest }, { status: 201 });
  } catch (error) {
    if (error instanceof GuestAlreadyExistsError) return Response.json({ ok: false, error: "A guest with that name is already listed." }, { status: 409 });
    throw error;
  }
}

export function loader() {
  return Response.json({ ok: false, error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
}
