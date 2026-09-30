import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Flight, type Guest, type Message, type PendingExtraction, type Prisma } from "../../../prisma/generated/client";

export type GuestIdentity = Pick<Guest, "id" | "tripId" | "firstName" | "lastName" | "displayName">;
export type IntakeMessage = Pick<Message, "id" | "conversationId" | "role" | "content" | "seq" | "payload">;
export type FlightInsert = Pick<Flight, "id" | "guestId" | "direction" | "airline" | "flightNumber" |
  "origin" | "destination" | "scheduledDeparture" | "scheduledArrival" | "confirmationCode" |
  "source" | "uploadId" | "confirmedByGuest" | "confirmedAt" | "extractionConfidence"> & {
    rawExtraction: Prisma.InputJsonValue;
  };
export type GuestInsert = GuestIdentity & { status: "INVITED"; createdVia: "AGENT" };
export type AuditInsert = {
  id: string; action: "INSERT" | "SUPERSEDE"; entity: "Guest" | "Flight";
  entityId: string; conversationId: string; claimedGuestName: string; source: "AGENT";
  before?: Prisma.InputJsonValue; after: Prisma.InputJsonValue;
};

/** Method-level capability IS the enforcement boundary: no raw SQL, itinerary
 * update, guest update, or delete is exposed to domain code, and this module stays
 * separate from the read helpers so the import graph shows the write surface. */
export interface FlightWriteTransaction {
  lock(key: string): Promise<void>;
  getPending(id: string): Promise<PendingExtraction | null>;
  getConversation(id: string): Promise<{ id: string; tripId: string } | null>;
  getMessage(id: string): Promise<IntakeMessage | null>;
  hasUserMessageAfter(conversationId: string, afterSeq: number, beforeSeq?: number): Promise<boolean>;
  getUpload(id: string): Promise<{ conversationId: string; purpose: string } | null>;
  listGuests(tripId: string): Promise<GuestIdentity[]>;
  createGuest(data: GuestInsert): Promise<GuestIdentity>;
  currentFlight(guestId: string, direction: "INBOUND" | "OUTBOUND"): Promise<Flight | null>;
  supersedeFlight(id: string, replacementId: string, at: Date): Promise<void>;
  createFlight(data: FlightInsert): Promise<{ id: string }>;
  createAudit(data: AuditInsert): Promise<void>;
  consumePending(id: string, version: number, toolCallId: string, flightIds: string[], at: Date): Promise<boolean>;
  setCreatedGuest(id: string, version: number, guestId: string): Promise<boolean>;
}
export interface FlightWriteDatabase {
  transaction<T>(write: (tx: FlightWriteTransaction) => Promise<T>): Promise<T>;
}
export type WithFlightWriteDatabase = <T>(write: (db: FlightWriteDatabase) => Promise<T>) => Promise<T>;

const guestSelect = { id: true, tripId: true, firstName: true, lastName: true, displayName: true } as const;

function transactionCapability(tx: Prisma.TransactionClient): FlightWriteTransaction {
  return {
    async lock(key) {
      // Parameterized, transaction-scoped locks; hash collisions only serialize extra work.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
    },
    async getPending(id) {
      // The bookkeeping writer takes this same row lock when changing a pending
      // version/confirmation. Advisory locks alone do not coordinate with it.
      await tx.$queryRaw`SELECT "id" FROM "PendingExtraction" WHERE "id" = ${id} FOR UPDATE`;
      return tx.pendingExtraction.findUnique({ where: { id } });
    },
    getConversation: (id) => tx.conversation.findUnique({ where: { id }, select: { id: true, tripId: true } }),
    getMessage: (id) => tx.message.findUnique({ where: { id }, select: { id: true, conversationId: true, role: true, content: true, seq: true, payload: true } }),
    async hasUserMessageAfter(conversationId, afterSeq, beforeSeq) {
      return !!await tx.message.findFirst({ where: { conversationId, role: "user", seq: { gt: afterSeq, ...(beforeSeq === undefined ? {} : { lt: beforeSeq }) } }, select: { id: true } });
    },
    getUpload: (id) => tx.upload.findUnique({ where: { id }, select: { conversationId: true, purpose: true } }),
    listGuests: (tripId) => tx.guest.findMany({ where: { tripId }, select: guestSelect }),
    createGuest: (data) => tx.guest.create({ data, select: guestSelect }),
    currentFlight: (guestId, direction) => tx.flight.findFirst({ where: { guestId, direction, supersededById: null } }),
    async supersedeFlight(id, replacementId, at) {
      await tx.flight.update({ where: { id }, data: { supersededById: replacementId, supersededAt: at } });
    },
    createFlight: (data) => tx.flight.create({ data, select: { id: true } }),
    async createAudit(data) { await tx.auditLog.create({ data }); },
    async consumePending(id, version, toolCallId, flightIds, at) {
      const result = await tx.pendingExtraction.updateMany({
        where: { id, version, consumedAt: null },
        data: { consumedAt: at, phase: "committed", toolCallId, committedFlightIds: flightIds },
      });
      return result.count === 1;
    },
    async setCreatedGuest(id, version, guestId) {
      const result = await tx.pendingExtraction.updateMany({
        where: { id, version, consumedAt: null, createdGuestId: null },
        data: { createdGuestId: guestId, guestId },
      });
      return result.count === 1;
    },
  };
}

/** Per-call ownership follows the existing read client's finally/disconnect pattern,
 * on the one pooled connection string that helper already uses. */
export const withFlightWriteDatabase: WithFlightWriteDatabase = async (write) => {
  const connectionString = process.env.DATABASE_URL_POOLED;
  if (!connectionString) throw new Error("DATABASE_URL_POOLED is required for flight writes.");
  const db = new PrismaClient({ adapter: new PrismaPg({
    connectionString, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 5_000,
  }) });
  try {
    return await write({ transaction: (operation) => db.$transaction(
      (tx) => operation(transactionCapability(tx)), { maxWait: 10_000, timeout: 20_000 },
    ) });
  } finally {
    await db.$disconnect();
  }
};
