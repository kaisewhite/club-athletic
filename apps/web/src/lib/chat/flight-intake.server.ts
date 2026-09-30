import { createHash } from "node:crypto";
import type { PendingExtraction } from "../../../prisma/generated/client";
import * as writes from "../db/chat-writes.server";
import * as reads from "./repository.server";
import { withChatReadDatabase } from "../db/chat-client.server";
import {
  recordFlight,
  createGuestFromAgent,
  resolveFlightLocalTime,
} from "../db/flight-writes.server";
import {
  flightExtractionSchema,
  isAffirmativeFlightConfirmation,
  isExplicitGuestCreationConsent,
} from "../db/flight-contract";
import { airportTimeZone } from "../db/airport-timezones";
import {
  matchGuestCandidates,
  normalizeGuestName,
} from "../db/guest-lookup.server";
import type {
  GuestIdentity,
  IntakeMessage,
} from "../db/flight-write-client.server";
import {
  recordFlightSchema,
  type RecordFlightArguments,
} from "./tools/flight-schema";
import { listTripGuests, TRIP_UNAVAILABLE } from "./tools/read-tools.server";
import { conversationEventRelay } from "./runtime/event-relay.server";
import { logChatFailure } from "./runtime/chat-debug.server";
import { publicText } from "./runtime/public-frame.server";
import { uploadService, withUploadDeadline } from "./upload.server";

type Scope = reads.ConversationScope;
type IntakeWrites = Pick<
  typeof writes,
  | "promoteFlightConfirmationUpload"
  | "savePendingExtraction"
  | "recordClaimedGuestName"
  | "recordIntakeReadback"
  | "confirmPendingExtraction"
  | "expirePendingExtraction"
  | "insertConversationEventAllocating"
>;
export interface IntakeDependencies {
  writes: IntakeWrites;
  now(): Date;
  loadPending: typeof reads.loadPendingExtraction;
  findPending(
    scope: Scope,
    uploadId: string,
  ): Promise<PendingExtraction | null>;
  loadUpload: typeof reads.loadUpload;
  latestGuestMessage(scope: Scope): Promise<IntakeMessage | null>;
  loadReceipt(scope: Scope, key: string): Promise<{ payload: unknown } | null>;
  listGuests(): Promise<GuestIdentity[]>;
  recordFlight: typeof recordFlight;
  createGuest: typeof createGuestFromAgent;
  publish(row: writes.InsertConversationEventResult): void;
  cleanup(scope: Scope, uploadId: string, signal: AbortSignal): Promise<void>;
}
export interface IntakeResult {
  committed: boolean;
  phase: string;
  pendingExtractionId?: string;
  version?: number;
  followUp?: string;
  candidates?: { firstName: string; lastName: string; displayName: string }[];
  flightIds?: string[];
  href?: string;
}
const refusal = (
  followUp: string,
  pending?: PendingExtraction,
): IntakeResult => ({
  committed: false,
  phase: pending?.phase ?? "collecting",
  ...(pending
    ? { pendingExtractionId: pending.id, version: pending.version }
    : {}),
  followUp,
});
class FollowUp extends Error {}
function requireThat(condition: unknown, question: string): asserts condition {
  if (!condition) throw new FollowUp(question);
}
const extractionDigest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function ambiguousDirections(candidates: unknown) {
  const legs = flightExtractionSchema.parse(candidates).legs ?? [];
  return ["INBOUND", "OUTBOUND"].filter(
    (direction) => legs.filter((leg) => leg.direction === direction).length > 1,
  );
}
function explicitSegmentChoice(candidates: unknown, content: string): boolean {
  const directions = ambiguousDirections(candidates);
  if (!directions.length) return true;
  const legs = flightExtractionSchema.parse(candidates).legs!;
  const selected = legs.filter(
    (leg) => leg.selectedForTrip && directions.includes(leg.direction ?? ""),
  );
  if (
    selected.length !== directions.length ||
    selected.some((leg) => !leg.flightNumber)
  )
    return false;
  // Conservative, guest-authored selection. Merely setting selectedForTrip in
  // model output is never evidence that the guest chose among alternatives.
  const answer = content
    .trim()
    .replace(/[.!]+$/, "")
    .toUpperCase()
    .match(/^(?:PLEASE )?(?:USE|RECORD|SELECT) (.+)$/)?.[1];
  if (!answer) return false;
  const choices = answer
    .split(/\s*(?:,| AND )\s*/)
    .map((s) => s.trim().replace(/^FLIGHT /, ""));
  return (
    choices.length === selected.length &&
    selected.every((leg) => {
      const number = leg.flightNumber!.toUpperCase();
      const repeated =
        legs.filter(
          (candidate) =>
            candidate.direction === leg.direction &&
            candidate.flightNumber === leg.flightNumber,
        ).length > 1;
      return (
        choices.includes(`${number} ON ${leg.departureDate}`) ||
        (!repeated && choices.includes(number))
      );
    })
  );
}
const selectionQuestion =
  "There are multiple candidates in one direction. Which should be recorded? Reply 'Use LX23' with the chosen flight number (and departure date if numbers repeat).";

