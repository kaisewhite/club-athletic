import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/lib/chat/runtime/runtime.server", () => ({
  conversationScope: vi.fn(async (conversationId: string) => ({ tripId: "trip", conversationId })),
  recoverManagedAgentPumpForConversation: vi.fn(async () => "not_needed"),
  buildConversationStateFrame: vi.fn(async () => null),
  startConversation: vi.fn(async () => ({ conversationId: "c", seq: 0 })),
  sendConversationMessage: vi.fn(async () => ({ status: 200, body: { ok: true, seq: 1, delivery: "queued" } })),
  requestConversationCancel: vi.fn(async () => ({ status: 202, body: { status: "stopping" } })),
}));
import { streamResponse, streamCursor, handleChatRoute, shutdownChatStreams, STREAM_HEADERS } from "../../src/lib/chat/runtime/http.server";
import { createConversationEventRelay } from "../../src/lib/chat/runtime/event-relay.server";
import { recoverConversationStream } from "../../src/lib/chat/runtime/recover-conversation-stream.server";
import { publicDelta, publicRow, PUBLIC_ERROR } from "../../src/lib/chat/runtime/public-frame.server";
import { createTextLimiter } from "../../src/lib/chat/rate-limit.server";
import type { ConversationSessionStateFrame } from "../../src/lib/chat/contracts";
import type { SessionEventRecord } from "../../src/lib/chat/projections";
const frame: ConversationSessionStateFrame = { runtimeStatus: "waiting", status: "completed", activeRequestIdPresent: false, activeTurnId: null, pendingWakeupAt: null, waitingOnApproval: false };
const row = (seq: number, payload: Record<string, unknown> = {}): SessionEventRecord => ({ id: `row-${seq}`, conversationId: "c", seq, type: "user_message", payload });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
afterEach(async () => { await shutdownChatStreams(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("edge SSE recovery with Q7 delivery edits", () => {
  it("subscribes before paging, deduplicates replay and forwards same-row delivery changes", async () => {
    const relay = createConversationEventRelay(); const received: SessionEventRecord[] = [];
    const pending = row(0, { delivery: "pending" }); const sent = row(0, { delivery: "sent" });
    let pages = 0;
    const close = await recoverConversationStream({ relay, state: async () => frame,
      loadEvents: async () => {
        pages++;
        if (pages === 1) { relay.publish("c", 0, pending); return { events: [pending], hasMore: true, nextAfterSeq: 0 }; }
        relay.publish("c", 0, sent); return { events: [row(1)], hasMore: false, nextAfterSeq: 1 };
      },
    }, { conversationId: "c", afterSeq: -1, signal: new AbortController().signal, onActivity: (_seq, r) => received.push(r), onDelta: () => {}, onState: () => {}, onDone: () => {} });
    expect(received.map(r => [r.seq, r.payload.delivery])).toEqual([[0, "pending"], [1, undefined], [0, "sent"]]);
    relay.publish("c", 0, sent); expect(received).toHaveLength(3);
    relay.publish("c", 2, row(2)); expect(received.at(-1)?.seq).toBe(2);
    close(); relay.publish("c", 3, row(3)); expect(received).toHaveLength(4);
  });
  it("restores in-flight snapshots and current state after the durable replay", async () => {
    const relay = createConversationEventRelay(); const calls: string[] = [];
    relay.publishDelta("c", { blockId: "a", text: "Hello ", variant: "message", done: false });
    const close = await recoverConversationStream({ relay, state: async () => frame, loadEvents: async () => ({ events: [row(0)], hasMore: false, nextAfterSeq: 0 }) }, {
      conversationId: "c", afterSeq: -1, signal: new AbortController().signal, onActivity: () => calls.push("activity"), onDelta: () => calls.push("delta"), onState: () => calls.push("state"), onDone: () => calls.push("done"),
    });
    expect(calls).toEqual(["activity", "delta", "state"]); close();
  });
  it("unsubscribes all three channels immediately when aborted during replay", async () => {
    const relay = createConversationEventRelay(); const cleanups: ReturnType<typeof vi.fn>[] = [];
    for (const method of ["subscribe", "subscribeDeltas", "subscribeState"] as const) {
      const original = relay[method].bind(relay);
      // Every channel has a different callback type; preserving it through the
      // spy implementation is checked by the original subscription call.
      vi.spyOn(relay, method).mockImplementation(((...args: Parameters<typeof original>) => {
        const unsubscribe = Reflect.apply(original, relay, args) as () => void;
        const cleanup = vi.fn(unsubscribe); cleanups.push(cleanup); return cleanup;
      }) as typeof original);
    }
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const controller = new AbortController(); const activity = vi.fn(); const state = vi.fn();
    const recovery = recoverConversationStream({ relay, loadEvents: async () => { await gate; return { events: [row(0)], hasMore: false, nextAfterSeq: 0 }; }, state: async () => frame }, {
      conversationId: "c", afterSeq: -1, signal: controller.signal, onActivity: activity, onDelta: vi.fn(), onState: state, onDone: vi.fn(),
    });
    controller.abort(); expect(cleanups).toHaveLength(3); for (const cleanup of cleanups) expect(cleanup).toHaveBeenCalledTimes(1);
    release(); const close = await recovery; close(); expect(activity).not.toHaveBeenCalled(); expect(state).not.toHaveBeenCalled();
  });
  it("does not overwrite a newer live state with a stale asynchronous state read", async () => {
    const relay = createConversationEventRelay(); const states: string[] = [];
    const close = await recoverConversationStream({ relay, loadEvents: async () => ({ events: [], hasMore: false, nextAfterSeq: -1 }),
      state: async () => { relay.publishState("c", { ...frame, runtimeStatus: "active" }); return frame; } }, {
      conversationId: "c", afterSeq: -1, signal: new AbortController().signal, onActivity: () => {}, onDelta: () => {}, onState: state => states.push(state.runtimeStatus!), onDone: () => {},
    });
    expect(states).toEqual(["active"]); close();
  });
});

describe("resource route Response stream", () => {
  it("preserves exact headers, first comment, activity/state/delta/done frame names and bytes", async () => {
    vi.useFakeTimers(); const relay = createConversationEventRelay();
    const response = streamResponse(new Request("https://trip.test/stream?after=-1"), "c", { relay, state: async () => frame, loadEvents: async () => ({ events: [row(0, { text: "Hi" })], hasMore: false, nextAfterSeq: 0 }) });
    for (const [key, value] of Object.entries(STREAM_HEADERS)) expect(response.headers.get(key)).toBe(value);
    const reader = response.body!.getReader(); const decode = async () => new TextDecoder().decode((await reader.read()).value);
    expect(await decode()).toBe(": heartbeat\n\n");
    expect(await decode()).toBe('id: 0\nevent: activity\ndata: {"id":"row-0","seq":0,"type":"user_message","payload":{"text":"Hi"}}\n\n');
    expect(await decode()).toBe(`event: state\ndata: ${JSON.stringify(frame)}\n\n`);
    relay.publishDelta("c", { blockId: "a", variant: "message", text: "Hello ", done: false });
    expect(await decode()).toBe('event: delta\ndata: {"blockId":"a","variant":"message","text":"Hello ","done":false}\n\n');
    await vi.advanceTimersByTimeAsync(15_000); expect(await decode()).toBe(": heartbeat\n\n");
    relay.publish("c", 1, { ...row(1), type: "session.completed" });
    expect(await decode()).toContain("event: activity\n"); expect(await decode()).toBe("event: done\ndata: {}\n\n");
    expect((await reader.read()).done).toBe(true); reader.releaseLock(); expect(vi.getTimerCount()).toBe(0);
  });
  it("emits the exact error frame with public copy, then cleans up", async () => {
    vi.useFakeTimers();
    const response = streamResponse(new Request("https://trip.test/stream"), "c", { relay: createConversationEventRelay(), state: async () => frame, loadEvents: async () => { throw new Error("postgres://admin:secret@neon.internal/db"); } });
    expect(await response.text()).toBe(`: heartbeat\n\nevent: error\ndata: {"error":"${PUBLIC_ERROR}"}\n\n`);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("clears heartbeat and late-returning unsubscribe after reader cancellation", async () => {
    vi.useFakeTimers(); const relay = createConversationEventRelay();
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const response = streamResponse(new Request("https://trip.test/stream"), "c", { relay, state: async () => frame, loadEvents: async () => { await gate; return { events: [row(0)], hasMore: false, nextAfterSeq: 0 }; } });
    const reader = response.body!.getReader(); await reader.read(); await reader.cancel(); release(); await flush();
    relay.publish("c", 1, row(1)); expect((await reader.read()).done).toBe(true); expect(vi.getTimerCount()).toBe(0); reader.releaseLock();
  });
  it("selects max query/header reconnect cursor and rejects invalid values", () => {
    expect(streamCursor(new Request("https://trip.test/stream?after=4", { headers: { "Last-Event-ID": "9" } }))).toBe(9);
    expect(streamCursor(new Request("https://trip.test/stream?after=no", { headers: { "Last-Event-ID": "-2" } }))).toBe(-1);
  });
  it("validates POST, idempotency, delivery mode, origin and attachment exclusion", async () => {
    const request = (body: unknown, headers = {}) => new Request("https://trip.test/api/chat/conversations", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "r", ...headers }, body: JSON.stringify(body) });
    expect((await handleChatRoute("conversations", { request: request({ text: "Hi" }), params: {} })).status).toBe(201);
    expect((await handleChatRoute("messages", { request: request({ text: "Hi", deliveryMode: "wrong" }), params: { conversationId: "c" } })).status).toBe(400);
    expect((await handleChatRoute("messages", { request: request({ text: "Hi", uploadId: "file" }), params: { conversationId: "c" } })).status).toBe(400);
    expect((await handleChatRoute("conversations", { request: request({ text: "Hi" }, { Origin: "https://evil.test" }), params: {} })).status).toBe(403);
    expect((await handleChatRoute("conversations", { request: request({ text: "Hi" }, { "Idempotency-Key": "" }), params: {} })).status).toBe(400);
  });
  it("uses loaders/actions without default React component exports", async () => {
    const modules = await Promise.all([import("../../app/routes/api.chat.conversations"), import("../../app/routes/api.chat.conversation"), import("../../app/routes/api.chat.status"), import("../../app/routes/api.chat.stream"), import("../../app/routes/api.chat.messages"), import("../../app/routes/api.chat.cancel")]);
    expect(modules.map(module => "default" in module)).toEqual([false, false, false, false, false, false]);
    expect(modules.map(module => "action" in module ? "action" : "loader")).toEqual(["action", "loader", "loader", "loader", "action", "action"]);
  });
});

describe("public boundary and in-process bucket", () => {
  it("drops tool input/results and replaces internal errors", () => {
    const safe = publicRow({ ...row(1, { input: { password: "secret" }, result: "booking ABC123", error: "SQL password=secret", text: "Booking reference ABC123 and sk-secret-key", toolName: "getRooms", invocationId: "call-1" }), type: "tool_result" });
    const encoded = JSON.stringify(safe);
    expect(encoded).not.toContain("secret"); expect(encoded).not.toContain("ABC123"); expect(safe.payload.error).toBe(PUBLIC_ERROR);
    expect(publicRow(row(2, { deliveryError: "private failure" })).payload.deliveryError).toBe(PUBLIC_ERROR);
    expect(safe.payload.invocationId).toBe("call-1"); expect(safe.payload).not.toHaveProperty("input");
  });
  it("withholds unfinished fragments and never exposes raw reasoning", () => {
    expect(publicDelta({ blockId: "x", variant: "message", text: "Hello sk-secr", done: false }).text).toBe("Hello ");
    expect(publicDelta({ blockId: "x", variant: "reasoning", text: "password secret", done: false }).text).toBe("Thinking through the next step...");
  });
  it("allows ten messages, refills one per six seconds and bounds expired keys without timers", () => {
    let now = 0; const bucket = createTextLimiter(() => now, 2);
    for (let i = 0; i < 10; i++) expect(bucket.take("a")).toBe(0);
    expect(bucket.take("a")).toBe(6); now = 6_000; expect(bucket.take("a")).toBe(0);
    expect(bucket.take("b")).toBe(0); expect(bucket.take("c")).toBe(6);
    now = 70_000; expect(bucket.take("c")).toBe(0); expect(bucket.size()).toBe(1); bucket.clear(); expect(bucket.size()).toBe(0);
  });
});

it("does not close on a stale closed-state read after a newer active frame", async () => {
  const relay = createConversationEventRelay(); const done = vi.fn();
  const close = await recoverConversationStream({ relay, loadEvents: async () => ({ events: [], hasMore: false, nextAfterSeq: -1 }), state: async () => { relay.publishState("c", { ...frame, runtimeStatus: "active" }); return { ...frame, runtimeStatus: "closed" }; } }, {
    conversationId: "c", afterSeq: -1, signal: new AbortController().signal, onActivity: () => {}, onDelta: () => {}, onState: () => {}, onDone: done,
  });
  expect(done).not.toHaveBeenCalled(); close();
});
