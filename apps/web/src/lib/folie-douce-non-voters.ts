import { matchGuestCandidates } from "./db/guest-lookup.server";
import type { GuestIdentity } from "./db/flight-write-client.server";

export type FolieDouceGuest = { firstName: string; lastName: string; displayName: string };
export type FolieDouceVoteName = { firstName: string; lastName: string };

export function getFolieDouceNonVoters(
  guests: readonly FolieDouceGuest[], votes: readonly FolieDouceVoteName[],
): FolieDouceGuest[] {
  const identities: GuestIdentity[] = guests.map((guest, index) => ({
    id: String(index), tripId: "", ...guest,
  }));
  const votedGuestIndexes = new Set<number>();
  for (const vote of votes) {
    const candidates = matchGuestCandidates(identities, vote.firstName, vote.lastName);
    if (candidates.length === 1) votedGuestIndexes.add(Number(candidates[0]!.id));
  }
  return guests.filter((_, index) => !votedGuestIndexes.has(index));
}
