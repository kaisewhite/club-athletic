import { createId } from "@paralleldrive/cuid2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../../prisma/generated/client";
import type { ConversationScope } from "../repository.server";
import { isOperatorAuthorized } from "../operator-auth.server";

export const operatorEntityNames = [
  "trip", "property", "scheduleDay", "shuttle", "link", "note", "guest", "guestTask", "payment", "flight",
  "room", "spot", "flightRecommendation", "flightRecommendationOption",
] as const;
export type OperatorEntity = typeof operatorEntityNames[number];

const fields: Record<OperatorEntity, readonly string[]> = {
  trip: ["name", "destination", "resort", "startDate", "endDate", "timezone", "currency", "status", "chefBreakfastCount", "chefDinnerCount", "pricing", "flightArrivalCutoff", "flightArrivalTarget", "flightReturnCutoff"],
  property: ["name", "address", "lat", "lng", "mapsUrl", "sizeSquareMeters", "floorCount", "bedroomCount", "sleepsMin", "sleepsMax", "description", "externalListingUrls", "photos", "amenities"],
  scheduleDay: ["date", "dow", "dayNumber", "eventTitle", "eventDetail", "venue", "venueUrl", "breakfast", "dinner", "breakfastAt", "dinnerAt", "eventAt", "isOpen"],
  shuttle: ["direction", "seats", "departWindowStart", "departWindowEnd", "pickupLocation", "dropoffLocation", "durationMinutes", "driverContact", "notes"],
  link: ["group", "label", "href", "note", "sortOrder"],
  note: ["seedKey", "section", "title", "content"],
  guest: ["firstName", "lastName", "displayName", "instagramUrl", "email", "phone", "status", "dietaryNotes", "notes"],
  guestTask: ["type", "done", "completedAt", "notes"],
  payment: ["amount", "currency", "method", "paidAt", "reference", "status"],
  flight: ["direction", "airline", "flightNumber", "origin", "destination", "scheduledDeparture", "scheduledArrival", "terminal", "confirmationCode", "notes", "confirmedByGuest", "confirmedAt", "extractionConfidence"],
  room: ["name", "shortName", "type", "ensuite", "balcony", "description", "pricePerPerson", "sortOrder"],
  spot: ["index", "status", "priceOverride"],
  flightRecommendation: ["sortOrder", "title", "intro", "outro"],
  flightRecommendationOption: ["sortOrder", "route", "carrier", "departs", "arrives", "fitsShuttle", "note"],
};
const dateFields = new Set(["date", "departWindowStart", "departWindowEnd", "scheduledDeparture", "scheduledArrival", "paidAt", "completedAt", "confirmedAt", "startDate", "endDate"]);

type Delegate = { findUnique(args: unknown): Promise<Record<string, unknown> | null>; update(args: unknown): Promise<Record<string, unknown>> };
type OperatorDatabase = PrismaClient & Record<string, Delegate>;

async function withDatabase<T>(run: (db: OperatorDatabase) => Promise<T>) {
  const connectionString = process.env.DATABASE_URL_POOLED;
  if (!connectionString) throw new Error("DATABASE_URL_POOLED is required for operator updates.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 5_000 }) }) as unknown as OperatorDatabase;
  try { return await run(db); } finally { await db.$disconnect(); }
}

function jsonValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonValue(item)]));
  throw new Error("Operator update values must be JSON values.");
}

function normalizeChanges(entity: OperatorEntity, changes: Record<string, unknown>) {
  const allowed = new Set(fields[entity]);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (!allowed.has(key)) throw new Error(`The ${entity} field ${key} is not editable by the operator tool.`);
    if (dateFields.has(key)) {
      if (value === null && ["paidAt", "completedAt", "confirmedAt"].includes(key)) result[key] = null;
      else if (typeof value === "string" && Number.isFinite(Date.parse(value))) result[key] = new Date(value);
      else throw new Error(`The ${entity} field ${key} requires an ISO date/time.`);
    } else result[key] = jsonValue(value);
  }
  if (!Object.keys(result).length) throw new Error("At least one editable field is required.");
  return result;
}

async function findScopedRecord(db: OperatorDatabase, entity: OperatorEntity, id: string) {
  const delegate = (db as unknown as Record<string, Delegate>)[entity];
  if (!delegate) throw new Error("Unsupported operator entity.");
  const include: Record<string, unknown> = entity === "payment" || entity === "flight" || entity === "guestTask" ? { guest: { select: { tripId: true } } } :
    entity === "property" ? { trips: { select: { id: true } } } :
    entity === "room" ? { floor: { include: { property: { select: { tripId: true } } } } } :
    entity === "spot" ? { room: { include: { floor: { include: { property: { select: { tripId: true } } } } } } } :
    entity === "flightRecommendationOption" ? { recommendation: { select: { tripId: true } } } : {};
  return delegate.findUnique({ where: { id }, ...(Object.keys(include).length ? { include } : {}) });
}

function belongsToTrip(entity: OperatorEntity, row: Record<string, unknown>, tripId: string) {
  if (entity === "trip") return row.id === tripId;
  if (["payment", "flight", "guestTask"].includes(entity)) return (row.guest as Record<string, unknown> | undefined)?.tripId === tripId;
  if (entity === "room") return ((row.floor as Record<string, unknown> | undefined)?.property as Record<string, unknown> | undefined)?.tripId === tripId;
  if (entity === "spot") return ((((row.room as Record<string, unknown> | undefined)?.floor as Record<string, unknown> | undefined)?.property as Record<string, unknown> | undefined)?.tripId === tripId);
  if (entity === "flightRecommendationOption") return (row.recommendation as Record<string, unknown> | undefined)?.tripId === tripId;
  return row.tripId === tripId || (entity === "property" && Array.isArray(row.trips) && (row.trips as Record<string, unknown>[]).some(trip => trip.id === tripId));
}

export async function updateTripRecord(scope: ConversationScope, input: { entity: OperatorEntity; id: string; changes: Record<string, unknown> }) {
  if (!await isOperatorAuthorized(scope)) throw new Error("Operator authorization is required before making database updates.");
  return withDatabase(async (db) => {
    const existing = await findScopedRecord(db, input.entity, input.id);
    if (!existing || !belongsToTrip(input.entity, existing, scope.tripId)) throw new Error("That record was not found in this trip.");
    const data = normalizeChanges(input.entity, input.changes);
    const updated = await (db as unknown as Record<string, Delegate>)[input.entity]!.update({ where: { id: input.id }, data });
    await db.auditLog.create({ data: {
      id: createId(), action: "OPERATOR_UPDATE", entity: input.entity, entityId: input.id, source: "ORGANIZER",
      conversationId: scope.conversationId, before: JSON.parse(JSON.stringify(existing)), after: JSON.parse(JSON.stringify(updated)),
    } });
    return { entity: input.entity, id: input.id, updated: JSON.parse(JSON.stringify(updated)) };
  });
}
