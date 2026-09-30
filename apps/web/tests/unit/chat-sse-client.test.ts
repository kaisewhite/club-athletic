import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError, CHAT_UNAVAILABLE_MESSAGE, cancelConversation, createConversationStreamCursor,
  fetchConversationDetails, fetchConversationDetailsAfterStatus, fetchConversationStatus,
  sendConversationChatMessage, startConversation, subscribeToConversationStream,
} from "../../app/lib/chat/api";
import {
  conversationLookupRetryPolicy, loadConversationDetailsAfterStatusWithRetry,
  loadConversationDetailsWithRetry, readConversationSelection, setConversationSelection,
} from "../../app/lib/chat/detail-loader";
import { upsertSessionEventRow } from "../../src/lib/chat/event-projection";
import type { ConversationDetails, ConversationStatusSnapshot, SessionEventRow } from "../../src/lib/chat/contracts";

const encoder = new TextEncoder();
const row = (seq: number, text = "Bonjour Méribel ⛷️"): SessionEventRow => ({ id: `row-${seq}`, seq, type: "message", payload: { text } });
const activity = (seq: number, text?: string) => `id: ${seq}\nevent: activity\ndata: ${JSON.stringify(row(seq, text))}\n\n`;
const done = "event: done\ndata: {}\n\n";
function streamResponse(chunks: Uint8Array[], close = true) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); if (close) controller.close(); }, cancel });
  return { response: new Response(body, { headers: { "Content-Type": "text/event-stream" } }), body, cancel };
}
const detail: ConversationDetails = {
  id: "chat", tripId: "trip", status: "running", createdAt: "2026-09-26", finishedAt: null, error: null,
  events: [], eventsTruncated: false, eventsCursor: null, lastEventSeq: -1, agentSessionId: null, pendingWakeupAt: null,
  chat: { canSend: true, reason: null, runtimeStatus: "active", pendingWakeupAt: null, activeTurn: true, waitingOnApproval: false },
};
const status: ConversationStatusSnapshot = { status: "running", lastEventSeq: -1, finishedAt: null, error: null };

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("ported edge browser SSE subscriber", () => {
  it("decodes frames split at every byte including multibyte UTF-8 characters", async () => {
    const bytes = encoder.encode(activity(7) + done);
    const stream = streamResponse(Array.from(bytes, (byte) => Uint8Array.of(byte)), false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(stream.response));
    const onActivity = vi.fn(); const onDone = vi.fn(); const onError = vi.fn();
    const unsubscribe = subscribeToConversationStream("chat", -1, { onActivity, onDone, onError });
    await unsubscribe.finished;
    expect(onActivity).toHaveBeenCalledExactlyOnceWith(7, row(7));
    expect(onDone).toHaveBeenCalledOnce(); expect(onError).not.toHaveBeenCalled();
    expect(stream.cancel).toHaveBeenCalledOnce(); expect(stream.body.locked).toBe(false);
  });

  it("parses CRLF separators split across chunks and multiline data, ignoring heartbeat comments", async () => {
    const content = ': heartbeat\r\n\r\nid: 2\r\nevent: activity\r\ndata: {"id":"row-2","seq":2,\r\ndata: "type":"message","payload":{"text":"Hi"}}\r\n\r\n' + done.replaceAll("\n", "\r\n");
    const chunks = [...content].map((part) => encoder.encode(part));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(chunks).response));
    const onActivity = vi.fn(); const onError = vi.fn();
    const subscription = subscribeToConversationStream("chat", 1, { onActivity, onError });
    await subscription.finished;
    expect(onActivity).toHaveBeenCalledExactlyOnceWith(2, row(2, "Hi")); expect(onError).not.toHaveBeenCalled();
  });

  it("dispatches delta/state without advancing the acknowledged durable cursor", async () => {
    const cursor = createConversationStreamCursor(8);
    const delta = { blockId: "block", variant: "message", text: "First token", done: false };
    const state = { runtimeStatus: "active", status: "running", activeRequestIdPresent: true, activeTurnId: null, pendingWakeupAt: null, waitingOnApproval: false };
    const frames = `event: delta\ndata: ${JSON.stringify(delta)}\n\nevent: state\ndata: ${JSON.stringify(state)}\n\n` + done;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse([encoder.encode(frames)]).response));
    const onDelta = vi.fn(); const onState = vi.fn();
    const subscription = subscribeToConversationStream("chat", cursor.value(), { onActivity: (seq) => cursor.acknowledge(seq), onDelta, onState });
    await subscription.finished;
    expect(cursor.value()).toBe(8); expect(onDelta).toHaveBeenCalledExactlyOnceWith(delta); expect(onState).toHaveBeenCalledExactlyOnceWith(state);
  });

  it("reconnects from acknowledged cursor with duplicate-free rows and applies same-sequence delivery updates", async () => {
    const cursor = createConversationStreamCursor(); let rows: SessionEventRow[] = [];
    const changed = { ...row(1), payload: { text: "Delivered" } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(streamResponse([encoder.encode(activity(1))]).response)
      .mockResolvedValueOnce(streamResponse([encoder.encode(`id: 1\nevent: activity\ndata: ${JSON.stringify(changed)}\n\n${activity(2)}${done}`)]).response);
    vi.stubGlobal("fetch", fetchMock);
    const handlers = { onActivity(seq: number, next: SessionEventRow) { rows = upsertSessionEventRow(rows, next); cursor.acknowledge(seq); }, onError: vi.fn() };
    await subscribeToConversationStream("chat", cursor.value(), handlers).finished;
    expect(handlers.onError).toHaveBeenCalledOnce(); expect(cursor.value()).toBe(1);
    await subscribeToConversationStream("chat", cursor.value(), handlers).finished;
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/chat/conversations/chat/stream?after=1");
    expect(rows).toEqual([changed, row(2)]); expect(cursor.value()).toBe(2);
  });

  it("does not acknowledge a row until its handler does so and rejects nonfinite cursor changes", () => {
    const cursor = createConversationStreamCursor(NaN);
    expect(cursor.value()).toBe(-1); cursor.acknowledge(7); cursor.acknowledge(3); cursor.acknowledge(Infinity);
    expect(cursor.value()).toBe(7); cursor.reset(NaN); expect(cursor.value()).toBe(-1);
  });

  it("cancels the pending reader and abort controller and suppresses all callbacks after unsubscribe", async () => {
    const stream = streamResponse([], false);
    const fetchMock = vi.fn().mockResolvedValue(stream.response); vi.stubGlobal("fetch", fetchMock);
    const handlers = { onActivity: vi.fn(), onError: vi.fn(), onDone: vi.fn() };
    const subscription = subscribeToConversationStream("chat", -1, handlers);
    await Promise.resolve(); await Promise.resolve(); subscription(); await subscription.finished;
    expect(fetchMock.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(stream.cancel).toHaveBeenCalledOnce(); expect(stream.body.locked).toBe(false);
    expect(handlers.onError).not.toHaveBeenCalled(); expect(handlers.onActivity).not.toHaveBeenCalled(); expect(handlers.onDone).not.toHaveBeenCalled();
  });

  it("cancels a late fetch response after unmount even when the transport ignores abort", async () => {
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })));
    const handlers = { onActivity: vi.fn(), onError: vi.fn() };
    const subscription = subscribeToConversationStream("chat", -1, handlers); subscription();
    const stream = streamResponse([encoder.encode(activity(1))], false); resolveFetch(stream.response); await subscription.finished;
    expect(stream.cancel).toHaveBeenCalledOnce(); expect(stream.body.locked).toBe(false);
    expect(handlers.onActivity).not.toHaveBeenCalled(); expect(handlers.onError).not.toHaveBeenCalled();
  });

  it("releases unsuccessful HTTP stream responses and aborts their request", async () => {
    const stream = streamResponse([], false);
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream.body, { status: 503 })); vi.stubGlobal("fetch", fetchMock);
    const onError = vi.fn(); await subscribeToConversationStream("chat", -1, { onActivity: vi.fn(), onError }).finished;
    expect(onError).toHaveBeenCalledExactlyOnceWith(); expect(stream.cancel).toHaveBeenCalledOnce(); expect(stream.body.locked).toBe(false);
    expect(fetchMock.mock.calls[0]?.[1].signal.aborted).toBe(true);
  });

  it.each(["event: error\ndata: {\"error\":\"SECRET provider diagnostic\"}\n\n", "event: activity\ndata: invalid json\n\n"])("reports a generic stream failure and releases the reader for %s", async (frames) => {
    const stream = streamResponse([encoder.encode(frames)], false); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(stream.response));
    const onError = vi.fn(); const subscription = subscribeToConversationStream("chat", -1, { onActivity: vi.fn(), onError }); await subscription.finished;
    expect(onError).toHaveBeenCalledExactlyOnceWith(); expect(stream.cancel).toHaveBeenCalledOnce(); expect(stream.body.locked).toBe(false);
  });
});

