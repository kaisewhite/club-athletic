import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createChatWrites } from "../../src/lib/db/chat-writes.server";
import type { ChatDatabase } from "../../src/lib/db/chat-client.server";

const now = new Date("2026-09-26T12:00:00Z");
const tomorrow = new Date("2026-09-27T12:00:00Z");
type Row = Record<string, unknown>;
type Tables = Record<"conversation" | "upload" | "message" | "pendingExtraction", Row[]>;

// A rollback-capable in-memory seam, not evidence of PostgreSQL locks, grants,
// unique constraints or provider deletion. Each scenario calls the real helpers.
function harness() {
  let tables: Tables = {
    conversation: [{ id: "conversation", tripId: "trip", nextEventSeq: 0 }, { id: "other", tripId: "trip", nextEventSeq: 0 }],
    upload: [], message: [], pendingExtraction: [],
  };
  const matches = (row: Row, where: Row): boolean => Object.entries(where).every(([key, value]) => {
    if (typeof value === "object" && value !== null) {
      const range = value as { gt?: number; lt?: number };
      const actual = row[key];
      return typeof actual === "number" && (range.gt === undefined || actual > range.gt) && (range.lt === undefined || actual < range.lt);
    }
    return row[key] === value;
  });
  function delegate(table: keyof Tables) {
    return {
      findFirst: vi.fn(async ({ where }: { where: Row }) => tables[table].find(row => matches(row, where)) ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const defaults = table === "upload" ? {
          mountedFileId: null, sessionResourceId: null, mountPath: null,
          originalFileDeletedAt: null, mountedFileDeletedAt: null, sessionResourceDeletedAt: null,
          deletedFromAnthropicAt: null, processedAt: null, extractionResult: null,
        } : table === "pendingExtraction" ? {
          phase: "collecting", version: 1, claimedFirstName: null, claimedLastName: null, guestId: null,
          nameMessageId: null, readbackVersion: null, readbackMessageId: null, confirmationMessageId: null,
          confirmedAt: null, toolCallId: null, committedFlightIds: null, consumedAt: null,
          guestCreationConsentMessageId: null, createdGuestId: null, outstandingQuestion: null,
        } : {};
        const row = { ...defaults, ...data };
        tables[table].push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = tables[table].find(candidate => matches(candidate, where));
        if (!row) throw new Error("Fixture row missing");
        for (const [key, value] of Object.entries(data)) {
          row[key] = typeof value === "object" && value !== null && "increment" in value
            ? Number(row[key]) + Number(value.increment) : value;
        }
        return row;
      }),
    };
  }
  const tx = {
    conversation: delegate("conversation"), upload: delegate("upload"),
    message: delegate("message"), pendingExtraction: delegate("pendingExtraction"),
    $queryRaw: vi.fn(async (_query: TemplateStringsArray, ..._values: unknown[]) => []),
  };
  const db = { ...tx, $transaction: async (operation: (transaction: typeof tx) => Promise<unknown>) => {
    const before = structuredClone(tables);
    try { return await operation(tx); } catch (error) { tables = before; throw error; }
  } };
  const writes = createChatWrites(db as unknown as ChatDatabase, () => now);
  return { writes, get tables() { return tables; }, tx };
}

const uploadInput = {
  conversationId: "conversation", bytes: new TextEncoder().encode("original bytes"),
  originalFilename: "booking.pdf", mimeType: "application/pdf", sizeBytes: 14,
  purpose: "FLIGHT_CONFIRMATION" as const,
};
async function reserved(h: ReturnType<typeof harness>) {
  return h.writes.createUploadRecord(uploadInput);
}
async function staged(h: ReturnType<typeof harness>) {
  const upload = await reserved(h);
  const extraction = await h.writes.savePendingExtraction({
    conversationId: "conversation", uploadId: upload.id, flightCandidates: { legs: null },
    outstandingQuestion: "What is your first and last name?", expiresAt: tomorrow,
  });
  return { conversationId: "conversation", pendingExtractionId: extraction.id, version: extraction.version, uploadId: upload.id };
}
function addMessage(h: ReturnType<typeof harness>, id: string, role: string, seq: number, content: string, conversationId = "conversation", payload: Row = {}) {
  h.tables.message.push({ id, role, seq, content, conversationId, payload });
}

