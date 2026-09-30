import type { GuestIdentity } from "./flight-write-client.server";

export function normalizeGuestName(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-US")
    .replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Exact full-name candidates take priority; partial/middle-name matches stay ambiguous. */
export function matchGuestCandidates(
  guests: readonly GuestIdentity[], firstName: string, lastName: string,
): GuestIdentity[] {
  const first = normalizeGuestName(firstName);
  const last = normalizeGuestName(lastName);
  if (!first) return [];
  const exact = guests.filter((guest) => normalizeGuestName(guest.firstName) === first &&
    normalizeGuestName(guest.lastName) === last);
  if (exact.length) return exact;
  return guests.filter((guest) => {
    const guestFirst = normalizeGuestName(guest.firstName);
    const guestLast = normalizeGuestName(guest.lastName);
    // A supplied middle name does not invent a different guest. A missing surname
    // intentionally returns every first-name candidate, including both Kristys.
    const firstMatch = guestFirst === first || guestFirst.split(" ")[0] === first.split(" ")[0];
    return firstMatch && (!last || guestLast === last || `${guestFirst} ${guestLast}` === `${first} ${last}`);
  });
}

export type GuestLookupDatabase = { listGuests(tripId: string): Promise<GuestIdentity[]> };
export function findGuestByName(db: GuestLookupDatabase, tripId: string, firstName: string, lastName = "") {
  return db.listGuests(tripId).then((guests) => matchGuestCandidates(guests, firstName, lastName));
}
