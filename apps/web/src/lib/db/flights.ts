import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { Guest, Prisma, Trip } from "../../../prisma/generated/client";
import { airportLocalTime, airportTimeZone } from "./airport-timezones";

/** Explicit public projection: booking references and raw extraction stay private. */
export const flightSelect = {
  id: true, direction: true, airline: true, flightNumber: true,
  origin: true, destination: true, scheduledDeparture: true, scheduledArrival: true,
  terminal: true, source: true, confirmedAt: true,
  supersededById: true, confirmedByGuest: true,
} satisfies Prisma.FlightSelect;

export type FlightRecord = Prisma.FlightGetPayload<{ select: typeof flightSelect }>;
export type FlightRules = Pick<Trip,
  "startDate" | "endDate" | "timezone" | "flightArrivalTarget" | "flightArrivalCutoff" | "flightReturnCutoff"
>;
export type FlightGuest = Pick<Guest, "id" | "firstName" | "lastName" | "displayName"> & {
  flights: readonly FlightRecord[];
};
export type FlightStatus = "On the shuttle" | "Tight" | "Misses the shuttle" | "Not booked";
export type FlightLeg = FlightRecord & { departureLocal: string; arrivalLocal: string };
export type FlightTableRow = Omit<FlightGuest, "flights"> & {
  inbound: FlightLeg | null;
  outbound: FlightLeg | null;
  status: FlightStatus;
  arrivingFriday: boolean;
  arrivalMarker: "Arriving Friday" | null;
};

function cutoff(date: Date, time: string, timezone: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`Invalid flight cutoff: ${time}`);
  // Prisma @db.Date values are calendar dates represented at UTC midnight.
  const instant = fromZonedTime(`${date.toISOString().slice(0, 10)}T${time}:00`, timezone).getTime();
  if (!Number.isFinite(instant)) throw new Error(`Invalid trip flight timezone: ${timezone}`);
  return instant;
}

function leg(flight: FlightRecord | undefined): FlightLeg | null {
  if (!flight) return null;
  if (flight.scheduledArrival.getTime() < flight.scheduledDeparture.getTime()) {
    throw new Error(`Flight ${flight.id} arrives before it departs.`);
  }
  return {
    ...flight,
    departureLocal: airportLocalTime(flight.scheduledDeparture, flight.origin),
    arrivalLocal: airportLocalTime(flight.scheduledArrival, flight.destination),
  };
}

/** Pure projection shared by the read query and fixture tests. No database IO. */
export function buildFlightTable(guests: readonly FlightGuest[], rules: FlightRules): FlightTableRow[] {
  const arrivalTarget = cutoff(rules.startDate, rules.flightArrivalTarget, rules.timezone);
  const arrivalCutoff = cutoff(rules.startDate, rules.flightArrivalCutoff, rules.timezone);
  const returnCutoff = cutoff(rules.endDate, rules.flightReturnCutoff, rules.timezone);
  const previousDay = new Date(rules.startDate);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const friday = previousDay.toISOString().slice(0, 10);

  return guests.map(({ flights, ...guest }): FlightTableRow => {
    // Defense in depth: the query also filters both provenance fields.
    const current = flights.filter((flight) => flight.supersededById === null && flight.confirmedByGuest);
    const inbound = leg(current.find((flight) => flight.direction === "INBOUND"));
    const outbound = leg(current.find((flight) => flight.direction === "OUTBOUND"));
    const arrivingFriday = inbound !== null && inbound.destination === "GVA" &&
      formatInTimeZone(inbound.scheduledArrival, airportTimeZone("GVA"), "yyyy-MM-dd") === friday;
    let status: FlightStatus;
    // A known missed connection wins even when the other direction is unbooked.
    if ((inbound && (inbound.destination !== "GVA" || inbound.scheduledArrival.getTime() > arrivalCutoff)) ||
        (outbound && (outbound.origin !== "GVA" || outbound.scheduledDeparture.getTime() < returnCutoff))) {
      status = "Misses the shuttle";
    } else if (!inbound || !outbound) {
      status = "Not booked";
    } else if (inbound.scheduledArrival.getTime() >= arrivalTarget) {
      // Both endpoints of the 08:00–08:30 window are included.
      status = "Tight";
    } else {
      status = "On the shuttle";
    }
    return { ...guest, inbound, outbound, status, arrivingFriday, arrivalMarker: arrivingFriday ? "Arriving Friday" : null };
  }).sort((a, b) => {
    const aTime = a.inbound?.scheduledArrival.getTime() ?? Infinity;
    const bTime = b.inbound?.scheduledArrival.getTime() ?? Infinity;
    return (aTime === bTime ? 0 : aTime < bTime ? -1 : 1) ||
      a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id);
  });
}
