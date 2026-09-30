import { describe, expect, it, vi } from "vitest";
import type { ChatReadDatabase } from "../../src/lib/db/chat-client.server";
import { createChatRepository } from "../../src/lib/chat/repository.server";

const scope = { tripId: "trip", conversationId: "conversation" };
const options = { retentionDays: 30, now: new Date("2026-09-26T00:00:00Z") };
const event = (seq: number, delivery?: string) => ({ id: `row-${seq}`, conversationId: scope.conversationId, seq, type: delivery ? "user_message" : "message", payload: delivery ? { text: "Monday?", requestId: "request", delivery } : { text: `Answer ${seq}` } });
function fixture() {
  const record = { id: scope.conversationId, tripId: scope.tripId, status: "completed", runtimeStatus: "waiting", createdAt: new Date("2026-09-26T00:00:00Z"), finishedAt: new Date("2026-09-26T00:00:00Z"), error: null, agentSessionId: "session", activeRequestId: null, activeTurnId: null, messages: [] as ReturnType<typeof event>[] };
  const db = {
    conversation: { findFirst: vi.fn().mockResolvedValue(record), findMany: vi.fn().mockResolvedValue([]) },
    message: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    upload: { findFirst: vi.fn().mockResolvedValue(null) },
    pendingExtraction: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  // Prisma's generic delegate signatures describe production queries; these
  // injected spies return the selected records without creating a connection.
  return { db, record, repository: createChatRepository(db as unknown as ChatReadDatabase) };
}

describe("conversation read repository", () => {
  it("loads newest 200 detail rows with one lookahead and an omitted-history cursor", async () => {
    const { db, record, repository } = fixture();
    record.messages = Array.from({ length: 201 }, (_, index) => event(250 - index));
    const detail = await repository.loadConversationDetails(scope, options);
    expect(db.conversation.findFirst).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ where: { id: scope.conversationId, tripId: scope.tripId }, select: expect.objectContaining({ messages: { orderBy: { seq: "desc" }, take: 201, select: { id: true, conversationId: true, seq: true, type: true, payload: true } } }) }));
    expect(detail?.events.map(row => row.seq)).toEqual(Array.from({ length: 200 }, (_, index) => 51 + index));
    expect(detail).toMatchObject({ lastEventSeq: 250, eventsCursor: 50, eventsTruncated: true, pendingWakeupAt: null });
    expect(record.messages[0]?.seq).toBe(250);
  });

  it("keeps exact-limit details untruncated", async () => {
    const { record, repository } = fixture();
    record.messages = Array.from({ length: 200 }, (_, index) => event(199 - index));
    expect(await repository.loadConversationDetails(scope, options)).toMatchObject({ eventsTruncated: false, eventsCursor: null, lastEventSeq: 199 });
  });

  it("replays ascending 200-row pages without consuming the lookahead row", async () => {
    const { db, repository } = fixture();
    db.message.findMany.mockResolvedValueOnce(Array.from({ length: 201 }, (_, index) => event(index + 100))).mockResolvedValueOnce([event(300), event(301)]);
    const first = await repository.loadConversationEventsAfter(scope, 99);
    expect(first.events.map(row => row.seq)).toEqual(Array.from({ length: 200 }, (_, index) => index + 100));
    expect(first).toMatchObject({ hasMore: true, nextAfterSeq: 299 });
    const second = await repository.loadConversationEventsAfter(scope, first.nextAfterSeq);
    expect(second).toEqual({ events: [event(300), event(301)], hasMore: false, nextAfterSeq: 301 });
    expect(db.message.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { conversationId: scope.conversationId, conversation: { tripId: scope.tripId }, seq: { gt: 99 } }, orderBy: { seq: "asc" }, take: 201 }));
    expect(db.message.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { conversationId: scope.conversationId, conversation: { tripId: scope.tripId }, seq: { gt: 299 } } }));
  });

  it("returns -1 for empty detail/status and preserves an empty replay cursor", async () => {
    const { repository } = fixture();
    expect(await repository.loadConversationDetails(scope, options)).toMatchObject({ events: [], eventsCursor: null, eventsTruncated: false, lastEventSeq: -1 });
    expect(await repository.loadConversationStatusSnapshot(scope)).toMatchObject({ lastEventSeq: -1 });
    expect(await repository.loadConversationEventsAfter(scope, -1)).toEqual({ events: [], hasMore: false, nextAfterSeq: -1 });
    expect(await repository.loadConversationEventsAfter(scope, 27)).toEqual({ events: [], hasMore: false, nextAfterSeq: 27 });
  });

  it.each([-2, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid cursor %s before a query", async cursor => {
    const { db, repository } = fixture();
    await expect(repository.loadConversationEventsAfter(scope, cursor)).rejects.toThrow("Invalid replay cursor.");
    expect(db.message.findMany).not.toHaveBeenCalled();
  });

  it("keeps trip ownership in each conversation and attachment lookup", async () => {
    const { db, repository } = fixture();
    await repository.loadConversationSessionState(scope);
    await repository.loadConversationStatus(scope);
    await repository.loadConversationStatusSnapshot(scope);
    await repository.loadConversationChatState(scope);
    for (const [query] of db.conversation.findFirst.mock.calls) expect(query.where).toEqual({ id: scope.conversationId, tripId: scope.tripId });
    await repository.findUserMessageByRequestId(scope, "request");
    await repository.loadQueuedMessages(scope);
    await repository.loadOldestQueuedMessage(scope);
    for (const [query] of [...db.message.findFirst.mock.calls, ...db.message.findMany.mock.calls]) expect(query.where).toMatchObject({ conversationId: scope.conversationId, conversation: { tripId: scope.tripId }, type: "user_message" });
    await repository.loadPendingExtraction(scope, "pending");
    await repository.loadUpload(scope, "upload");
    expect(db.pendingExtraction.findFirst).toHaveBeenCalledExactlyOnceWith({ where: { id: "pending", conversationId: scope.conversationId, conversation: { tripId: scope.tripId } } });
    expect(db.upload.findFirst).toHaveBeenCalledExactlyOnceWith({ where: { id: "upload", conversationId: scope.conversationId, conversation: { tripId: scope.tripId } } });
  });

  it("reads changed delivery at the existing sequence after queue settlement", async () => {
    const { db, repository } = fixture();
    db.message.findMany.mockResolvedValueOnce([event(7, "queued")]).mockResolvedValueOnce([]);
    db.message.findFirst.mockResolvedValueOnce(event(7, "queued")).mockResolvedValueOnce(event(7, "sent"));
    expect(await repository.loadQueuedMessages(scope)).toEqual([event(7, "queued")]);
    expect(await repository.loadOldestQueuedMessage(scope)).toEqual({ id: "row-7", seq: 7, text: "Monday?", requestId: "request" });
    expect(await repository.loadQueuedMessages(scope)).toEqual([]);
    expect(await repository.findUserMessageByRequestId(scope, "request")).toEqual({ ...event(7, "sent"), duplicate: true });
    expect(db.message.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ payload: { path: ["delivery"], equals: "queued" } }), orderBy: { seq: "asc" } }));
    expect(db.message.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ requestId: "request" }) }));
  });

  it("recovers provider work or a send claim without requiring a running business status", async () => {
    const { db, repository } = fixture();
    const resumable = [{ id: "settled-with-followup", agentSessionId: "session", streamIndex: 42 }];
    db.conversation.findMany.mockResolvedValue(resumable);
    expect(await repository.loadResumableConversations(scope.tripId)).toEqual(resumable);
    expect(db.conversation.findMany).toHaveBeenCalledExactlyOnceWith({ where: { tripId: scope.tripId, agentSessionId: { not: null }, runtimeStatus: { not: "closed" }, OR: [{ runtimeStatus: { in: ["active", "starting", "stopping"] } }, { activeRequestId: { not: null } }, { messages: { some: { type: "user_message", OR: [{ payload: { path: ["delivery"], equals: "pending" } }, { payload: { path: ["delivery"], equals: "queued" } }] } } }] }, select: { id: true, agentSessionId: true, streamIndex: true }, orderBy: { createdAt: "asc" } });
  });

  it.each(["pending", "queued"])("Q7 restart query includes a durable %s send before the active claim was saved", async delivery => {
    const { db, record, repository } = fixture();
    record.messages = [event(7, delivery)];
    // This is the crash window: the message committed but the conversation
    // still holds its prior settled state and has no new request claim.
    expect(record).toMatchObject({ status: "completed", runtimeStatus: "waiting", activeRequestId: null });
    db.conversation.findMany.mockResolvedValue([{ id: record.id, agentSessionId: record.agentSessionId, streamIndex: 7 }]);
    await repository.loadResumableConversations(record.tripId);
    const query = db.conversation.findMany.mock.calls[0]![0];
    expect(query.where).not.toHaveProperty("status");
    expect(query.where.OR).toContainEqual({ messages: { some: { type: "user_message", OR: expect.arrayContaining([{ payload: { path: ["delivery"], equals: delivery } }]) } } });
    expect(query.where).toMatchObject({ tripId: scope.tripId, agentSessionId: { not: null }, runtimeStatus: { not: "closed" } });
  });

  it("returns null for inaccessible conversations and rejects malformed durable payloads", async () => {
    const { db, record, repository } = fixture();
    db.conversation.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    expect(await repository.loadConversationDetails(scope, options)).toBeNull();
    expect(await repository.loadConversationStatus(scope)).toBeNull();
    expect(await repository.loadConversationStatusSnapshot(scope)).toBeNull();
    db.message.findMany.mockResolvedValueOnce([{ ...event(0), payload: ["not a record"] }]);
    await expect(repository.loadConversationEventsAfter(scope, -1)).rejects.toThrow();
    expect(record.messages).toEqual([]);
  });
});
