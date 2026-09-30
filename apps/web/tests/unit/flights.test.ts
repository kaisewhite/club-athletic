import { describe, expect, it } from "vitest";
import { airportLocalTime, airportTimeZone } from "../../src/lib/db/airport-timezones";
import { buildFlightTable, type FlightGuest, type FlightRecord, type FlightRules } from "../../src/lib/db/flights";

const rules: FlightRules = {
  startDate: new Date("2027-01-30T00:00:00Z"), endDate: new Date("2027-02-06T00:00:00Z"),
  timezone: "Europe/Paris", flightArrivalTarget: "08:00", flightArrivalCutoff: "08:30", flightReturnCutoff: "11:00",
};
function flight(overrides: Partial<FlightRecord> = {}): FlightRecord {
  return {
    id: "in", direction: "INBOUND", airline: "Swiss", flightNumber: "LX23", origin: "EWR", destination: "GVA",
    scheduledDeparture: new Date("2027-01-29T22:35:00Z"), scheduledArrival: new Date("2027-01-30T06:25:00Z"),
    terminal: null, source: "ORGANIZER", confirmedAt: new Date("2026-09-01T00:00:00Z"),
    supersededById: null, confirmedByGuest: true, ...overrides,
  };
}
function outbound(overrides: Partial<FlightRecord> = {}): FlightRecord {
  return flight({ id: "out", direction: "OUTBOUND", origin: "GVA", destination: "EWR",
    scheduledDeparture: new Date("2027-02-06T10:00:00Z"), scheduledArrival: new Date("2027-02-06T18:00:00Z"), ...overrides });
}
function guest(flights: FlightRecord[], id = "guest"): FlightGuest {
  return { id, firstName: id, lastName: "", displayName: id, flights };
}
function row(flights: FlightRecord[], overrides: Partial<FlightRules> = {}) {
  return buildFlightTable([guest(flights)], { ...rules, ...overrides })[0]!;
}

