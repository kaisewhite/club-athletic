import { formatInTimeZone } from "date-fns-tz";

/** Hand-maintained D14 scope: Geneva, the source's Newark example, and a small
 * US/EU origin set. Extend explicitly when a guest books an unlisted airport. */
export const AIRPORT_TIMEZONES = Object.freeze({
  GVA: "Europe/Zurich",
  EWR: "America/New_York",
  JFK: "America/New_York",
  BOS: "America/New_York",
  // Group return legs on the flight sheet (owner, 2026-09-29).
  IAD: "America/New_York",
  MIA: "America/New_York",
  LHR: "Europe/London",
  CDG: "Europe/Paris",
  FRA: "Europe/Berlin",
} as const);

export function airportTimeZone(iata: string): string {
  const code = iata.trim().toUpperCase();
  if (!Object.hasOwn(AIRPORT_TIMEZONES, code)) {
    throw new Error(`Unknown IATA airport code "${iata}": add an explicit IANA timezone mapping.`);
  }
  return AIRPORT_TIMEZONES[code as keyof typeof AIRPORT_TIMEZONES];
}

/** Flight timestamps are already instants (timestamptz), never local strings. */
export function airportLocalTime(instant: Date, iata: string): string {
  return formatInTimeZone(instant, airportTimeZone(iata), "yyyy-MM-dd'T'HH:mm:ssXXX");
}
