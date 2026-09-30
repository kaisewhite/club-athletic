import { z } from "zod";
import * as reads from "../../db/repository.server";
import { withReadDatabase } from "../../db/client.server";
import { matchGuestCandidates } from "../../db/guest-lookup.server";
import { publicText } from "../runtime/public-frame.server";
import { logChatFailure } from "../runtime/chat-debug.server";
export const TRIP_FALLBACK =
  "That's not in the trip notes yet — ask the organizer.";
export const noArguments = z.strictObject({});
export const guestNameSchema = z.strictObject({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).nullable(),
});

/** The sole additional trip queries are SELECT projections through the existing
 * read credential. Never expose a query string or arbitrary table to a tool. */
export async function listTripGuests() {
  return withReadDatabase(
    async (db) =>
      (
        await db.trip.findUniqueOrThrow({
          where: { seedKey: "meribel-2027" },
          select: {
            guests: {
              take: 100,
              orderBy: { id: "asc" },
              select: {
                id: true,
                tripId: true,
                firstName: true,
                lastName: true,
                displayName: true,
              },
            },
          },
        })
      ).guests,
  );
}
export async function getNotes() {
  return withReadDatabase(
    async (db) =>
      (
        await db.trip.findUniqueOrThrow({
          where: { seedKey: "meribel-2027" },
          select: {
            notes: {
              take: 50,
              orderBy: { id: "asc" },
              select: { section: true, title: true, content: true },
            },
          },
        })
      ).notes,
  );
}
/** The booking deadline a guest actually has to satisfy, as its own projection.
 * It lives on Trip, but it was only ever reachable folded inside getTripOverview
 * and getFlightTable, so "what time do I need to land?" was being answered from
 * the shuttle departure window — a guest booking to land at 10:30 arrives as the
 * bus leaves. The deadline is a first-class read with its own tool. */
export async function getFlightRules() {
  return withReadDatabase(async (db) => {
    const trip = await db.trip.findUniqueOrThrow({
      where: { seedKey: "meribel-2027" },
      select: {
        name: true,
        startDate: true,
        endDate: true,
        timezone: true,
        flightArrivalCutoff: true,
        flightArrivalTarget: true,
        flightReturnCutoff: true,
        shuttles: {
          orderBy: { direction: "asc" },
          select: {
            direction: true,
            pickupLocation: true,
            dropoffLocation: true,
          },
        },
      },
    });
    const inbound = trip.shuttles.find((s) => s.direction === "INBOUND");
    const outbound = trip.shuttles.find((s) => s.direction === "OUTBOUND");
    return {
      tripName: trip.name,
      // Named off the shuttle's own pickup/dropoff rather than hard-coded, so
      // the airport cannot drift from the row the shuttle is booked against.
      airport: inbound?.pickupLocation ?? outbound?.dropoffLocation ?? null,
      timezone: trip.timezone,
      arrivalDate: trip.startDate,
      departureDate: trip.endDate,
      /** All three are local airport times in `timezone`. */
      landByLatest: trip.flightArrivalCutoff,
      landByTarget: trip.flightArrivalTarget,
      returnDepartNoEarlierThan: trip.flightReturnCutoff,
      ifLaterThanLandByLatest:
        `A flight landing after ${trip.flightArrivalCutoff} on the arrival date misses the group shuttle, ` +
        "so that guest has to arrange and pay for their own transfer to the chalet.",
      ifEarlierThanReturnCutoff:
        `A return flight departing before ${trip.flightReturnCutoff} on the departure date cannot be reached by the group shuttle, ` +
        "so that guest has to arrange their own transfer to the airport.",
    };
  });
}
const privateKey =
  /booking|confirmationCode|rawExtraction|secret|password|token|credential|email|phone|emergency|fileId|mountPath|sessionResource|error/i;