describe("chat HTTP helper port", () => {
  it("posts the actual existing conversation route shape with an idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, conversationId: "created", seq: 0 }, { status: 201 })); vi.stubGlobal("fetch", fetchMock);
    expect(await startConversation("Monday?", "request-key")).toEqual({ ok: true, conversationId: "created", seq: 0 });
    expect(fetchMock).toHaveBeenCalledWith("/api/chat/conversations", expect.objectContaining({ method: "POST", body: JSON.stringify({ text: "Monday?" }), headers: { "Content-Type": "application/json", "Idempotency-Key": "request-key" } }));
  });

  it.each(["queue", "interrupt_replace"] as const)("retains %s delivery mode below the guest UI gate", async (deliveryMode) => {
    const response = { ok: true, seq: 3, requestId: "key", conversationId: "chat", delivery: "queued" };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(response)); vi.stubGlobal("fetch", fetchMock);
    expect(await sendConversationChatMessage("chat", "Next", "key", { deliveryMode })).toEqual(response);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/chat/conversations/chat/messages");
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toEqual({ text: "Next", deliveryMode });
  });

  it("rejects incomplete acknowledgements instead of pretending the send succeeded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, requestId: "key" })));
    expect(await sendConversationChatMessage("chat", "Next", "key")).toMatchObject({ ok: false });
  });

  it("redacts server and network diagnostics, including unavailable-agent failures", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ error: "SECRET agent diagnostics" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ error: "SECRET booking detail" }, { status: 500 })).mockRejectedValueOnce(new Error("SECRET network path"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(startConversation("Hi", "key")).rejects.toThrow(CHAT_UNAVAILABLE_MESSAGE);
    expect(await sendConversationChatMessage("chat", "Hi", "key")).toEqual({ ok: false, error: CHAT_UNAVAILABLE_MESSAGE, status: 500 });
    await expect(fetchConversationDetails("chat")).rejects.toThrow("We couldn't connect to the trip assistant.");
  });

  it("uses status before detail, carries abort signals, and only uses the existing cancel endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(status)).mockResolvedValueOnce(Response.json(detail)).mockResolvedValueOnce(new Response(null, { status: 409 }));
    vi.stubGlobal("fetch", fetchMock); const controller = new AbortController();
    expect(await fetchConversationDetailsAfterStatus("chat", fetchConversationStatus, fetchConversationDetails, controller.signal)).toEqual(detail);
    await cancelConversation("chat", controller.signal);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/api/chat/conversations/chat/status", "/api/chat/conversations/chat", "/api/chat/conversations/chat/cancel"]);
    expect(fetchMock.mock.calls.every((call) => call[1].signal === controller.signal)).toBe(true);
  });
});