describe("flight table projection (pure fixtures)", () => {
  it("pairs the two directions and accepts the exact 11:00 return cutoff", () => {
    const result = row([outbound(), flight()]);
    expect(result.status).toBe("On the shuttle");
    expect(result.inbound?.id).toBe("in");
    expect(result.outbound?.id).toBe("out");
    expect(result.outbound?.departureLocal).toBe("2027-02-06T11:00:00+01:00");
  });
  it.each(["07:00:00", "07:15:00", "07:30:00"])("marks %s UTC (08:00–08:30 GVA) Tight", (time) => {
    expect(row([flight({ scheduledArrival: new Date(`2027-01-30T${time}Z`) }), outbound()]).status).toBe("Tight");
  });
  it("accepts the second before the tight window", () => {
    expect(row([flight({ scheduledArrival: new Date("2027-01-30T06:59:59Z") }), outbound()]).status).toBe("On the shuttle");
  });
  it("misses the shuttle one second after the arrival cutoff", () => {
    expect(row([flight({ scheduledArrival: new Date("2027-01-30T07:30:01Z") }), outbound()]).status).toBe("Misses the shuttle");
  });
  it("gives an early return departure priority over a tight arrival", () => {
    expect(row([flight({ scheduledArrival: new Date("2027-01-30T07:15:00Z") }),
      outbound({ scheduledDeparture: new Date("2027-02-06T09:59:59Z") })]).status).toBe("Misses the shuttle");
  });
  it("has a Not booked row with empty cells for a guest with no flights", () => {
    expect(row([])).toMatchObject({ status: "Not booked", inbound: null, outbound: null, arrivingFriday: false, arrivalMarker: null });
  });
  it.each([[flight()], [outbound()]])("keeps an incomplete safe pairing Not booked", (oneLeg) => {
    expect(row([oneLeg]).status).toBe("Not booked");
  });
  it("reports a known miss even if the other leg is missing", () => {
    expect(row([outbound({ scheduledDeparture: new Date("2027-02-06T09:00:00Z") })]).status).toBe("Misses the shuttle");
  });
  it("supports the source's overnight Thursday EWR → Friday GVA example", () => {
    const result = row([flight({ scheduledDeparture: new Date("2027-01-28T22:35:00Z"),
      scheduledArrival: new Date("2027-01-29T06:25:00Z") }), outbound()]);
    expect(result).toMatchObject({ status: "On the shuttle", arrivingFriday: true, arrivalMarker: "Arriving Friday" });
    expect(result.inbound?.departureLocal).toBe("2027-01-28T17:35:00-05:00");
    expect(result.inbound?.arrivalLocal).toBe("2027-01-29T07:25:00+01:00");
  });
  it("uses Geneva's calendar day for the Friday marker near UTC midnight", () => {
    expect(row([flight({ scheduledDeparture: new Date("2027-01-28T14:00:00Z"),
      scheduledArrival: new Date("2027-01-28T23:30:00Z") }), outbound()]).arrivingFriday).toBe(true);
  });
  it("does not confuse next-day Sunday morning with a Saturday arrival", () => {
    expect(row([flight({ scheduledArrival: new Date("2027-01-31T06:00:00Z") }), outbound()]).status).toBe("Misses the shuttle");
  });
  it("does not confuse a Friday departure with Saturday's return cutoff", () => {
    expect(row([flight(), outbound({ scheduledDeparture: new Date("2027-02-05T15:00:00Z") })]).status).toBe("Misses the shuttle");
  });
  it("excludes a superseded inbound even when it would be the first match", () => {
    const old = flight({ id: "old", supersededById: "in", scheduledArrival: new Date("2027-01-30T09:00:00Z") });
    expect(row([old, flight(), outbound()])).toMatchObject({ status: "On the shuttle", inbound: { id: "in" } });
    expect(row([old]).inbound).toBeNull();
  });
  it("excludes a superseded outbound that would otherwise miss the shuttle", () => {
    const old = outbound({ id: "old", supersededById: "out", scheduledDeparture: new Date("2027-02-06T09:00:00Z") });
    expect(row([flight(), old, outbound()])).toMatchObject({ status: "On the shuttle", outbound: { id: "out" } });
  });
  it.each(["INBOUND", "OUTBOUND"] as const)("excludes an unconfirmed %s before projection", (direction) => {
    const unconfirmed = direction === "INBOUND" ? flight({ confirmedByGuest: false }) : outbound({ confirmedByGuest: false });
    expect(row([unconfirmed])).toMatchObject({ status: "Not booked", inbound: null, outbound: null });
  });
  it("sorts by inbound arrival with unbooked guests last without mutating fixtures", () => {
    const guests = [guest([], "A"), guest([flight({ scheduledArrival: new Date("2027-01-30T07:00:00Z") })], "B"), guest([flight()], "C")];
    expect(buildFlightTable(guests, rules).map((item) => item.id)).toEqual(["C", "B", "A"]);
    expect(guests.map((item) => item.id)).toEqual(["A", "B", "C"]);
  });
  it("takes editable cutoffs from the queried trip", () => {
    expect(row([flight(), outbound()], { flightArrivalCutoff: "07:00" }).status).toBe("Misses the shuttle");
  });
  it("rejects a different arrival airport as a shuttle connection", () => {
    expect(row([flight({ destination: "CDG" }), outbound()]).status).toBe("Misses the shuttle");
  });
  it("fails loudly for an unknown airport on an active flight", () => {
    expect(() => row([flight({ origin: "ZZZ" })])).toThrow('Unknown IATA airport code "ZZZ"');
  });
});

describe("airport timezone map", () => {
  it("maps EWR and GVA explicitly", () => {
    expect(airportTimeZone("EWR")).toBe("America/New_York");
    expect(airportTimeZone("GVA")).toBe("Europe/Zurich");
  });
  it("uses the library's seasonal offsets, not a fixed six-hour difference", () => {
    const instant = new Date("2027-03-20T12:00:00Z");
    expect(airportLocalTime(instant, "EWR")).toBe("2027-03-20T08:00:00-04:00");
    expect(airportLocalTime(instant, "GVA")).toBe("2027-03-20T13:00:00+01:00");
  });
  it.each(["ZZZ", "toString", "__proto__"])("rejects unknown code %s without a fallback", (code) => {
    expect(() => airportTimeZone(code)).toThrow(`Unknown IATA airport code "${code}"`);
  });
});
