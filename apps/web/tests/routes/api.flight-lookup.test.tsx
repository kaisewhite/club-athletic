import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { action } from "../../app/routes/api.flight-lookup";

const valid = { flightNumber: "UA 956", departureDate: "2027-01-28" };

function request(body: unknown, ip = "198.51.100.31") {
  return new Request("https://trip.example/api/flight-lookup", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://trip.example", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("RAPID_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("AeroDataBox flight lookup API", () => {
  it("looks up by flight number and departure date and returns the editable local details", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      number: "UA 956", airline: { name: "United Airlines" },
      departure: { airport: { iata: "EWR" }, scheduledTime: { local: "2027-01-28 17:35-05:00", utc: "2027-01-28 22:35Z" } },
      arrival: { airport: { iata: "GVA" }, scheduledTime: { local: "2027-01-29 07:25+01:00", utc: "2027-01-29 06:25Z" } },
    }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await action({ request: request(valid) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, flight: {
      airline: "United Airlines", flightNumber: "UA956", origin: "EWR", destination: "GVA",
      departureDate: "2027-01-28", departureTime: "17:35", arrivalDate: "2027-01-29", arrivalTime: "07:25",
    } });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://aerodatabox.p.rapidapi.com/flights/number/UA956/2027-01-28?dateLocalRole=Departure");
    expect(init.headers).toEqual({ "X-RapidAPI-Key": "test-key", "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" });
  });

  it("rejects malformed input without contacting RapidAPI", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await action({ request: request({ flightNumber: "UA956", departureDate: "2027-02-31" }) });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
