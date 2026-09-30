import { vi } from "vitest";
import { createChatWrites } from "../../../src/lib/db/chat-writes.server";
import {
  recordFlight,
  createGuestFromAgent,
} from "../../../src/lib/db/flight-writes.server";
import type { ChatDatabase } from "../../../src/lib/db/chat-client.server";
import type {
  FlightWriteTransaction,
  WithFlightWriteDatabase,
} from "../../../src/lib/db/flight-write-client.server";
import type { IntakeDependencies } from "../../../src/lib/chat/flight-intake.server";
import type { RecordFlightArguments } from "../../../src/lib/chat/tools/flight-schema";
export const NOW = new Date("2026-09-26T12:00:00Z");
export const scope = { conversationId: "c", tripId: "trip" };
export const inbound = {
  direction: "INBOUND" as const,
  selectedForTrip: true,
  airline: "Swiss",
  flightNumber: "LX23",
  origin: "EWR",
  destination: "GVA",
  departureDate: "2027-01-29",
  departureTime: "17:35",
  arrivalDate: "2027-01-30",
  arrivalTime: "07:25",
  bookingReference: "PRIVATE",
  visiblePassengerName: "Image Name",
  confidence: 0.9,
};
export const outbound = {
  ...inbound,
  direction: "OUTBOUND" as const,
  origin: "GVA",
  destination: "EWR",
  departureDate: "2027-02-06",
  departureTime: "11:00",
  arrivalDate: "2027-02-06",
  arrivalTime: "15:00",
};
export const args = (
  change: Partial<RecordFlightArguments> = {},
): RecordFlightArguments => ({
  action: "extract",
  documentKind: "flight_confirmation",
  uploadId: "upload",
  pendingExtractionId: null,
  version: null,
  firstName: null,
  lastName: null,
  confirmedByGuest: null,
  legs: [inbound, outbound],
  ...change,
});
type Row = Record<string, any>; // Database fake only: exercises real transaction helpers.
export function intakeHarness() {
  let now = NOW;
  const tables: Record<string, Row[]> = {
    conversation: [{ id: "c", tripId: "trip", nextEventSeq: 0 }],
    message: [],
    upload: [
      {
        id: "upload",
        conversationId: "c",
        purpose: "OTHER",
        status: "mounted",
        uploadedAt: NOW,
        mimeType: "image/webp",
        sizeBytes: 100,
        fileId: "original",
        mountedFileId: "mounted",
        sessionResourceId: "resource",
        mountPath: "/upload.webp",
        deletedFromAnthropicAt: null,
      },
    ],
    pendingExtraction: [],
    guest: [
      {
        id: "guest",
        tripId: "trip",
        firstName: "Kaise",
        lastName: "",
        displayName: "Kaise",
      },
    ],
    flight: [],
    auditLog: [],
  };
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (key === "conversation")
        return matches(
          tables.conversation.find((c) => c.id === row.conversationId)!,
          value,
        );
      if (value && typeof value === "object" && !(value instanceof Date))
        return Object.entries(value).every(([op, v]) =>
          op === "gt"
            ? row[key] > v!
            : op === "lt"
              ? row[key] < v!
              : op === "not"
                ? row[key] !== v
                : row[key] === v,
        );
      return row[key] === value;
    });
  const tx: Row = { $queryRaw: async () => [] };
  const defaults = {
    phase: "collecting",
    version: 1,
    claimedFirstName: null,
    claimedLastName: null,
    guestId: null,
    nameMessageId: null,
    readbackVersion: null,
    readbackMessageId: null,
    confirmationMessageId: null,
    confirmedAt: null,
    toolCallId: null,
    committedFlightIds: null,
    consumedAt: null,
    guestCreationConsentMessageId: null,
    createdGuestId: null,
    outstandingQuestion: null,
  };
  for (const name of Object.keys(tables))
    tx[name] = {
      findFirst: async ({ where, orderBy }: Row) => {
        const found = tables[name]!.filter((row) => matches(row, where));
        if (orderBy?.seq)
          found.sort((a, b) =>
            orderBy.seq === "desc" ? b.seq - a.seq : a.seq - b.seq,
          );
        return found[0] ? structuredClone(found[0]) : null;
      },
      create: async ({ data }: Row) => {
        const row = {
          ...(name === "pendingExtraction" ? defaults : {}),
          ...data,
        };
        tables[name]!.push(row);
        return structuredClone(row);
      },
      update: vi.fn(async ({ where, data }: Row) => {
        const row = tables[name]!.find((r) => matches(r, where));
        if (!row) throw new Error("missing row");
        for (const [key, value] of Object.entries(data))
          row[key] =
            value && typeof value === "object" && "increment" in value
              ? row[key] + value.increment
              : value;
        return structuredClone(row);
      }),
    };
  const transaction = async <T>(run: () => Promise<T>) => {
    const before = structuredClone(tables);
    try {
      return await run();
    } catch (e) {
      for (const key of Object.keys(tables)) tables[key] = before[key]!;
      throw e;
    }
  };
  const writes = createChatWrites(
    {
      ...tx,
      $transaction: async (run: (t: Row) => Promise<unknown>) =>
        transaction(() => run(tx)),
    } as unknown as ChatDatabase,
    () => now,
  );
  let ids = 0;
  let auditCount = 0;
  const options = { failAuditAt: 0 };
  const withDatabase: WithFlightWriteDatabase = async (run) =>
    run({
      transaction: async (operation) =>
        transaction(async () => {
          const capability: FlightWriteTransaction = {
            lock: async () => {},
            getPending: async (id) =>
              await tx.pendingExtraction.findFirst({ where: { id } }),
            getConversation: async (id) =>
              await tx.conversation.findFirst({ where: { id } }),
            getMessage: async (id) =>
              await tx.message.findFirst({ where: { id } }),
            hasUserMessageAfter: async (c, after, before) =>
              tables.message!.some(
                (m) =>
                  m.conversationId === c &&
                  m.role === "user" &&
                  m.seq > after &&
                  (before === undefined || m.seq < before),
              ),
            getUpload: async (id) =>
              await tx.upload.findFirst({ where: { id } }),
            listGuests: async () => tables.guest as any,
            createGuest: async (data) => {
              tables.guest!.push(data);
              return data;
            },
            currentFlight: async (g, d) =>
              (tables.flight!.find(
                (f) =>
                  f.guestId === g && f.direction === d && !f.supersededById,
              ) as any) ?? null,
            supersedeFlight: async (id, replacement, at) => {
              Object.assign(
                tables.flight!.find((f) => f.id === id)!,
                { supersededById: replacement, supersededAt: at },
              );
            },
            createFlight: async (data) => {
              if (
                tables.flight!.some(
                  (f) =>
                    f.guestId === data.guestId &&
                    f.direction === data.direction &&
                    !f.supersededById,
                )
              )
                throw new Error("partial unique index");
              tables.flight!.push({
                ...data,
                supersededById: null,
                supersededAt: null,
              });
              return { id: data.id };
            },
            createAudit: async (data) => {
              if (++auditCount === options.failAuditAt)
                throw new Error("audit failure");
              tables.auditLog!.push(data);
            },
            consumePending: async (id, version, toolCallId, flightIds, at) => {
              const row = tables.pendingExtraction!.find(
                (p) => p.id === id && p.version === version && !p.consumedAt,
              );
              if (!row) return false;
              Object.assign(row, {
                consumedAt: at,
                phase: "committed",
                toolCallId,
                committedFlightIds: flightIds,
              });
              return true;
            },
            setCreatedGuest: async (id, version, guestId) => {
              const row = tables.pendingExtraction!.find(
                (p) => p.id === id && p.version === version && !p.consumedAt,
              );
              if (!row) return false;
              Object.assign(row, { guestId, createdGuestId: guestId });
              return true;
            },
          };
          const result = await operation(capability);
          if (
            tables.flight!.some(
              (f) =>
                f.supersededById &&
                !tables.flight!.some((n) => n.id === f.supersededById),
            )
          )
            throw new Error("deferred FK");
          return result;
        }),
    });
  const deps: IntakeDependencies = {
    writes,
    now: () => now,
    loadPending: async (_s, id) =>
      await tx.pendingExtraction.findFirst({
        where: { id, conversationId: "c" },
      }),
    findPending: async (_s, uploadId) =>
      await tx.pendingExtraction.findFirst({
        where: { conversationId: "c", uploadId },
      }),
    loadUpload: async (_s, id) =>
      await tx.upload.findFirst({ where: { id, conversationId: "c" } }),
    latestGuestMessage: async () =>
      await tx.message.findFirst({
        where: { conversationId: "c", role: "user" },
        orderBy: { seq: "desc" },
      }),
    loadReceipt: async (_s, key) =>
      await tx.message.findFirst({
        where: { conversationId: "c", providerEventKey: key },
      }),
    listGuests: async () => tables.guest as any,
    recordFlight: vi.fn((input) =>
      recordFlight(input, {
        withDatabase,
        now: () => now,
        createId: () => `f-${++ids}`,
      }),
    ),
    createGuest: (input) =>
      createGuestFromAgent(input, {
        withDatabase,
        now: () => now,
        createId: () => `g-${++ids}`,
      }),
    publish: vi.fn(),
    cleanup: vi.fn(async () => {}),
  };
  const user = async (text: string) =>
    writes.appendUserMessage({
      conversationId: "c",
      text,
      requestId: `user-${tables.message!.length}`,
    });
  return {
    tables,
    deps,
    writes,
    user,
    options,
    setNow: (date: Date) => {
      now = date;
    },
    get pending() {
      return tables.pendingExtraction![0]!;
    },
  };
}
