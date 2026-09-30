import { createId } from "@paralleldrive/cuid2";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { PendingExtraction, Prisma } from "../../../prisma/generated/client";
import { airportTimeZone } from "./airport-timezones";
import { flightExtractionSchema, isAffirmativeFlightConfirmation, isExplicitGuestCreationConsent, matchesIntakeReadback, type FlightCandidate } from "./flight-contract";
import { matchGuestCandidates, normalizeGuestName } from "./guest-lookup.server";
import { withFlightWriteDatabase, type FlightWriteTransaction, type IntakeMessage, type WithFlightWriteDatabase } from "./flight-write-client.server";

export class FlightWriteRefusal extends Error {}
function requireThat(value: unknown, message: string): asserts value {
  if (!value) throw new FlightWriteRefusal(message);
}
const json = (value: object): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

export type FlightWriteDependencies = { withDatabase?: WithFlightWriteDatabase; now?: () => Date; createId?: () => string };
type PendingInput = { conversationId: string; pendingExtractionId: string; version: number };
export type RecordFlightInput = PendingInput & { guestId: string | null; confirmedByGuest: boolean | null; toolCallId: string };

/** Parse an explicit local calendar date/time and reject DST gaps and folds.
 * The reviewed airport map contains one-hour DST transitions; examine both
 * neighboring offsets instead of accepting date-fns-tz's arbitrary fold choice. */
export function resolveFlightLocalTime(date: string | null, time: string | null, airport: string): Date {
  requireThat(date && /^\d{4}-\d{2}-\d{2}$/.test(date), "An explicit flight date is required.");
  requireThat(time && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time), "An explicit 24-hour flight time is required.");
  const calendar = new Date(`${date}T00:00:00.000Z`);
  requireThat(Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 10) === date, "Flight date is invalid.");
  let zone: string;
  try { zone = airportTimeZone(airport); } catch { throw new FlightWriteRefusal("The airport timezone needs clarification."); }
  const local = `${date}T${time}:00`;
  const proposed = fromZonedTime(local, zone);
  requireThat(Number.isFinite(proposed.getTime()), "Flight time is invalid.");
  const matches: Date[] = [];
  for (let minutes = -120; minutes <= 120; minutes += 15) {
    const candidate = new Date(proposed.getTime() + minutes * 60_000);
    if (formatInTimeZone(candidate, zone, "yyyy-MM-dd'T'HH:mm:ss") === local) matches.push(candidate);
  }
  requireThat(matches.length === 1, "Flight time is nonexistent or ambiguous; clarify the exact time.");
  return matches[0];
}

async function pendingFor(tx: FlightWriteTransaction, input: PendingInput): Promise<PendingExtraction> {
  requireThat(input.conversationId.trim() && input.pendingExtractionId.trim() && Number.isInteger(input.version) && input.version > 0, "Invalid pending extraction identity.");
  await tx.lock(`flight-pending:${input.pendingExtractionId}`);
  const pending = await tx.getPending(input.pendingExtractionId);
  requireThat(pending && pending.conversationId === input.conversationId, "Pending extraction does not belong to this conversation.");
  requireThat(pending.version === input.version, "The extraction changed; confirm the current version.");
  return pending;
}

async function linkedMessage(tx: FlightWriteTransaction, id: string | null, conversationId: string, role: string): Promise<IntakeMessage> {
  requireThat(id, "A persisted confirmation message is required.");
  const message = await tx.getMessage(id);
  requireThat(message && message.conversationId === conversationId && message.role === role, "Confirmation message does not match this conversation or role.");
  return message;
}

async function confirmedName(tx: FlightWriteTransaction, pending: PendingExtraction) {
  requireThat(pending.claimedFirstName && pending.claimedFirstName.trim() && pending.claimedLastName !== null, "Confirm the guest's first and last name first.");
  const firstName = pending.claimedFirstName.trim();
  const lastName = pending.claimedLastName.trim();
  const message = await linkedMessage(tx, pending.nameMessageId, pending.conversationId, "user");
  const full = normalizeGuestName(`${firstName} ${lastName}`);
  requireThat(full && ` ${normalizeGuestName(message.content)} `.includes(` ${full} `), "The guest must state the claimed name in a user message.");
  return { firstName, lastName, message, claimedGuestName: `${firstName} ${lastName}`.trim() };
}