/** Validate for readback using exactly the writer's timezone conversion. Missing
 * fields and ambiguous local dates are questions, never inferred instants. */
export function flightFollowUp(candidates: unknown): string | null {
  const parsed = flightExtractionSchema.safeParse(candidates);
  if (!parsed.success || !parsed.data.legs?.length)
    return "Please provide the flight details from a flight confirmation.";
  const legs = parsed.data.legs;
  if (legs.some((l) => l.selectedForTrip === null))
    return "Which segments are the trip-relevant inbound and outbound flights?";
  const selected = legs.filter((l) => l.selectedForTrip);
  if (!selected.length) return "Which flight should be recorded for this trip?";
  if (selected.some((l) => !l.direction))
    return "Is this flight inbound or outbound for the trip?";
  if (
    selected.length > 2 ||
    new Set(selected.map((l) => l.direction)).size !== selected.length
  )
    return "There are multiple flights in one direction. Which one should be recorded for this trip?";
  for (const leg of selected) {
    if (!leg.flightNumber) return "What is the missing flight number?";
    if (!leg.origin || !leg.destination)
      return "What are the departure and arrival airport codes?";
    if (leg.origin === leg.destination)
      return "Please clarify the distinct departure and arrival airports.";
    try {
      airportTimeZone(leg.origin);
      airportTimeZone(leg.destination);
    } catch {
      return "The airport timezone is not in the reviewed map. Please clarify the airport with the organizer; I cannot guess its timezone.";
    }
    if (!leg.departureDate || !leg.arrivalDate)
      return "What are the exact departure and arrival dates (YYYY-MM-DD)?";
    if (!leg.departureTime || !leg.arrivalTime)
      return "What are the local departure and arrival times (HH:mm)?";
    try {
      const dep = resolveFlightLocalTime(
        leg.departureDate,
        leg.departureTime,
        leg.origin,
      );
      const arr = resolveFlightLocalTime(
        leg.arrivalDate,
        leg.arrivalTime,
        leg.destination,
      );
      if (arr <= dep)
        return "Please clarify the dates and times: arrival must follow departure.";
    } catch {
      return "Please clarify the exact local dates and times; the supplied time is invalid or ambiguous.";
    }
  }
  return null;
}
function readbackText(p: PendingExtraction): string {
  const { legs } = flightExtractionSchema.parse(p.flightCandidates);
  // Group carrier/number so the public six-character booking-reference filter
  // does not obscure a legitimate flight number such as LX1234.
  const text =
    `For ${`${p.claimedFirstName} ${p.claimedLastName}`.trim()}:\n` +
    legs!
      .filter((l) => l.selectedForTrip)
      .map(
        (l) =>
          `${l.direction}: ${l.airline ?? ""} ${l.flightNumber?.replace(/^([A-Z]{2,3}|[A-Z]\d|\d[A-Z])(\d{1,4})$/, "$1 $2")}, ${l.origin} ${l.departureDate} ${l.departureTime} (${airportTimeZone(l.origin!)}) → ${l.destination} ${l.arrivalDate} ${l.arrivalTime} (${airportTimeZone(l.destination!)}).`,
      )
      .join("\n") +
    "\nAre these details correct? Reply yes to confirm, or tell me what to change.";
  requireThat(
    publicText(text) === text,
    "Please clarify the name or flight details for the read-back; a private or redacted value cannot be confirmed.",
  );
  return text;
}

