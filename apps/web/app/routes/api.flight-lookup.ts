import { z } from "zod";
import { createTextLimiter } from "../../src/lib/chat/rate-limit.server";
import { airportTimeZone } from "../../src/lib/db/airport-timezones";

const HOST = "aerodatabox.p.rapidapi.com";
const MAX_BODY_BYTES = 2 * 1024;
const limiter = createTextLimiter(Date.now, 60_000, 5, 60_000);
const inputSchema = z.object({
  flightNumber: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9 ]+$/),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

type ProviderFlight = {
  number?: string;
  airline?: { name?: string } | string;
  departure?: { airport?: { iata?: string }; scheduledTime?: { local?: string } | string; scheduledTimeLocal?: string };
  arrival?: { airport?: { iata?: string }; scheduledTime?: { local?: string } | string; scheduledTimeLocal?: string };
};

function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return `flight-lookup:${forwarded || "direct"}`;
}

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

function localDateTime(value: unknown) {
  const local = typeof value === "string" ? value
    : typeof value === "object" && value !== null && "local" in value && typeof value.local === "string" ? value.local
      : null;
  if (!local) return null;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(local);
  return match ? { date: match[1]!, time: match[2]! } : null;
}

function airport(value: unknown) {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null;
}

function toFlight(value: ProviderFlight) {
  const departure = localDateTime(value.departure?.scheduledTime ?? value.departure?.scheduledTimeLocal);
  const arrival = localDateTime(value.arrival?.scheduledTime ?? value.arrival?.scheduledTimeLocal);
  const origin = airport(value.departure?.airport?.iata);
  const destination = airport(value.arrival?.airport?.iata);
  const airline = typeof value.airline === "string" ? value.airline : value.airline?.name;
  const flightNumber = typeof value.number === "string" ? value.number.replaceAll(" ", "") : "";
  if (!departure || !arrival || !origin || !destination || !flightNumber) return null;
  try { airportTimeZone(origin); airportTimeZone(destination); } catch { return null; }
  return {
    airline: typeof airline === "string" && airline.trim() ? airline.trim() : "",
    flightNumber,
    origin,
    destination,
    departureDate: departure.date,
    departureTime: departure.time,
    arrivalDate: arrival.date,
    arrivalTime: arrival.time,
  };
}

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") return Response.json({ ok: false, error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
  const origin = request.headers.get("origin");
  if (origin) {
    try { if (new URL(origin).host !== new URL(request.url).host) return Response.json({ ok: false, error: "Request origin is not allowed." }, { status: 403 }); }
    catch { return Response.json({ ok: false, error: "Request origin is not allowed." }, { status: 403 }); }
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return Response.json({ ok: false, error: "Expected a JSON payload." }, { status: 415 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return Response.json({ ok: false, error: "Flight lookup request is too large." }, { status: 413 });
  const raw = await readBody(request);
  if (raw === null) return Response.json({ ok: false, error: "Flight lookup request is too large." }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 }); }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: "Enter a flight number and departure date." }, { status: 400 });
  const date = new Date(`${parsed.data.departureDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== parsed.data.departureDate) return Response.json({ ok: false, error: "Enter a valid departure date." }, { status: 400 });
  const retryAfter = limiter.take(clientKey(request));
  if (retryAfter > 0) return Response.json({ ok: false, error: "Too many flight lookups. Try again shortly." }, { status: 429, headers: { "Retry-After": String(retryAfter) } });

  const key = process.env.RAPID_API_KEY;
  if (!key) return Response.json({ ok: false, error: "Flight lookup is unavailable right now." }, { status: 503 });
  const flightNumber = parsed.data.flightNumber.replaceAll(" ", "").toUpperCase();
  const url = new URL(`https://${HOST}/flights/number/${encodeURIComponent(flightNumber)}/${parsed.data.departureDate}`);
  url.searchParams.set("dateLocalRole", "Departure");
  try {
    const response = await fetch(url, { headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": HOST }, signal: AbortSignal.timeout(8_000) });
    if (response.status === 404) return Response.json({ ok: false, error: "No matching flight was found for that date." }, { status: 404 });
    if (!response.ok) {
      console.error("AeroDataBox lookup failed.", response.status);
      return Response.json({ ok: false, error: "Flight lookup is temporarily unavailable. Try again shortly." }, { status: 502 });
    }
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) return Response.json({ ok: false, error: "Flight lookup returned an unexpected response. Try again shortly." }, { status: 502 });
    const flights = payload.filter((item): item is ProviderFlight => typeof item === "object" && item !== null)
      .filter((item) => typeof item.number === "string" && item.number.replaceAll(" ", "").toUpperCase() === flightNumber)
      .map(toFlight).filter((item): item is NonNullable<typeof item> => item !== null);
    if (flights.length === 0) return Response.json({ ok: false, error: "No complete flight details were found. Check the flight number and date, then try again." }, { status: 404 });
    if (flights.length > 1) return Response.json({ ok: false, error: "More than one matching flight was found. Check the flight number and date, then try again." }, { status: 409 });
    return Response.json({ ok: true, flight: flights[0] });
  } catch (error) {
    console.error("AeroDataBox lookup request failed.", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ ok: false, error: "Flight lookup is temporarily unavailable. Try again shortly." }, { status: 502 });
  }
}

export function loader() {
  return Response.json({ ok: false, error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
}