function completedLeg(candidate: FlightCandidate) {
  requireThat(candidate.direction && candidate.flightNumber && candidate.origin && candidate.destination, "Direction, flight number and airports are required.");
  requireThat(candidate.origin !== candidate.destination, "Flight airports must differ.");
  const scheduledDeparture = resolveFlightLocalTime(candidate.departureDate, candidate.departureTime, candidate.origin);
  const scheduledArrival = resolveFlightLocalTime(candidate.arrivalDate, candidate.arrivalTime, candidate.destination);
  requireThat(scheduledArrival > scheduledDeparture, "Arrival must be after departure.");
  return { ...candidate, direction: candidate.direction, flightNumber: candidate.flightNumber,
    origin: candidate.origin, destination: candidate.destination, scheduledDeparture, scheduledArrival };
}

export async function recordFlight(input: RecordFlightInput, deps: FlightWriteDependencies = {}) {
  requireThat(input.guestId?.trim() && input.confirmedByGuest === true && input.toolCallId.trim(), "Resolved guest, confirmation and tool call identity are required.");
  const guestId = input.guestId;
  const now = (deps.now ?? (() => new Date()))();
  const allocateId = deps.createId ?? createId;
  return (deps.withDatabase ?? withFlightWriteDatabase)((db) => db.transaction(async (tx) => {
    // User-message inserts share this lock: a correction either precedes this
    // confirmation check or follows the fully committed write.
    await tx.lock(`flight-confirmation:${input.conversationId}`);
    const pending = await pendingFor(tx, input);
    requireThat(pending.guestId === guestId, "The resolved guest changed; confirm the current guest.");
    if (pending.consumedAt) {
      requireThat(pending.toolCallId === input.toolCallId && Array.isArray(pending.committedFlightIds) &&
        pending.committedFlightIds.length > 0 && pending.committedFlightIds.every((id) => typeof id === "string"), "This extraction was already consumed.");
      return { flightIds: pending.committedFlightIds as string[], duplicate: true };
    }
    requireThat(pending.expiresAt > now, "This flight confirmation expired.");
    requireThat(pending.phase === "confirmed" && pending.readbackVersion === input.version && pending.confirmedAt && pending.confirmedAt <= now && !pending.outstandingQuestion,
      "Read back and confirm the current flight version before saving.");
    const name = await confirmedName(tx, pending);
    const readback = await linkedMessage(tx, pending.readbackMessageId, input.conversationId, "assistant");
    requireThat(matchesIntakeReadback(readback.payload, pending.id, input.version), "The assistant read-back must reference this exact extraction version.");
    const confirmation = await linkedMessage(tx, pending.confirmationMessageId, input.conversationId, "user");
    requireThat(readback.seq > name.message.seq && confirmation.seq > readback.seq && isAffirmativeFlightConfirmation(confirmation.content), "An affirmative guest message after the read-back is required.");
    requireThat(!await tx.hasUserMessageAfter(input.conversationId, readback.seq, confirmation.seq) &&
      !await tx.hasUserMessageAfter(input.conversationId, confirmation.seq), "A newer guest message requires a fresh read-back and confirmation.");
    const conversation = await tx.getConversation(input.conversationId);
    requireThat(conversation, "Conversation is missing.");
    const matches = matchGuestCandidates(await tx.listGuests(conversation.tripId), name.firstName, name.lastName);
    requireThat(matches.length === 1 && matches[0].id === guestId, "The claimed guest name needs disambiguation.");
    requireThat(name.lastName || matches[0].lastName === "", "Confirm the guest's last name before saving.");
    requireThat(pending.uploadId, "A flight confirmation upload is required.");
    const upload = await tx.getUpload(pending.uploadId);
    requireThat(upload?.conversationId === input.conversationId && upload.purpose === "FLIGHT_CONFIRMATION", "The upload is not a flight confirmation owned by this conversation.");
    const parsed = flightExtractionSchema.safeParse(pending.flightCandidates);
    requireThat(parsed.success, "The pending extraction is invalid.");
    const candidates = parsed.data.legs;
    requireThat(candidates?.length && candidates.every((leg) => leg.selectedForTrip !== null), "Select the trip-relevant flight legs first.");
    const selected = candidates.filter((leg) => leg.selectedForTrip);
    requireThat(selected.length >= 1 && selected.length <= 2, "Select one inbound and/or one outbound flight.");
    const legs = selected.map(completedLeg).sort((a, b) => a.direction.localeCompare(b.direction));
    requireThat(new Set(legs.map((leg) => leg.direction)).size === legs.length, "Multiple flights in one direction need clarification.");
    // Preallocate every replacement ID before changing history. Sorted lock order
    // serializes concurrent rebookings without opposite-direction deadlocks.
    const replacements = legs.map((leg) => ({ leg, id: allocateId() }));
    for (const { leg } of replacements) await tx.lock(`flight:${guestId}:${leg.direction}`);
    for (const { leg, id } of replacements) {
      const old = await tx.currentFlight(guestId, leg.direction);
      if (old) {
        // The migration makes this self-FK deferred. Updating first preserves the
        // partial live-flight unique index, which must never be disabled.
        await tx.supersedeFlight(old.id, id, now);
        await tx.createAudit({ id: allocateId(), action: "SUPERSEDE", entity: "Flight", entityId: old.id,
          conversationId: input.conversationId, claimedGuestName: name.claimedGuestName, source: "AGENT",
          before: json(old), after: json({ ...old, supersededById: id, supersededAt: now }) });
      }
      const data = { id, guestId, direction: leg.direction, airline: leg.airline, flightNumber: leg.flightNumber,
        origin: leg.origin, destination: leg.destination, scheduledDeparture: leg.scheduledDeparture, scheduledArrival: leg.scheduledArrival,
        confirmationCode: leg.bookingReference, source: "AGENT_EXTRACTION" as const, uploadId: pending.uploadId,
        confirmedByGuest: true, confirmedAt: pending.confirmedAt, extractionConfidence: leg.confidence,
        rawExtraction: json(parsed.data) };
      await tx.createFlight(data);
      await tx.createAudit({ id: allocateId(), action: "INSERT", entity: "Flight", entityId: id,
        conversationId: input.conversationId, claimedGuestName: name.claimedGuestName, source: "AGENT", after: json(data) });
    }
    const flightIds = replacements.map(({ id }) => id);
    requireThat(await tx.consumePending(pending.id, input.version, input.toolCallId, flightIds, now), "The pending extraction changed during saving.");
    return { flightIds, duplicate: false };
  }));
}