export function createFlightIntake(deps: IntakeDependencies) {
  async function transition(
    a: RecordFlightArguments,
    ctx: { scope: Scope; toolCallId: string; signal: AbortSignal },
  ): Promise<IntakeResult> {
    const { scope, toolCallId, signal } = ctx;
    signal.throwIfAborted();
    let p = a.pendingExtractionId
      ? await deps.loadPending(scope, a.pendingExtractionId)
      : null;
    if (a.pendingExtractionId)
      requireThat(
        p,
        "Please restart this flight intake in its original conversation.",
      );
    if (p) {
      if (a.version !== p.version)
        return refusal(
          "The flight details changed. Use this current version, read it back and confirm again.",
          p,
        );
      if (p.consumedAt) {
        requireThat(
          a.action === "commit" && p.toolCallId === toolCallId,
          "This intake was already recorded; upload a new confirmation to rebook.",
        );
        const saved = await deps.recordFlight({
          conversationId: scope.conversationId,
          pendingExtractionId: p.id,
          version: p.version,
          guestId: p.guestId,
          confirmedByGuest: true,
          toolCallId,
        });
        return {
          committed: true,
          phase: "committed",
          pendingExtractionId: p.id,
          version: p.version,
          flightIds: saved.flightIds,
          href: "/flights",
        };
      }
      if (p.expiresAt <= deps.now() || p.phase === "expired") {
        await deps.writes.expirePendingExtraction({
          conversationId: scope.conversationId,
          pendingExtractionId: p.id,
        });
        return {
          ...refusal(
            "This intake expired after 24 hours. Please upload a new confirmation.",
            p,
          ),
          phase: "expired",
        };
      }
    }
    const uploadId = p?.uploadId ?? a.uploadId;
    requireThat(uploadId, "Please attach a flight confirmation first.");
    const upload = await deps.loadUpload(scope, uploadId);
    requireThat(
      upload &&
        upload.conversationId === scope.conversationId &&
        upload.status === "mounted" &&
        !upload.deletedFromAnthropicAt,
      "Please attach an available flight confirmation in this conversation.",
    );
    const now = deps.now();
    requireThat(
      upload.uploadedAt.getTime() + 86400000 > now.getTime(),
      "This attachment expired. Please upload a new confirmation.",
    );
    const base = () => ({
      conversationId: scope.conversationId,
      pendingExtractionId: p!.id,
      version: p!.version,
    });
    if (a.action === "extract" || a.action === null) {
      requireThat(
        a.documentKind === "flight_confirmation",
        "That doesn't look like a flight confirmation — want me to just answer a question instead?",
      );
      const candidates = flightExtractionSchema.parse({ legs: a.legs });
      const latest = await deps.latestGuestMessage(scope);
      const selected =
        latest && explicitSegmentChoice(candidates, latest.content);
      const followUp =
        flightFollowUp(candidates) ??
        (ambiguousDirections(candidates).length && !selected
          ? selectionQuestion
          : "What is your first and last name? A name printed on the image is not a name claim.");
      signal.throwIfAborted();
      await deps.writes.promoteFlightConfirmationUpload({
        conversationId: scope.conversationId,
        uploadId,
      });
      // Recover an interrupted initial stage without allocating a second intake.
      if (!p) {
        const existing = await deps.findPending(scope, uploadId);
        if (existing) {
          requireThat(
            !existing.consumedAt && existing.expiresAt > now,
            "Please upload a new confirmation for a new intake.",
          );
          requireThat(
            JSON.stringify(existing.flightCandidates) ===
              JSON.stringify(candidates),
            "Resume the existing intake with its pendingExtractionId and version before correcting it.",
          );
          return refusal(
            flightFollowUp(existing.flightCandidates) ?? followUp,
            existing,
          );
        }
      }
      p = await deps.writes.savePendingExtraction({
        conversationId: scope.conversationId,
        uploadId,
        flightCandidates: candidates,
        ...(p ? { pendingExtractionId: p.id, version: p.version } : {}),
        outstandingQuestion: followUp,
        expiresAt: new Date(now.getTime() + 86400000),
      });
      if (selected && latest && ambiguousDirections(candidates).length)
        await deps.writes.insertConversationEventAllocating({
          conversationId: scope.conversationId,
          type: "intake_selection",
          providerEventKey: `intake-selection:${p.id}:${extractionDigest(candidates)}`,
          payload: { messageId: latest.id },
        });
      return refusal(followUp, p);
    }
    requireThat(p, "Extract and stage the flight confirmation first.");
    if (a.legs !== null)
      requireThat(
        JSON.stringify(a.legs) ===
          JSON.stringify(flightExtractionSchema.parse(p.flightCandidates).legs),
        "Submit corrections with extract before confirming or committing.",
      );
    const latest = await deps.latestGuestMessage(scope);
    requireThat(
      latest &&
        latest.conversationId === scope.conversationId &&
        latest.role === "user",
      "A persisted guest reply is required.",
    );
    if (a.action === "identify") {
      requireThat(
        a.firstName !== null && a.lastName !== null,
        "Please state your first and last name; an existing mononym may use an empty last name.",
      );
      const matches = matchGuestCandidates(
        await deps.listGuests(),
        a.firstName,
        a.lastName,
      );
      const consent = isExplicitGuestCreationConsent(latest.content);
      const sameClaim =
        p.claimedFirstName === a.firstName &&
        p.claimedLastName === a.lastName &&
        p.nameMessageId;
      const name = normalizeGuestName(`${a.firstName} ${a.lastName}`);
      requireThat(
        (consent && sameClaim) ||
          ` ${normalizeGuestName(latest.content)} `.includes(` ${name} `),
        "Please type your own name in a guest message; the image's passenger name is not identity evidence.",
      );
      requireThat(
        matches.length !== 1 ||
          a.lastName !== "" ||
          matches[0]!.lastName === "",
        "Please provide your last name before I attach these flights to a guest.",
      );
      signal.throwIfAborted();
      p = await deps.writes.recordClaimedGuestName({
        ...base(),
        firstName: a.firstName,
        lastName: a.lastName,
        messageId: consent && sameClaim ? p.nameMessageId! : latest.id,
        ...(matches.length === 1 ? { guestId: matches[0]!.id } : {}),
        ...(consent && sameClaim
          ? { guestCreationConsentMessageId: latest.id }
          : {}),
      });
      if (matches.length > 1)
        return {
          ...refusal("Which guest is this? Please state the full name.", p),
          candidates: matches.map(({ firstName, lastName, displayName }) => ({
            firstName,
            lastName,
            displayName,
          })),
        };
      if (!matches.length) {
        if (!consent)
          return refusal(
            "You are not on the confirmed guest list. May I add you as an invited guest? Reply 'Please add me' to consent.",
            p,
          );
        const missing = flightFollowUp(p.flightCandidates);
        if (missing) return refusal(missing, p);
        signal.throwIfAborted();
        const created = await deps.createGuest(base());
        p = {
          ...p,
          guestId: created.guest.id,
          createdGuestId: created.guest.id,
        };
      }
      return refusal(
        flightFollowUp(p.flightCandidates) ??
          "Read back these exact flights and wait for the guest's yes.",
        p,
      );
    }
    const missing = flightFollowUp(p.flightCandidates);
    if (missing) return refusal(missing, p);
    if (ambiguousDirections(p.flightCandidates).length) {
      const choice = await deps.loadReceipt(
        scope,
        `intake-selection:${p.id}:${extractionDigest(p.flightCandidates)}`,
      );
      if (!choice) return refusal(selectionQuestion, p);
    }
    requireThat(
      p.guestId &&
        p.nameMessageId &&
        p.claimedFirstName &&
        p.claimedLastName !== null,
      "Please confirm your name and resolve the matching guest before reading back flights.",
    );
    if (a.action === "readback") {
      signal.throwIfAborted();
      const row = await deps.writes.insertConversationEventAllocating({
        conversationId: scope.conversationId,
        type: "message",
        providerEventKey: `intake-readback:${p.id}:${p.version}`,
        payload: {
          text: readbackText(p),
          intakeReadback: { pendingExtractionId: p.id, version: p.version },
        },
      });
      p = await deps.writes.recordIntakeReadback({
        ...base(),
        messageId: row.id,
      });
      deps.publish(row);
      return refusal(
        "The exact read-back is in the conversation. Wait for the guest's affirmative reply; do not claim it was saved.",
        p,
      );
    }
    if (a.action === "confirm") {
      requireThat(
        isAffirmativeFlightConfirmation(latest.content),
        "Please confirm the read-back with yes, or provide corrections.",
      );
      signal.throwIfAborted();
      p = await deps.writes.confirmPendingExtraction({
        ...base(),
        messageId: latest.id,
      });
      return refusal(
        "The server confirmed this exact version. Call commit to record it.",
        p,
      );
    }
    requireThat(
      a.action === "commit" && a.confirmedByGuest === true,
      "Explicit flight confirmation is required.",
    );
    requireThat(
      p.phase === "confirmed" &&
        p.confirmationMessageId &&
        p.confirmedAt &&
        p.readbackVersion === p.version,
      "REFUSAL TO COMMIT: confirm the persisted exact read-back with an affirmative guest message first.",
    );
    signal.throwIfAborted();
    const saved = await deps.recordFlight({
      ...base(),
      guestId: p.guestId,
      confirmedByGuest: true,
      toolCallId,
    });
    // Deletion is independently retryable; it never undoes or repeats a commit.
    try {
      await deps.cleanup(scope, uploadId, signal);
    } catch {
      /* Retained Upload identities permit the existing cleanup retry. */
    }
    return {
      committed: true,
      phase: "committed",
      pendingExtractionId: p.id,
      version: p.version,
      flightIds: saved.flightIds,
      href: "/flights",
    };
  }
  return {
    async run(
      input: unknown,
      ctx: { scope: Scope; toolCallId: string; signal: AbortSignal },
    ): Promise<IntakeResult> {
      try {
        ctx.signal.throwIfAborted();
        const parsed = recordFlightSchema.safeParse(input);
        if (!parsed.success)
          return refusal(
            "Please supply the nullable flight contract; unsupported fields are not accepted.",
          );
        requireThat(
          ctx.toolCallId.trim(),
          "A provider tool-call identity is required.",
        );
        const key = `flight-intake:${ctx.toolCallId}`;
        const digest = createHash("sha256")
          .update(JSON.stringify(parsed.data))
          .digest("hex");
        const receipt = await deps.loadReceipt(ctx.scope, key);
        if (receipt) {
          const payload = receipt.payload as {
            digest?: string;
            result?: IntakeResult;
          };
          requireThat(
            payload.digest === digest && payload.result,
            "This tool call was already processed with different arguments.",
          );
          return payload.result;
        }
        const result = await transition(parsed.data, ctx);
        await deps.writes.insertConversationEventAllocating({
          conversationId: ctx.scope.conversationId,
          type: "intake_operation",
          providerEventKey: key,
          payload: { digest, result },
        });
        return result;
      } catch (error) {
        if (ctx.signal.aborted) throw ctx.signal.reason;
        if (!(error instanceof FollowUp))
          logChatFailure("flightIntake.run", error, {
            conversationId: ctx.scope.conversationId,
            requestId: ctx.toolCallId,
          });
        return refusal(
          error instanceof FollowUp ? error.message : TRIP_UNAVAILABLE,
        );
      }
    },
  };
}

