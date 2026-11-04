import { z } from "zod";
import { createTextLimiter } from "../../src/lib/chat/rate-limit.server";
import {
  PublicFlightEditConflict,
  PublicFlightEditError,
  PublicFlightEditNotFound,
  FlightWriteRefusal,
  savePublicFlightEdit,
} from "../../src/lib/db/flight-writes.server";

const MAX_BODY_BYTES = 8 * 1024;
const writeLimiter = createTextLimiter(Date.now, 10_000, 20, 5_000);
const optionalText = (max: number) => z.string().trim().max(max).nullable();
const flightLegSchema = z.object({
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  expectedFlightId: z.string().trim().min(1).max(100).nullable(),
  airline: optionalText(80),
  flightNumber: optionalText(30),
  origin: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  destination: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  departureTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  arrivalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  arrivalTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
}).strict();
const payloadSchema = z.object({
  guestId: z.string().trim().min(1).max(100),
  displayName: z.string().max(200).optional(),
  legs: z.array(flightLegSchema).max(2).default([]),
}).strict().superRefine((payload, context) => {
  if (new Set(payload.legs.map((leg) => leg.direction)).size !== payload.legs.length) {
    context.addIssue({ code: "custom", path: ["legs"], message: "Edit each flight direction once." });
  }
});

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
      if (length > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return `flight-details:${forwarded || "direct"}`;
}

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") return Response.json({ ok: false, error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) return Response.json({ ok: false, error: "Request origin is not allowed." }, { status: 403 });
    } catch { return Response.json({ ok: false, error: "Request origin is not allowed." }, { status: 403 }); }
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return Response.json({ ok: false, error: "Expected a JSON payload." }, { status: 415 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return Response.json({ ok: false, error: "Flight changes are too large." }, { status: 413 });
  const raw = await readBody(request);
  if (raw === null) return Response.json({ ok: false, error: "Flight changes are too large." }, { status: 413 });
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 }); }
  const parsed = payloadSchema.safeParse(value);
  if (!parsed.success) return Response.json({ ok: false, error: "Check the flight details and try again." }, { status: 400 });

  const retryAfter = writeLimiter.take(clientKey(request));
  if (retryAfter > 0) return Response.json({ ok: false, error: "Too many edits. Try again shortly." }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  try {
    const result = await savePublicFlightEdit(parsed.data);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof PublicFlightEditConflict) return Response.json({ ok: false, error: error.message, code: "STALE_FLIGHT" }, { status: 409 });
    if (error instanceof PublicFlightEditNotFound) return Response.json({ ok: false, error: error.message }, { status: 404 });
    if (error instanceof PublicFlightEditError || error instanceof FlightWriteRefusal) {
      return Response.json({ ok: false, error: error.message }, { status: 400 });
    }
    console.error("Public flight edit failed.", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ ok: false, error: "We couldn’t save these flight changes. Try again." }, { status: 503 });
  }
}

export function loader() {
  return Response.json({ ok: false, error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
}
