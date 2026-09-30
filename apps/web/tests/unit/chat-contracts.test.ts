import { describe, expect, it } from "vitest";
import type { ConversationSessionStateFrame, SessionEventRow, StreamDelta } from "../../src/lib/chat/contracts";
import { boundConversationEvents, computeConversationChatCapability, parseConversationStatus, serializeConversationStreamDeltaEvent, serializeConversationStreamDoneEvent, serializeConversationStreamErrorEvent, serializeConversationStreamEvent, serializeConversationStreamStateEvent } from "../../src/lib/chat/projections";
import { canSubmitChat, chatUiReducer, initialChatUiState } from "../../src/lib/chat/chat-state";

const frame: ConversationSessionStateFrame = { runtimeStatus: "active", status: "running", activeRequestIdPresent: true, activeTurnId: "turn", pendingWakeupAt: null, waitingOnApproval: false };
describe("edge chat wire contracts", () => {
  it("preserves all five exact SSE frame byte shapes", () => {
    const row: SessionEventRow = { id: "row", seq: 7, type: "message", payload: { text: "Hi\nMéribel" } };
    const delta: StreamDelta = { blockId: "b", variant: "message", text: "Hi", done: false, canonicalEventId: "canonical", providerEventId: "provider", threadId: "thread", parentThreadId: null, threadRole: "root", agentName: "Concierge", activityKind: "commentary", activityLabel: "Responding", toolName: "getRooms" };
    expect(serializeConversationStreamEvent(7, row)).toBe('id: 7\nevent: activity\ndata: {"id":"row","seq":7,"type":"message","payload":{"text":"Hi\\nMéribel"}}\n\n');
    expect(serializeConversationStreamDeltaEvent(delta)).toBe('event: delta\ndata: {"blockId":"b","variant":"message","text":"Hi","done":false,"canonicalEventId":"canonical","providerEventId":"provider","threadId":"thread","parentThreadId":null,"threadRole":"root","agentName":"Concierge","activityKind":"commentary","activityLabel":"Responding","toolName":"getRooms"}\n\n');
    expect(serializeConversationStreamStateEvent(frame)).toBe('event: state\ndata: {"runtimeStatus":"active","status":"running","activeRequestIdPresent":true,"activeTurnId":"turn","pendingWakeupAt":null,"waitingOnApproval":false}\n\n');
    expect(serializeConversationStreamDoneEvent()).toBe('event: done\ndata: {}\n\n');
    expect(serializeConversationStreamErrorEvent(new Error("Try again."))).toBe('event: error\ndata: {"error":"Try again."}\n\n');
  });
  it("bounds newest rows in ascending sequence and provides the omitted-history cursor", () => {
    const rows = [3, 0, 4, 2, 1].map((seq) => ({ id: `row-${seq}`, seq, type: "message", payload: {}, conversationId: "chat" }));
    expect(boundConversationEvents(rows, 3)).toEqual({ events: [rows[3], rows[0], rows[2]], eventsCursor: 1, eventsTruncated: true });
    expect(rows.map((row) => row.seq)).toEqual([3, 0, 4, 2, 1]);
    expect(boundConversationEvents([], 200)).toEqual({ events: [], eventsCursor: null, eventsTruncated: false });
  });
  it("retains edge active-turn queue capability, approval and retention checks", () => {
    const state = { status: "running", runtimeStatus: "active", agentSessionId: "session", finishedAt: null };
    const options = { now: new Date("2026-09-26T00:00:00Z"), retentionDays: 30 };
    const capability = computeConversationChatCapability(state, options);
    expect(capability).toEqual({ canSend: true, reason: null, runtimeStatus: "active", pendingWakeupAt: null, activeTurn: true, waitingOnApproval: false });
    expect(computeConversationChatCapability(state, { ...options, waitingOnApproval: true }).canSend).toBe(false);
    expect(computeConversationChatCapability({ ...state, status: "completed", runtimeStatus: "waiting", finishedAt: "2026-08-25T00:00:00Z" }, options).reason).toBe("expired");
    expect(computeConversationChatCapability({ ...state, agentSessionId: null }, options).reason).toBe("no_session");
    expect(parseConversationStatus("unknown")).toBe("failed");
  });
  it("lets a fresh upload draft send: a null finishedAt means no turn has run, not a settled conversation", () => {
    // Exactly what `createDraftConversation` writes (chat-writes.server.ts:159):
    // status "completed", runtimeStatus "waiting", and no finishedAt — because a
    // draft exists to carry an attachment before any turn has ever run. Reading
    // that null as "settled" made every draft→upload→send answer 409, killing the
    // composer's paperclip flow. The retention window can only apply to something
    // that actually finished.
    const draft = { status: "completed", runtimeStatus: "waiting", agentSessionId: "session", finishedAt: null };
    const options = { now: new Date("2026-09-28T00:00:00Z"), retentionDays: 30 };
    expect(computeConversationChatCapability(draft, options)).toMatchObject({ canSend: true, reason: null });
    // A conversation that genuinely settled inside the window still sends, and one
    // that settled outside it is still expired — the retention rule is unchanged.
    expect(computeConversationChatCapability({ ...draft, finishedAt: "2026-09-27T00:00:00Z" }, options).canSend).toBe(true);
    expect(computeConversationChatCapability({ ...draft, finishedAt: "2026-08-25T00:00:00Z" }, options).reason).toBe("expired");
  });
  it("clears the submitted draft on send and preserves newer text typed during the request", () => {
    const capability = computeConversationChatCapability({ status: "running", runtimeStatus: "active", agentSessionId: "session", finishedAt: null }, { retentionDays: 30 });
    const draft = chatUiReducer(initialChatUiState(), { type: "draft", text: "  Monday?  " });
    expect(canSubmitChat(draft, capability)).toBe(true);
    const sending = chatUiReducer(draft, { type: "send_started", text: "  Monday?  " });
    expect(canSubmitChat(sending, capability)).toBe(false);
    expect(sending).toMatchObject({ draft: "", submittedDraft: "  Monday?  " });
    const failure = chatUiReducer(sending, { type: "send_failed", message: "Try again." });
    expect(failure).toMatchObject({ phase: "idle", draft: "", toast: "Try again." });
    const newer = chatUiReducer(sending, { type: "draft", text: "A different question" });
    expect(chatUiReducer(newer, { type: "send_failed", message: "Try again." }).draft).toBe("A different question");
    expect(chatUiReducer(sending, { type: "send_accepted" })).toMatchObject({ phase: "idle", draft: "", submittedDraft: null });
  });
});