/** Bound recursively AND globally; do not let nested rooms/notes defeat row caps. */
export function boundTripData(value: unknown): unknown {
  let budget = 18000;
  const visit = (item: unknown, depth: number): unknown => {
    if (budget <= 0 || depth > 8) return null;
    budget -= 8;
    if (item === null || typeof item === "boolean" || typeof item === "number")
      return item;
    if (item instanceof Date) return item.toISOString();
    if (typeof item === "string") {
      const text = publicText(item).slice(
        0,
        Math.min(1200, Math.max(0, budget)),
      );
      budget -= text.length * 2;
      return text;
    }
    if (Array.isArray(item))
      return item.slice(0, 50).map((v) => visit(v, depth + 1));
    if (typeof item === "object" && item) {
      if ("toJSON" in item && typeof item.toJSON === "function") {
        return visit(item.toJSON(), depth + 1);
      }
      const result: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(item).slice(0, 40)) {
        if (budget <= 0) break;
        if (!privateKey.test(key)) {
          budget -= key.length * 2;
          result[key] = visit(v, depth + 1);
        }
      }
      return result;
    }
    return null;
  };
  const result = visit(value, 0);
  return JSON.stringify(result).length <= 24000 ? result : { truncated: true };
}
export const readSections = {
  getTripOverview: "Chalet",
  getSchedule: "Events",
  getFlightRules: "Flights",
  getFlightTable: "Flights",
  getFlightRecommendations: "Flights",
  getShuttles: "Shuttle",
  getProperty: "Chalet",
  getRoomsByFloor: "Rooms",
  getOpenSpots: "Remaining spots",
  getChefSummary: "Chef",
  getGuestTasks: "Tasks",
  getLinks: "Links",
  getNotes: "Trip notes",
} as const;
type ReadName = keyof typeof readSections;
type ReadFunctions = Record<ReadName, () => Promise<unknown>>;
/** Two tools sit one word apart in a guest's head — "when do I have to land" and
 * "when does the bus go" — and the generic template made them indistinguishable.
 * Each of these says what it answers AND which neighbour it is not. */
const readDescriptions: Partial<Record<ReadName, string>> = {
  getFlightRules:
    "THE authoritative flight booking rules, and the required tool for any question about when a guest must land or when they may fly home: " +
    "'what time do I need to land', 'how late can I arrive', 'when is the cutoff', 'what time can I fly home', 'does this flight work'. " +
    "Returns the latest landing time, the earlier time to aim for, the earliest return departure, the airport, the trip dates, and what happens to a guest outside those limits. " +
    "The landing deadline is EARLIER than the shuttle departure window, so never answer a landing or return question from getShuttles.",
  getShuttles:
    "Read the booked group shuttle coaches only: the window in which the bus itself departs, its pickup and dropoff points, duration, seats and driver note. " +
    "This is when the BUS leaves, NOT when a guest's plane has to land — for a landing deadline or a return-flight time use getFlightRules instead.",
  getFlightRecommendations:
    "Read the organizer's flight recommendations: suggested nonstop NYC ↔ Geneva flights with rough times, the fly-in-a-day-early option, and which suggestions fall outside the shuttle window. " +
    "Guidance only — for the binding landing and return cutoffs use getFlightRules.",
  getFlightTable:
    "Read the per-guest flight table: which guests have submitted flights, their legs, and each guest's computed on-time status. " +
    "This is who is booked on what, NOT the booking deadline itself — for the cutoff times use getFlightRules.",
};
export function createReadTools(overrides: Partial<ReadFunctions> = {}) {
  const functions: ReadFunctions = {
    ...reads,
    getNotes,
    getFlightRules,
    ...overrides,
  };
  return Object.entries(readSections).map(([name, sourceSection]) => ({
    name,
    description:
      readDescriptions[name as ReadName] ??
      `Read bounded ${sourceSection} data from the trip database. Return its source section; never invent missing facts.`,
    schema: noArguments,
    async run(input: unknown): Promise<string> {
      if (!noArguments.safeParse(input).success)
        return JSON.stringify({
          ok: false,
          sourceSection,
          message: TRIP_FALLBACK,
        });
      try {
        return JSON.stringify({
          ok: true,
          sourceSection,
          data: boundTripData(await functions[name as ReadName]()),
        });
      } catch (error) {
        // The innermost catch on the read path. It sits inside tool.run, so the
        // runner's own logging never sees a read failure — unlogged, a broken
        // read is indistinguishable from a fact the trip simply does not have.
        // The operator gets the cause; the guest still gets only TRIP_FALLBACK.
        logChatFailure("readTool.run", error, { tool: name, sourceSection });
        return JSON.stringify({
          ok: false,
          sourceSection,
          message: TRIP_FALLBACK,
        });
      }
    },
  }));
}
export async function lookupTripGuest(input: z.infer<typeof guestNameSchema>) {
  return matchGuestCandidates(
    await listTripGuests(),
    input.firstName,
    input.lastName ?? "",
  );
}