describe("ported detail recovery and stable selection", () => {
  it("keeps edge's bounded 404 retry only for a known pending start", () => {
    expect(conversationLookupRetryPolicy(true)).toEqual({ attempts: 12, delayMs: 250 });
    expect(conversationLookupRetryPolicy(false)).toEqual({ attempts: 1, delayMs: 0 });
  });

  it("clears retry timers and its abort listener when disposed during the persistence gap", async () => {
    vi.useFakeTimers(); const controller = new AbortController();
    const added = vi.spyOn(controller.signal, "addEventListener"); const removed = vi.spyOn(controller.signal, "removeEventListener");
    const loader = vi.fn().mockRejectedValue(new ApiError("Conversation not found.", 404));
    const loading = loadConversationDetailsWithRetry("chat", loader, { attempts: 12, delayMs: 250 }, controller.signal);
    const rejected = expect(loading).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve(); expect(vi.getTimerCount()).toBe(1); controller.abort(); await rejected;
    expect(vi.getTimerCount()).toBe(0); expect(added).toHaveBeenCalledOnce(); expect(removed).toHaveBeenCalledOnce(); expect(loader).toHaveBeenCalledOnce();
  });

  it("retries status then loads detail once and removes its timer listener on success", async () => {
    vi.useFakeTimers(); const controller = new AbortController(); const removed = vi.spyOn(controller.signal, "removeEventListener");
    const loadStatus = vi.fn().mockRejectedValueOnce(new ApiError("Conversation not found.", 404)).mockResolvedValue(status);
    const loadDetail = vi.fn().mockResolvedValue(detail);
    const loading = loadConversationDetailsAfterStatusWithRetry("chat", loadStatus, loadDetail, { attempts: 2, delayMs: 250 }, controller.signal);
    await vi.advanceTimersByTimeAsync(250); expect(await loading).toEqual(detail); expect(loadStatus).toHaveBeenCalledTimes(2); expect(loadDetail).toHaveBeenCalledExactlyOnceWith("chat", controller.signal);
    expect(vi.getTimerCount()).toBe(0); expect(removed).toHaveBeenCalledOnce();
  });

  it("never retries a detail failure once status has established the conversation exists", async () => {
    const loadStatus = vi.fn().mockResolvedValue(status); const loadDetail = vi.fn().mockRejectedValue(new ApiError("Conversation not found.", 404));
    await expect(loadConversationDetailsAfterStatusWithRetry("chat", loadStatus, loadDetail, { attempts: 12, delayMs: 250 })).rejects.toThrow("Conversation not found.");
    expect(loadStatus).toHaveBeenCalledOnce(); expect(loadDetail).toHaveBeenCalledOnce();
  });

  it("reads a validated selection across navigation and resets only the cookie for New question", () => {
    expect(readConversationSelection("other=1; club-athletic-conversation=conv_123-AbC; next=2")).toBe("conv_123-AbC");
    expect(readConversationSelection("club-athletic-conversation=../private")).toBeNull(); expect(readConversationSelection(null)).toBeNull();
    expect(readConversationSelection(`club-athletic-conversation=${"a".repeat(129)}`)).toBeNull();
    const document = { cookie: "" }; vi.stubGlobal("document", document); vi.stubGlobal("location", { protocol: "https:" });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    setConversationSelection("chat"); expect(document.cookie).toBe("club-athletic-conversation=chat; Path=/; SameSite=Lax; Max-Age=2592000; Secure");
    setConversationSelection(null); expect(document.cookie).toBe("club-athletic-conversation=; Path=/; SameSite=Lax; Max-Age=0; Secure"); expect(fetchMock).not.toHaveBeenCalled();
    expect(() => setConversationSelection("bad; cookie=value")).toThrow("Invalid conversation selection.");
  });
});