export async function createGuestFromAgent(input: PendingInput, deps: FlightWriteDependencies = {}) {
  const now = (deps.now ?? (() => new Date()))();
  const allocateId = deps.createId ?? createId;
  return (deps.withDatabase ?? withFlightWriteDatabase)((db) => db.transaction(async (tx) => {
    await tx.lock(`flight-confirmation:${input.conversationId}`);
    const pending = await pendingFor(tx, input);
    const name = await confirmedName(tx, pending);
    requireThat(name.lastName, "A new guest requires a confirmed first and last name.");
    const consent = await linkedMessage(tx, pending.guestCreationConsentMessageId, input.conversationId, "user");
    requireThat(consent.seq > name.message.seq && isExplicitGuestCreationConsent(consent.content), "Explicit consent to add a guest is required.");
    const conversation = await tx.getConversation(input.conversationId);
    requireThat(conversation, "Conversation is missing.");
    await tx.lock(`guest-create:${conversation.tripId}`);
    const guests = await tx.listGuests(conversation.tripId);
    if (pending.createdGuestId) {
      const existing = guests.find((guest) => guest.id === pending.createdGuestId);
      requireThat(existing && existing.id === pending.guestId, "The previously created guest is missing.");
      return { guest: existing, duplicate: true };
    }
    requireThat(!await tx.hasUserMessageAfter(input.conversationId, name.message.seq, consent.seq) &&
      !await tx.hasUserMessageAfter(input.conversationId, consent.seq), "Confirm the guest name and creation consent again after the newer guest message.");
    requireThat(!pending.consumedAt && pending.expiresAt > now, "This pending extraction is consumed or expired.");
    requireThat(!pending.guestId && matchGuestCandidates(guests, name.firstName, name.lastName).length === 0, "A matching guest already exists; resolve that guest first.");
    const data = { id: allocateId(), tripId: conversation.tripId, firstName: name.firstName, lastName: name.lastName,
      displayName: name.claimedGuestName, status: "INVITED" as const, createdVia: "AGENT" as const };
    const guest = await tx.createGuest(data);
    await tx.createAudit({ id: allocateId(), action: "INSERT", entity: "Guest", entityId: guest.id,
      conversationId: input.conversationId, claimedGuestName: name.claimedGuestName, source: "AGENT", after: json(data) });
    requireThat(await tx.setCreatedGuest(pending.id, input.version, guest.id), "The pending extraction changed during guest creation.");
    return { guest, duplicate: false };
  }));
}