describe("upload bookkeeping and ownership", () => {
  it("reserves by original-byte hash, dedupes renamed files, and rejects cross-conversation reuse", async () => {
    const h = harness();
    const first = await reserved(h);
    expect(first).toMatchObject({ status: "pending", fileId: null, sha256: createHash("sha256").update(uploadInput.bytes).digest("hex") });
    const again = await h.writes.createUploadRecord({ ...uploadInput, originalFilename: "renamed.pdf" });
    expect(again.id).toBe(first.id);
    await expect(h.writes.createUploadRecord({ ...uploadInput, conversationId: "other" })).rejects.toThrow("cannot be attached here");
    expect(h.tables.upload).toHaveLength(1);
    const different = await h.writes.createUploadRecord({ ...uploadInput, bytes: new TextEncoder().encode("new bytes") });
    expect(different.id).not.toBe(first.id);
  });

  it("recovers partial resource attachment without changing any known provider identity", async () => {
    const h = harness(); const upload = await reserved(h);
    const identity = { conversationId: "conversation", uploadId: upload.id, fileId: "original" };
    expect(await h.writes.attachUploadResource(identity)).toMatchObject({ status: "uploaded", mountedFileId: null });
    await expect(h.writes.appendUserMessage({ conversationId: "conversation", uploadId: upload.id, requestId: "send", text: "Booking" })).rejects.toThrow("not available");
    await expect(h.writes.attachUploadResource({ ...identity, conversationId: "other" })).rejects.toThrow("unavailable");
    await expect(h.writes.attachUploadResource({ ...identity, fileId: "replacement" })).rejects.toThrow("identity cannot change");
    expect(await h.writes.attachUploadResource({ ...identity, mountedFileId: "mounted", sessionResourceId: "resource", mountPath: "/uploads/booking.pdf" })).toMatchObject({ status: "mounted", fileId: "original", mountedFileId: "mounted", sessionResourceId: "resource" });
    const event = await h.writes.appendUserMessage({ conversationId: "conversation", uploadId: upload.id, requestId: "send", text: "Booking" });
    expect(event.payload.upload).toEqual({ id: upload.id, filename: "booking.pdf", mimeType: "application/pdf", sizeBytes: 14 });
  });

  it("marks full deletion only after all three stored identities are confirmed, preserving the label", async () => {
    const h = harness(); const upload = await reserved(h);
    const identity = { conversationId: "conversation", uploadId: upload.id };
    await h.writes.attachUploadResource({ ...identity, fileId: "original", mountedFileId: "mounted", sessionResourceId: "resource", mountPath: "/uploads/booking.pdf" });
    await expect(h.writes.markUploadCopyDeleted({ ...identity, copy: "original", providerId: "wrong" })).rejects.toThrow("identity");
    expect(await h.writes.markUploadCopyDeleted({ ...identity, copy: "original", providerId: "original" })).toMatchObject({ originalFileDeletedAt: now, deletedFromAnthropicAt: null });
    expect(await h.writes.markUploadCopyDeleted({ ...identity, copy: "mounted", providerId: "mounted" })).toMatchObject({ mountedFileDeletedAt: now, deletedFromAnthropicAt: null });
    const deleted = await h.writes.markUploadCopyDeleted({ ...identity, copy: "resource", providerId: "resource" });
    expect(deleted).toMatchObject({ status: "deleted", deletedFromAnthropicAt: now, originalFilename: "booking.pdf" });
    expect(await h.writes.markUploadCopyDeleted({ ...identity, copy: "resource", providerId: "resource" })).toEqual(deleted);
    await expect(h.writes.attachUploadResource({ ...identity, fileId: "original" })).rejects.toThrow("unavailable");
  });
});

