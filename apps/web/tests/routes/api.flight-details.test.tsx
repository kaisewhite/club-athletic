import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { savePublicFlightEdit, PublicFlightEditError, PublicFlightEditNotFound, PublicFlightEditConflict, FlightWriteRefusal } = vi.hoisted(() => {
  class PublicFlightEditError extends Error {}
  class PublicFlightEditNotFound extends PublicFlightEditError {}
  class PublicFlightEditConflict extends PublicFlightEditError {}
  class FlightWriteRefusal extends Error {}
  return { savePublicFlightEdit: vi.fn(), PublicFlightEditError, PublicFlightEditNotFound, PublicFlightEditConflict, FlightWriteRefusal };
});
vi.mock("../../src/lib/db/flight-writes.server", () => ({ savePublicFlightEdit, PublicFlightEditError, PublicFlightEditNotFound, PublicFlightEditConflict, FlightWriteRefusal }));
import { action, loader } from "../../app/routes/api.flight-details";

const valid = {
  guestId: "guest-from-any-row",
  displayName: "Public Editor",
  legs: [{ direction: "INBOUND", expectedFlightId: null, airline: "United", flightNumber: "UA956",
    origin: "ewr", destination: "gva", departureDate: "2027-01-29", departureTime: "17:35",
    arrivalDate: "2027-01-30", arrivalTime: "07:25" }],
};

beforeEach(() => {
  savePublicFlightEdit.mockReset();
  savePublicFlightEdit.mockResolvedValue({ guestId: "guest-from-any-row", displayName: "Public Editor", legs: [{ direction: "INBOUND", flightId: "new-flight" }] });
});
afterEach(() => vi.restoreAllMocks());

function request(body: unknown, init: { method?: string; headers?: Record<string, string> } = {}) {
  const headerValues = new Map(Object.entries({ "content-type": "application/json", ...init.headers }).map(([key, value]) => [key.toLowerCase(), value]));
  const raw = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
  const stream = raw === null ? null : new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(raw)); controller.close(); } });
  return { method: init.method ?? "POST", url: "https://trip.example/api/flight-details", headers: { get: (name: string) => headerValues.get(name.toLowerCase()) ?? null }, body: stream } as unknown as Request;
}

describe("public flight details API", () => {
  it("accepts any visitor's displayed-name and flight edits without an identity token", async () => {
    const response = await action({ request: request(valid) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, guestId: "guest-from-any-row", displayName: "Public Editor", legs: [{ direction: "INBOUND", flightId: "new-flight" }] });
    expect(savePublicFlightEdit).toHaveBeenCalledWith({ ...valid, legs: [{ ...valid.legs[0], origin: "EWR", destination: "GVA" }] });
  });

  it("rejects hidden fields and invalid payloads before writing", async () => {
    expect((await action({ request: request({ ...valid, confirmationCode: "SECRET" }) })).status).toBe(400);
    expect((await action({ request: request({ ...valid, legs: [{ ...valid.legs[0], origin: "ZZZZ" }] }) })).status).toBe(400);
    expect(savePublicFlightEdit).not.toHaveBeenCalled();
  });

  it("requires same-origin JSON while leaving public visitors unauthenticated", async () => {
    expect((await action({ request: request(valid, { headers: { origin: "https://attacker.example" } }) })).status).toBe(403);
    expect((await action({ request: request(valid, { headers: { "content-type": "text/plain" } }) })).status).toBe(415);
    expect(savePublicFlightEdit).not.toHaveBeenCalled();
  });

  it("rejects bodies over the byte limit", async () => {
    const response = await action({ request: request("x".repeat(9_000)) });
    expect(response.status).toBe(413);
    expect(savePublicFlightEdit).not.toHaveBeenCalled();
  });

  it("returns clear stale, missing-row and flight-validation responses", async () => {
    savePublicFlightEdit.mockRejectedValueOnce(new PublicFlightEditConflict("stale"));
    expect((await action({ request: request(valid) })).status).toBe(409);
    savePublicFlightEdit.mockRejectedValueOnce(new PublicFlightEditNotFound("missing"));
    expect((await action({ request: request(valid) })).status).toBe(404);
    savePublicFlightEdit.mockRejectedValueOnce(new PublicFlightEditError("bad flight"));
    expect((await action({ request: request(valid) })).status).toBe(400);
  });

  it("applies an IP rate limit without requiring guest identity", async () => {
    let response: Response | undefined;
    for (let index = 0; index < 21; index++) {
      response = await action({ request: request(valid, { headers: { "x-forwarded-for": "198.51.100.99" } }) });
    }
    expect(response?.status).toBe(429);
  });

  it("rejects unsupported methods and documents the method on GET", async () => {
    expect((await action({ request: request(valid, { method: "PUT" }) })).status).toBe(405);
    expect((await loader()).status).toBe(405);
  });
});