export function flightIntakeDependencies(): IntakeDependencies {
  return {
    writes,
    now: () => new Date(),
    loadPending: reads.loadPendingExtraction,
    loadUpload: reads.loadUpload,
    findPending: (scope, uploadId) =>
      withChatReadDatabase((db) =>
        db.pendingExtraction.findFirst({
          where: {
            conversationId: scope.conversationId,
            conversation: { tripId: scope.tripId },
            uploadId,
          },
        }),
      ),
    latestGuestMessage: (scope) =>
      withChatReadDatabase((db) =>
        db.message.findFirst({
          where: {
            conversationId: scope.conversationId,
            conversation: { tripId: scope.tripId },
            role: "user",
          },
          orderBy: { seq: "desc" },
          select: {
            id: true,
            conversationId: true,
            role: true,
            content: true,
            seq: true,
            payload: true,
          },
        }),
      ),
    loadReceipt: (scope, key) =>
      withChatReadDatabase((db) =>
        db.message.findFirst({
          where: {
            conversationId: scope.conversationId,
            conversation: { tripId: scope.tripId },
            providerEventKey: key,
          },
          select: { payload: true },
        }),
      ),
    listGuests: listTripGuests,
    recordFlight,
    createGuest: createGuestFromAgent,
    publish: (row) =>
      conversationEventRelay.publish(row.conversationId, row.seq, row),
    cleanup: async (scope, uploadId, signal) => {
      const [upload, state] = await Promise.all([
        reads.loadUpload(scope, uploadId),
        reads.loadConversationChatState(scope),
      ]);
      if (upload && state?.agentSessionId)
        await withUploadDeadline(signal, 30000, (s) =>
          uploadService()
            .cleanup(upload, state.agentSessionId!, s)
            .then(() => {}),
        );
    },
  };
}