describe("durable pending confirmation guards", () => {
  it("requires flight-upload ownership and preserves nullable candidates", async () => {
    const h = harness(); const input = await staged(h);
    expect(h.tables.pendingExtraction[0]).toMatchObject({ flightCandidates: { legs: null }, phase: "collecting", version: 1 });
    const save = { ...input, flightCandidates: { legs: null }, expiresAt: tomorrow };
    await expect(h.writes.savePendingExtraction({ ...save, conversationId: "other" })).rejects.toThrow("flight-confirmation upload");
    h.tables.upload[0]!.purpose = "OTHER";
    await expect(h.writes.savePendingExtraction(save)).rejects.toThrow("flight-confirmation upload");
    expect(h.tables.pendingExtraction).toHaveLength(1);
  });

  it("links ordered guest/readback/yes rows, clears the question, then invalidates consent on correction", async () => {
    const h = harness(); const input = await staged(h);
    addMessage(h, "name", "user", 1, "My name is Kristy Taylor");
    addMessage(h, "readback", "assistant", 2, "Please confirm these flight details.", "conversation", {
      intakeReadback: { pendingExtractionId: input.pendingExtractionId, version: input.version + 1 },
    });
    addMessage(h, "yes", "user", 3, "Yes, that's correct!");
    const named = await h.writes.recordClaimedGuestName({ ...input, firstName: "Kristy", lastName: "Taylor", guestId: "guest", messageId: "name" });
    const versioned = { ...input, version: named.version };
    await h.writes.recordIntakeReadback({ ...versioned, messageId: "readback" });
    expect(await h.writes.confirmPendingExtraction({ ...versioned, messageId: "yes" })).toMatchObject({ phase: "confirmed", readbackVersion: 2, confirmationMessageId: "yes", confirmedAt: now, outstandingQuestion: null });
    const changed = await h.writes.savePendingExtraction({ ...versioned, flightCandidates: { legs: [] }, expiresAt: tomorrow });
    expect(changed).toMatchObject({ version: 3, phase: "collecting", readbackVersion: null, readbackMessageId: null, confirmationMessageId: null, confirmedAt: null, guestCreationConsentMessageId: null });
    await expect(h.writes.confirmPendingExtraction({ ...versioned, messageId: "yes" })).rejects.toThrow("changed");
  });

  it.each(["other-conversation", "wrong-role", "before-readback", "correction-text", "intervening-correction"])("refuses %s confirmation evidence", async (scenario) => {
    const h = harness(); const input = await staged(h);
    addMessage(h, "name", "user", 1, "Kristy Taylor");
    addMessage(h, "readback", "assistant", 3, "Confirm these flights.", "conversation", {
      intakeReadback: { pendingExtractionId: input.pendingExtractionId, version: input.version + 1 },
    });
    addMessage(h, "yes", scenario === "wrong-role" ? "assistant" : "user", scenario === "before-readback" ? 2 : 5,
      scenario === "correction-text" ? "Yes, but change the airport" : "Yes", scenario === "other-conversation" ? "other" : "conversation");
    if (scenario === "intervening-correction") addMessage(h, "correction", "user", 4, "Actually change the date");
    const named = await h.writes.recordClaimedGuestName({ ...input, firstName: "Kristy", lastName: "Taylor", messageId: "name" });
    const versioned = { ...input, version: named.version };
    await h.writes.recordIntakeReadback({ ...versioned, messageId: "readback" });
    const before = structuredClone(h.tables.pendingExtraction);
    await expect(h.writes.confirmPendingExtraction({ ...versioned, messageId: "yes" })).rejects.toThrow();
    expect(h.tables.pendingExtraction).toEqual(before);
  });

  it.each(["expired", "consumed", "stale-version"])("refuses %s pending state before recording identity", async (scenario) => {
    const h = harness(); const input = await staged(h);
    addMessage(h, "name", "user", 1, "Kristy Taylor");
    if (scenario === "expired") h.tables.pendingExtraction[0]!.expiresAt = now;
    if (scenario === "consumed") h.tables.pendingExtraction[0]!.consumedAt = now;
    const before = structuredClone(h.tables.pendingExtraction);
    await expect(h.writes.recordClaimedGuestName({ ...input, version: scenario === "stale-version" ? 2 : input.version, firstName: "Kristy", lastName: "Taylor", messageId: "name" })).rejects.toThrow("expired, changed, or already consumed");
    expect(h.tables.pendingExtraction).toEqual(before);
  });

  it("cannot relabel an old readback and yes as confirmation of corrected candidates", async () => {
    const h = harness(); const input = await staged(h);
    addMessage(h, "name", "user", 1, "Kristy Taylor");
    const named = await h.writes.recordClaimedGuestName({ ...input, firstName: "Kristy", lastName: "Taylor", messageId: "name" });
    const versioned = { ...input, version: named.version };
    addMessage(h, "old-readback", "assistant", 2, "Confirm the original flight details.", "conversation", {
      intakeReadback: { pendingExtractionId: input.pendingExtractionId, version: named.version },
    });
    addMessage(h, "old-yes", "user", 3, "Yes");
    await h.writes.recordIntakeReadback({ ...versioned, messageId: "old-readback" });
    await h.writes.confirmPendingExtraction({ ...versioned, messageId: "old-yes" });
    const changed = await h.writes.savePendingExtraction({ ...versioned, flightCandidates: { legs: [] }, expiresAt: tomorrow });
    const latest = { ...input, version: changed.version };
    const before = structuredClone(h.tables.pendingExtraction);
    await expect(h.writes.recordIntakeReadback({ ...latest, messageId: "old-readback" })).rejects.toThrow();
    await expect(h.writes.confirmPendingExtraction({ ...latest, messageId: "old-yes" })).rejects.toThrow();
    expect(h.tables.pendingExtraction).toEqual(before);
    expect(h.tables.pendingExtraction[0]).toMatchObject({ phase: "collecting", readbackVersion: null, confirmedAt: null });
  });

  it("acquires the pending row lock before deciding whether an expired record was consumed", async () => {
    const h = harness(); const input = await staged(h);
    h.tables.pendingExtraction[0]!.expiresAt = now;
    let locked = false;
    const readAfterLock: boolean[] = [];
    const readPending = h.tx.pendingExtraction.findFirst.getMockImplementation()!;
    h.tx.pendingExtraction.findFirst.mockImplementation(async args => {
      readAfterLock.push(locked);
      return readPending(args);
    });
    h.tx.$queryRaw.mockImplementation(async query => {
      if (query.join("?").includes('FROM "PendingExtraction"') && query.join("?").includes("FOR UPDATE")) {
        locked = true;
        // Model a competing commit becoming visible when the lock is acquired.
        // This checks the helper's ordering, not real PostgreSQL concurrency.
        Object.assign(h.tables.pendingExtraction[0]!, { consumedAt: now, phase: "committed" });
      }
      return [];
    });
    h.tx.pendingExtraction.update.mockClear();
    await expect(h.writes.expirePendingExtraction(input)).resolves.toBeNull();
    expect(locked).toBe(true);
    expect(readAfterLock).toEqual([true]);
    expect(h.tx.pendingExtraction.update).not.toHaveBeenCalled();
    expect(h.tables.pendingExtraction[0]).toMatchObject({ phase: "committed", consumedAt: now });
  });
});
