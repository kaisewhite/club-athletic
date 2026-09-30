import { describe, expect, it, vi } from "vitest";
import { createChatWrites, messageColumns } from "../../src/lib/db/chat-writes.server";
import type { ChatDatabase } from "../../src/lib/db/chat-client.server";

// Q7 fixtures precede the port. Task 2 must drain all this history before parking
// or delivering a queue; streamIndex is diagnostic, never a skip count.
export const resumedHistory = [
  { providerEventKey: "earlier-end", type: "turn.completed", payload: {} },
  { providerEventKey: "later-start", type: "turn.started", payload: { turnId: "later" } },
  { providerEventKey: "later-answer", type: "message", payload: { text: "Still working", activityKind: "commentary" } },
];
function fixture() {
  let nextEventSeq = 0;
  const rows: Record<string, unknown>[] = [];
  const conversation = { id: "c", tripId: "trip", runtimeStatus: "waiting", status: "completed", nextEventSeq: 0 };
  const tx = {
    conversation: {
      findFirst: vi.fn(async () => conversation),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (data.nextEventSeq) nextEventSeq++;
        Object.assign(conversation, data, { nextEventSeq });
        return conversation;
      }),
    },
    message: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find(r => Object.entries(where).every(([k,v]) => r[k] === v)) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { ...data, lifecycleAppliedAt: null }; rows.push(row); return row; }),
      update: vi.fn(async ({ where, data }: { where: {id:string}; data: Record<string, unknown> }) => { const row = rows.find(r => r.id === where.id)!; Object.assign(row, data); return row; }),
      findMany: vi.fn(async () => rows),
    },
    $queryRaw: vi.fn(async () => [conversation]),
  };
  const db = { ...tx, $transaction: vi.fn(async (run: (t: unknown) => unknown) => run(tx)) };
  return { db, tx, rows, conversation, writes: createChatWrites(db as unknown as ChatDatabase) };
}
describe("durable chat bookkeeping (edge session-events port, Q7 corrections)", () => {
  it("allocates mixed rows and dedupes provider identity before allocation", async () => {
    const { writes, rows } = fixture();
    const first = await writes.insertConversationEventAllocating({conversationId:"c", type:"message", payload:{text:"hello"}, providerEventKey:"root:event"});
    const duplicate = await writes.insertConversationEventAllocating({conversationId:"c", type:"message", payload:{text:"hello"}, providerEventKey:"root:event"});
    expect(first.seq).toBe(0); expect(duplicate).toMatchObject({id:first.id,seq:0,duplicate:true}); expect(rows).toHaveLength(1);
  });
  it("preserves the missing earlier boundary and later active turn on resume", async () => {
    const {writes,rows} = fixture();
    for (const event of resumedHistory) await writes.insertConversationEventAllocating({conversationId:"c", ...event});
    for (const event of resumedHistory) expect((await writes.insertConversationEventAllocating({conversationId:"c", ...event})).duplicate).toBe(true);
    expect(rows.map(r=>r.type)).toEqual(["turn.completed","turn.started","message"]);
    expect(rows.map(r=>r.seq)).toEqual([0,1,2]);
  });
  it("persists pending user delivery and deduplicates request keys", async () => {
    const {writes,rows} = fixture();
    await writes.appendUserMessage({conversationId:"c",requestId:"req",text:"hello"});
    await writes.appendUserMessage({conversationId:"c",requestId:"req",text:"hello"});
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({role:"user",content:"hello",payload:{delivery:"pending"}});
  });
  it("same-seq queue settlement returns the changed durable row after commit", async () => {
    const {writes} = fixture();
    const row = await writes.appendUserMessage({conversationId:"c",requestId:"req",text:"hello"});
    await writes.markUserMessageDelivery({conversationId:"c",requestId:"req",delivery:"queued"});
    const delivered = await writes.markQueuedMessageDelivered({conversationId:"c",rowId:row.id});
    expect(delivered).toMatchObject({id:row.id,seq:row.seq,payload:{delivery:"sent"}});
  });
  it("accepted follow-up state reactivates a settled conversation", async () => {
    const {writes,conversation} = fixture();
    await writes.updateConversationSessionState({conversationId:"c",runtimeStatus:"active",activeRequestId:"new"});
    expect(conversation).toMatchObject({status:"running",runtimeStatus:"active",activeRequestId:"new",finishedAt:null,error:null});
  });
  it.each(["turn.completed", "turn.cancelled"])("does not park a continued %s", async type => {
    const {writes,tx} = fixture();
    const event = await writes.insertConversationEventAllocating({conversationId:"c",type,payload:{continuation:true}});
    tx.conversation.update.mockClear();
    await writes.parkConversationTurn({conversationId:"c",eventId:event.id,status:"completed"});
    expect(tx.conversation.update).not.toHaveBeenCalled();
  });
  it("recovers a persisted boundary once after a crash before lifecycle bookkeeping", async () => {
    const {writes,tx} = fixture();
    const event = await writes.insertConversationEventAllocating({conversationId:"c",type:"turn.completed",payload:{}});
    tx.conversation.update.mockClear();
    await writes.parkConversationTurn({conversationId:"c",eventId:event.id,status:"completed"});
    await writes.parkConversationTurn({conversationId:"c",eventId:event.id,status:"completed"});
    expect(tx.conversation.update).toHaveBeenCalledTimes(1);
  });
  it("recovers unique conflicts outside the aborted transaction", async () => {
    const {db,tx,writes} = fixture();
    db.$transaction.mockRejectedValueOnce({code:"P2002"});
    tx.message.findFirst.mockResolvedValueOnce({id:"winner",conversationId:"c",seq:9,type:"message",payload:{}});
    expect(await writes.insertConversationEventAllocating({conversationId:"c",providerEventKey:"provider",type:"message",payload:{}})).toMatchObject({id:"winner",duplicate:true});
  });
  it("derives transcript columns from event authority", () => {
    expect(messageColumns("tool_result", {text:"result"})).toMatchObject({role:"tool"});
    expect(messageColumns("turn.completed", {})).toMatchObject({role:"system",content:""});
    expect(messageColumns("message",{text:"hello\nSource: Flights"})).toMatchObject({role:"assistant",sourceSections:["flights"]});
  });
});
