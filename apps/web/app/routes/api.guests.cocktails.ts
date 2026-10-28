import { z } from "zod";
import { createTextLimiter } from "../../src/lib/chat/rate-limit.server";
import { GuestNotFoundError, updateGuestFavoriteCocktails } from "../../src/lib/db/guest-writes.server";

export const cocktailUpdateSchema = z.object({
  guestId: z.string().trim().min(1).max(128),
  favoriteCocktails: z.string().max(300).transform((value) => value.trim()).transform((value) => value || null),
}).strict();

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
      payload = { guestId: form.get("guestId"), favoriteCocktails: form.get("favoriteCocktails") };
    } else return Response.json({ ok: false, error: "Expected JSON or form data." }, { status: 400 });
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const parsed = cocktailUpdateSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ ok: false, error: "Invalid favorite cocktails." }, { status: 400 });
  const limiter = writeLimiters[nextBucket]!;
  nextBucket = (nextBucket + 1) % writeLimiters.length;
  if (limiter.take("guest-cocktail-writes") > 0) return Response.json({ ok: false, error: "Too many updates. Try again shortly." }, { status: 429 });
  try {
    const favoriteCocktails = await updateGuestFavoriteCocktails(parsed.data);
    return Response.json({ ok: true, favoriteCocktails });
  } catch (error) {
    if (error instanceof GuestNotFoundError) return Response.json({ ok: false, error: "Guest not found." }, { status: 404 });
    throw error;
  }
}

export function loader() {
  return Response.json({ ok: false, error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
}
