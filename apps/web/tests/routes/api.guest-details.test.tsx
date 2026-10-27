import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { saveGuestDetails, GuestDetailsNameMatchError } = vi.hoisted(() => {
  class GuestDetailsNameMatchError extends Error {}
  return { saveGuestDetails: vi.fn(), GuestDetailsNameMatchError };
});
vi.mock("../../src/lib/db/guest-submissions.server", () => ({ saveGuestDetails, GuestDetailsNameMatchError }));
import { action, loader } from "../../app/routes/api.guest-details";

const valid = {
  submissionId: "7c54ef87-76d0-4c5b-87ea-a17b897d8291", firstName: "Alex", lastName: "Guest", phone: "+1 415 555 0132",
  venmoHandle: "@alex-guest", instagramHandle: "@alex.guest", dietaryNotes: "None", favoriteCocktails: "Margarita",
};

beforeEach(() => { saveGuestDetails.mockReset(); saveGuestDetails.mockResolvedValue({ duplicate: false, created: false, guestId: "guest-1" }); });
afterEach(() => vi.restoreAllMocks());

function request(body: unknown, init: { method?: string; headers?: Record<string, string> } = {}) {
  const headerValues = new Map(Object.entries({ "content-type": "application/json", ...init.headers }).map(([key, value]) => [key.toLowerCase(), value]));
  const raw = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
  const stream = raw === null ? null : new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(raw)); controller.close(); } });
  return { method: init.method ?? "POST", url: "https://trip.example/api/guest-details", headers: { get: (name: string) => headerValues.get(name.toLowerCase()) ?? null }, body: stream } as unknown as Request;
}

describe("guest details API", () => {
  it("accepts a validated submission and passes normalized values to the write boundary", async () => {
    const response = await action({ request: request(valid) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, created: false, duplicate: false });
    expect(saveGuestDetails).toHaveBeenCalledWith({
      submissionId: valid.submissionId,
      details: { firstName: "Alex", lastName: "Guest", phone: "+14155550132", venmoHandle: "@alex-guest", instagramHandle: "@alex.guest", dietaryNotes: null, favoriteCocktails: "Margarita" },
    });
  });

  it("rejects invalid fields before writing and returns inline field errors", async () => {
    const response = await action({ request: request({ ...valid, phone: "123", instagramHandle: "https://example.com/nope" }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, fieldErrors: {
      phone: "Enter a valid phone number, including the country code if needed.",
      instagramHandle: "Enter an Instagram handle or profile link.",
    } });
    expect(saveGuestDetails).not.toHaveBeenCalled();
  });

  it("blocks cross-origin and unsupported requests", async () => {
    expect((await action({ request: request(valid, { headers: { origin: "https://attacker.example" } }) })).status).toBe(403);
    expect((await action({ request: request(valid, { headers: { "content-type": "text/plain" } }) })).status).toBe(415);
    expect((await loader()).status).toBe(405);
  });

  it("uses the honeypot response without creating a guest", async () => {
    const response = await action({ request: request({ ...valid, website: "bot" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, created: false });
    expect(saveGuestDetails).not.toHaveBeenCalled();
  });

  it("reports ambiguous names without exposing roster details", async () => {
    saveGuestDetails.mockRejectedValue(new GuestDetailsNameMatchError("The name matches more than one guest."));
    const response = await action({ request: request(valid) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, error: "The name matches more than one guest." });
  });
});
