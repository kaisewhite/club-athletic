import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatWrites } from "../../src/lib/db/chat-writes.server";
import type { ChatDatabase } from "../../src/lib/db/chat-client.server";

const fakeClient = vi.hoisted(() => ({ send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}) }));
vi.mock("../../src/lib/managed-agents/client.server", () => ({ createManagedAgentsClient: () => fakeClient }));

/** Regression fixture first: a boundary was never projected before a later turn
 * began. Replaying it must not erase that later turn's durable ownership. */
export const resumeHistory = [
  { id: "old-end", type: "session.status_idle", stop_reason: { type: "end_turn" } },
  { id: "new-start", type: "session.status_running" },
  { id: "new-answer", type: "agent.message", content: [{ type: "text", text: "Still working." }] },
];

function fixture() {
  const conversation = { id: "c", tripId: "trip", status: "running", runtimeStatus: "active", activeRequestId: "new-request", activeTurnId: "new-start", finishedAt: null, error: null };
  const events: Record<string, unknown>[] = [];
  const tx = {
    conversation: {
      findFirst: vi.fn(async () => conversation),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(conversation, data); return conversation; }),
    },
    message: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => events.find(row => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { const row = events.find(row => row.id === where.id)!; Object.assign(row, data); return row; }),
      findMany: vi.fn(async () => events),
    },
    $queryRaw: vi.fn(async () => [conversation]),
  };
  const db = { ...tx, $transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(tx) };
  return { conversation, events, writes: createChatWrites(db as unknown as ChatDatabase) };
}

describe("Task 2 lifecycle seam regression fixtures", () => {
  it("records the exact missing historical boundary followed by a later active turn", () => {
    expect(resumeHistory.map(event => event.type)).toEqual(["session.status_idle", "session.status_running", "agent.message"]);
  });
  it("demonstrates that applying an old boundary clears a newer durable request", async () => {
    const f = fixture();
    f.events.push({ id: "old-end", conversationId: "c", seq: 5, type: "turn.completed", payload: {}, lifecycleAppliedAt: null });
    await f.writes.parkConversationTurn({ conversationId: "c", eventId: "old-end", status: "completed" });
    expect(f.conversation).toMatchObject({ status: "completed", runtimeStatus: "waiting", activeRequestId: null, activeTurnId: null });
  });
  it("demonstrates that replaying the applied boundary cannot restore the erased request", async () => {
    const f = fixture();
    f.events.push({ id: "old-end", conversationId: "c", seq: 5, type: "turn.completed", payload: {}, lifecycleAppliedAt: null });
    await f.writes.parkConversationTurn({ conversationId: "c", eventId: "old-end", status: "completed" });
    await f.writes.updateConversationSessionState({ conversationId: "c", runtimeStatus: "active" });
    expect(await f.writes.parkConversationTurn({ conversationId: "c", eventId: "old-end", status: "completed" })).toBeNull();
    expect(f.conversation.activeRequestId).toBeNull();
  });
});

import { executeManagedAgentSession, type PumpDeps } from "../../src/lib/chat/runtime/conversation-managed-agent-session.server";
import { createPumpRegistry, pause } from "../../src/lib/chat/runtime/active-pumps.server";
import { createStopConfirmationTimeouts } from "../../src/lib/chat/runtime/stop-confirmation-timeout.server";
import type { ManagedAgentsProvider, ProviderEvent } from "../../src/lib/managed-agents/client.server";
import type { InsertConversationEventResult } from "../../src/lib/db/chat-writes.server";
import type { StreamDelta } from "../../src/lib/chat/contracts";

const message = (id: string, text = "Trip notes") => ({ id, type: "agent.message", content: [{ type: "text", text }] });
const boundary = (id: string) => ({ id, type: "session.status_idle", stop_reason: { type: "end_turn" } });
function pumpFixture(history: ProviderEvent[] = [], live: ProviderEvent[] = []) {
  const rows = new Map<string, InsertConversationEventResult>();
  const applied = new Set<string>();
  const order: string[] = [];
  const deltas: StreamDelta[] = [];
  let state = "active";
  let queue = 0;
  const provider: ManagedAgentsProvider = {
    create: vi.fn(async () => "session"), send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}),
    history: vi.fn(async () => history), threads: vi.fn(async () => []), threadHistory: vi.fn(async () => []),
    stream: vi.fn(async function* () { try { for (const event of live) yield event; } finally { order.push("stream.closed"); } }),
  };
  const deps: PumpDeps = {
    provider,
    ingest: vi.fn(async event => {
      const previous = rows.get(event.providerEventKey);
      if (previous) return { ...previous, duplicate: true };
      const row = { id: event.providerEventKey, conversationId: "c", seq: rows.size, type: event.type, payload: event.payload, duplicate: false };
      rows.set(event.providerEventKey, row); order.push(`persist:${event.type}`); return row;
    }),
    apply: vi.fn(async row => {
      if (!applied.has(row.id)) { applied.add(row.id); if (!row.payload.continuation) { state = "waiting"; order.push("park"); } }
    }),
    active: vi.fn(async () => { state = "active"; order.push("active"); }),
    state: vi.fn(async () => {}), approval: vi.fn(),
    delta: delta => { deltas.push({ ...delta }); order.push(delta.done ? "delta.done" : "delta.preview"); },
    clear: vi.fn(), hasQueue: vi.fn(async () => queue > 0),
    continueQueue: vi.fn(async () => { if (!queue) return false; queue--; state = "active"; order.push("send.queued"); return true; }),
    waiting: async () => state === "waiting", maxStaleReconnects: 0,
    sleep: vi.fn(async () => {}),
  };
  const controller = new AbortController();
  return { rows, applied, order, deltas, provider, deps, controller,
    queued: (count: number) => { queue = count; },
    state: () => state,
    run: (streamIndex = 0) => executeManagedAgentSession({ sessionId: "session", streamIndex, signal: controller.signal }, deps),
  };
}

describe("Managed Agents pump with fake provider streams", () => {
  it("hands cumulative preview to a durable row and retires the block without a done frame", async () => {
    const f = pumpFixture([], [
      { type: "event_start", event: { id: "answer", type: "agent.message" } },
      { type: "event_delta", event_id: "answer", delta: { type: "content_delta", content: { text: "Trip " } } },
      { type: "event_delta", event_id: "answer", delta: { type: "content_delta", content: { text: "notes" } } },
      message("answer"), boundary("end"),
    ]);
    await f.run();
    // Cumulative, and no trailing `done` frame: the durable row owns the text from
    // here, and a `done` would delete the browser's block before that row lands.
    expect(f.deltas.map(delta => delta.text)).toEqual(["Trip ", "Trip notes"]);
    expect(f.deltas.some(delta => delta.done)).toBe(false);
    expect(f.order).toContain("persist:message");
    expect(f.deps.clear).toHaveBeenCalledWith("answer");
    expect(f.order).toContain("stream.closed");
  });
  it("dispatches previews while durable replay is still in flight", async () => {
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const f = pumpFixture([], [
      { type: "event_start", event: { id: "answer", type: "agent.message" } },
      { type: "event_delta", event_id: "answer", delta: { type: "content_delta", content: { text: "Trip " } } },
      message("answer"), boundary("end"),
    ]);
    f.provider.history = vi.fn(async () => { await gate; return []; });
    const run = f.run();
    // Progressive text is the whole point: a preview queued behind replay arrives in
    // one lump at the end of the turn, because replay re-reads the transcript for as
    // long as the turn keeps producing events.
    for (let i = 0; i < 200 && f.deltas.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(f.deltas.map(delta => delta.text)).toEqual(["Trip "]);
    expect(f.order).not.toContain("persist:message");
    release();
    await run;
    expect(f.order).toContain("persist:message");
  });
  it("withdraws a preview when the model request ends without producing its event", async () => {
    const f = pumpFixture([], [
      { type: "event_start", event: { id: "answer", type: "agent.message" } },
      { type: "event_delta", event_id: "answer", delta: { type: "content_delta", content: { text: "Half " } } },
      { id: "req", type: "span.model_request_end" },
      boundary("end"),
    ]);
    await f.run();
    // No durable row is coming, so the half-streamed bubble must be taken off screen.
    expect(f.deltas.at(-1)).toMatchObject({ blockId: "answer", text: "Half ", done: true });
    expect(f.deps.clear).toHaveBeenCalledWith("answer");
  });
  it("withdraws an in-flight preview when the pump is cancelled mid-stream", async () => {
    const f = pumpFixture([], [
      { type: "event_start", event: { id: "answer", type: "agent.message" } },
      { type: "event_delta", event_id: "answer", delta: { type: "content_delta", content: { text: "Partial " } } },
    ]);
    const run = f.run();
    for (let i = 0; i < 200 && f.deltas.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 5));
    f.controller.abort();
    await run.catch(() => {});
    expect(f.deltas.at(-1)).toMatchObject({ blockId: "answer", done: true });
  });
  it("deduplicates provider replay without skipping streamIndex events", async () => {
    const f = pumpFixture([message("a")], [message("a"), message("b"), boundary("end")]);
    await f.run(500);
    expect([...f.rows.keys()]).toEqual(["a", "b", "end"]);
    expect(f.rows.get("b")?.payload.text).toBe("Trip notes");
  });
  it("drains an unpersisted historical boundary followed by a later active turn", async () => {
    const f = pumpFixture(resumeHistory, [message("later-final"), boundary("later-end")]);
    await f.run(999);
    expect([...f.rows.keys()]).toEqual(["old-end", "new-answer", "later-final", "later-end"]);
    expect(f.applied.has("old-end")).toBe(false);
    expect(f.order.indexOf("active")).toBeLessThan(f.order.indexOf("persist:message", f.order.indexOf("active")));
    expect(f.order.filter(value => value === "park")).toHaveLength(1);
  });
  it("does not deliver a queued message at an obsolete replay boundary", async () => {
    const f = pumpFixture(resumeHistory, [boundary("latest-end"), { id: "next-start", type: "session.status_running" }, boundary("next-end")]);
    f.queued(1); await f.run();
    expect(f.order.indexOf("send.queued")).toBeGreaterThan(f.order.indexOf("persist:turn.completed", f.order.indexOf("active")));
    expect(f.rows.get("latest-end")?.payload.continuation).toBe(true);
    expect(f.applied.has("old-end")).toBe(false);
  });
  it("continues its queue without parking between turns", async () => {
    const f = pumpFixture([], [boundary("first"), { id: "start-next", type: "session.status_running" }, boundary("second")]);
    f.queued(1); await f.run();
    expect(f.rows.get("first")?.payload.continuation).toBe(true);
    expect(f.order.indexOf("send.queued")).toBeLessThan(f.order.indexOf("park"));
    expect(f.order.filter(value => value === "park")).toHaveLength(1);
  });
  it("recovers lifecycle after a crash between persistence and state application", async () => {
    const f = pumpFixture([boundary("end")]);
    f.rows.set("end", { id: "end", conversationId: "c", seq: 0, type: "turn.completed", payload: {}, duplicate: false });
    await f.run();
    expect(f.applied.has("end")).toBe(true);
    expect(f.state()).toBe("waiting");
    // The pump now attaches its subscription before replaying, because a snapshot read
    // first leaves a window whose events reach neither source (tests/unit/chat-turn-continuity.test.ts).
    // What must still hold is that a replayed terminal boundary ends the attachment
    // without consuming anything live: one ingest, and the subscription released.
    expect(f.deps.ingest).toHaveBeenCalledTimes(1);
    expect(f.order).toContain("stream.closed");
  });
  it("allows a follow-up after a completed turn without reapplying its old boundary", async () => {
    const f = pumpFixture([boundary("old-end"), { id: "followup-start", type: "session.status_running" }], [message("followup-answer"), boundary("followup-end")]);
    f.rows.set("old-end", { id: "old-end", conversationId: "c", seq: 0, type: "turn.completed", payload: {}, duplicate: false });
    f.applied.add("old-end"); await f.run();
    expect(f.rows.has("followup-answer")).toBe(true);
    expect(f.order).toContain("active");
    expect(f.applied.has("followup-end")).toBe(true);
  });
  it("cancels during durable replay without late state or queue effects", async () => {
    const f = pumpFixture(resumeHistory);
    const ingest = f.deps.ingest;
    f.deps.ingest = async input => { const result = await ingest(input); f.controller.abort(); return result; };
    await expect(f.run()).rejects.toBeDefined();
    expect(f.deps.apply).not.toHaveBeenCalled();
    expect(f.deps.continueQueue).not.toHaveBeenCalled();
    // Aborting mid-replay must release the subscription the pump attached first and
    // must not let a single live event through behind the abort.
    expect(f.rows.size).toBe(1);
    expect(f.order).toContain("stream.closed");
  });
  it("uses observed provider interrupt as the cancellation boundary", async () => {
    const f = pumpFixture([], [{ id: "interrupt", type: "user.interrupt" }, boundary("end")]);
    await f.run(); expect(f.rows.get("end")?.type).toBe("turn.cancelled");
  });
  it("awaits child stream cleanup and clears every preview on shutdown", async () => {
    const f = pumpFixture([], []);
    const closed: string[] = [];
    let childEntered!: () => void;
    const childReady = new Promise<void>(resolve => { childEntered = resolve; });
    f.provider.threads = async () => [{ id: "child", parent_thread_id: "root" }];
    f.provider.stream = async function* (_session, signal, thread) {
      try {
        if (thread) {
          yield { type: "event_start", event: { id: "child-answer", type: "agent.message" } };
          childEntered();
          await pause(100_000, signal);
        } else {
          await childReady; f.controller.abort(); signal.throwIfAborted();
        }
      } finally { closed.push(thread ?? "root"); }
    };
    await expect(f.run()).rejects.toBeDefined();
    expect(closed.sort()).toEqual(["child", "root"]);
    expect(f.deps.clear).toHaveBeenCalledWith("child:child-answer");
  });
});

describe("owned timers and pump lifetimes", () => {
  it("claims once and awaits provider abort before releasing ownership", async () => {
    const registry = createPumpRegistry(); let cleaned = false;
    const run = async (signal: AbortSignal) => { try { await pause(100_000, signal); } finally { cleaned = true; } };
    expect(registry.start("c", run)).toBe(true);
    expect(registry.start("c", run)).toBe(false);
    await Promise.resolve(); await registry.stop();
    expect(cleaned).toBe(true); expect(registry.count()).toBe(0);
    expect(registry.start("later", run)).toBe(false);
  });
  it("clears backoff timers/listeners on abort", async () => {
    vi.useFakeTimers(); const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    try {
      const task = pause(5_000, controller.signal); controller.abort(); await expect(task).rejects.toBeDefined();
      expect(vi.getTimerCount()).toBe(0); expect(remove).toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("owns cancellation deadlines, clears replacements and drains shutdown", async () => {
    vi.useFakeTimers(); const deadlines = createStopConfirmationTimeouts(); const check = vi.fn(async () => {});
    try {
      deadlines.schedule("c", check); deadlines.schedule("c", check);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(30_000); expect(check).toHaveBeenCalledTimes(1);
      deadlines.schedule("c", check); await deadlines.stop();
      expect(deadlines.count()).toBe(0); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});


import * as chatReads from "../../src/lib/chat/repository.server";
import * as chatWrites from "../../src/lib/db/chat-writes.server";
import { sendConversationMessage, requestConversationCancel, recoverRunningManagedAgentConversations, reconcilePendingConversationDeliveries, shutdownChatRuntime, markConversationTurnActive } from "../../src/lib/chat/runtime/runtime.server";
import { activePumps } from "../../src/lib/chat/runtime/active-pumps.server";
import * as tripReads from "../../src/lib/db/repository.server";

describe("send, cancel and startup through the accepted Task 1 seams", () => {
  afterEach(() => { vi.restoreAllMocks(); fakeClient.send.mockClear(); fakeClient.interrupt.mockClear(); });
  function services() {
    const state = { id: "c", tripId: "trip", agentSessionId: "session", status: "completed", runtimeStatus: "waiting", streamIndex: 5, activeRequestId: null as string | null, activeTurnId: null, finishedAt: new Date() };
    const user = { id: "user", conversationId: "c", seq: 6, type: "user_message", payload: { text: "Follow up", requestId: "request", delivery: "pending" }, duplicate: false };
    const order: string[] = [];
    vi.spyOn(chatReads, "loadConversationChatState").mockImplementation(async () => ({ ...state }));
    vi.spyOn(chatReads, "loadConversationSessionState").mockImplementation(async () => state);
    vi.spyOn(chatReads, "findUserMessageByRequestId").mockResolvedValue(null);
    vi.spyOn(chatReads, "hasQueuedMessages").mockResolvedValue(false);
    vi.spyOn(chatWrites, "appendUserMessage").mockImplementation(async () => { order.push("persist"); return user; });
    vi.spyOn(chatWrites, "updateConversationSessionState").mockImplementation(async input => {
      if (input.runtimeStatus) state.runtimeStatus = input.runtimeStatus;
      if (input.activeRequestId) { state.activeRequestId = input.activeRequestId; state.status = "running"; }
      return { ...state } as Awaited<ReturnType<typeof chatWrites.updateConversationSessionState>>;
    });
    vi.spyOn(chatWrites, "markUserMessageDelivery").mockImplementation(async input => { order.push(input.delivery); return { ...user, payload: { ...user.payload, delivery: input.delivery } }; });
    vi.spyOn(activePumps, "start").mockReturnValue(true);
    fakeClient.send.mockImplementation(async () => { order.push("provider"); });
    return { state, order, user };
  }
  it("persists a follow-up before sending and reactivates a completed conversation", async () => {
    const f = services();
    const result = await sendConversationMessage({ tripId: "trip", conversationId: "c" }, "Follow up", "request", "queue");
    expect(result).toMatchObject({ status: 200, body: { ok: true, delivery: "sent", seq: 6, conversationId: "c" } });
    expect(f.order).toEqual(["persist", "provider", "sent"]);
    expect(f.state).toMatchObject({ status: "running", runtimeStatus: "active", activeRequestId: "request" });
    expect(activePumps.start).toHaveBeenCalledTimes(1);
  });
  it("queues during an active turn without sending into that turn", async () => {
    const f = services(); f.state.status = "running"; f.state.runtimeStatus = "active";
    const result = await sendConversationMessage({ tripId: "trip", conversationId: "c" }, "Follow up", "request", "queue");
    expect(result.body.delivery).toBe("queued"); expect(fakeClient.send).not.toHaveBeenCalled(); expect(f.order).toEqual(["persist", "queued"]);
  });
  it("returns the original acknowledgement on duplicate sends", async () => {
    const f = services();
    vi.mocked(chatReads.findUserMessageByRequestId).mockResolvedValue({ ...f.user, duplicate: true, payload: { delivery: "sent" } });
    const result = await sendConversationMessage({ tripId: "trip", conversationId: "c" }, "Follow up", "request", "queue");
    expect(result.body).toMatchObject({ ok: true, seq: 6, delivery: "sent" });
    expect(chatWrites.appendUserMessage).not.toHaveBeenCalled(); expect(fakeClient.send).not.toHaveBeenCalled();
  });
  it("waits for provider evidence after interrupt and owns its timeout", async () => {
    vi.useFakeTimers(); const f = services(); f.state.status = "running"; f.state.runtimeStatus = "active";
    try {
      const result = await requestConversationCancel({ tripId: "trip", conversationId: "c" });
      expect(result).toEqual({ status: 202, body: { status: "stopping" } });
      expect(f.state.runtimeStatus).toBe("stopping"); expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(30_000); expect(f.state.runtimeStatus).toBe("stop_failed"); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("keeps a cancel in flight when the provider starts another turn", async () => {
    vi.useFakeTimers(); const f = services(); f.state.status = "running"; f.state.runtimeStatus = "active";
    try {
      await requestConversationCancel({ tripId: "trip", conversationId: "c" });
      expect(f.state.runtimeStatus).toBe("stopping"); expect(vi.getTimerCount()).toBe(1);
      vi.mocked(chatWrites.updateConversationSessionState).mockClear();
      // The provider keeps emitting session.status_running while it winds a turn down,
      // and the pump projects that as turn.started. Letting it reset the runtime to
      // active republished an in-flight frame and disarmed the stop-confirmation
      // deadline, which is the only escalation from an unhonoured interrupt to a
      // settled stop_failed: the guest then sees 202 "stopping" followed by nothing.
      await markConversationTurnActive({ tripId: "trip", conversationId: "c" });
      expect(f.state.runtimeStatus).toBe("stopping");
      expect(chatWrites.updateConversationSessionState).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(f.state.runtimeStatus).toBe("stop_failed");
    } finally { vi.useRealTimers(); }
  });
  it("marks a turn active and drops the stop deadline when no cancel is in flight", async () => {
    vi.useFakeTimers(); const f = services(); f.state.status = "running"; f.state.runtimeStatus = "active";
    try {
      await requestConversationCancel({ tripId: "trip", conversationId: "c" });
      f.state.runtimeStatus = "waiting";
      await markConversationTurnActive({ tripId: "trip", conversationId: "c" });
      expect(f.state.runtimeStatus).toBe("active");
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("startup recovery calls the existing resumable-conversation reader and claims one pump", async () => {
    services();
    vi.spyOn(tripReads, "getTripOverview").mockResolvedValue({ id: "trip" } as Awaited<ReturnType<typeof tripReads.getTripOverview>>);
    vi.spyOn(chatReads, "loadResumableConversations").mockResolvedValue([{ id: "c", agentSessionId: "session", streamIndex: 5 }]);
    vi.mocked(chatReads.loadConversationChatState).mockResolvedValue({ id: "c", tripId: "trip", agentSessionId: "session", status: "running", runtimeStatus: "active", activeRequestId: "followup", activeTurnId: null, finishedAt: null, streamIndex: 5 });
    await recoverRunningManagedAgentConversations();
    expect(chatReads.loadResumableConversations).toHaveBeenCalledWith("trip"); expect(activePumps.start).toHaveBeenCalledTimes(1);
  });
  it("recovers a pending delivery from ordered provider history without resending", async () => {
    const f = services();
    vi.spyOn(chatReads, "loadConversationEventsAfter").mockResolvedValue({ events: [f.user], hasMore: false, nextAfterSeq: 6 });
    await reconcilePendingConversationDeliveries({ tripId: "trip", conversationId: "c" }, [{ id: "provider-user", type: "user.message", content: [{ type: "text", text: "Follow up" }] }]);
    expect(chatWrites.markUserMessageDelivery).toHaveBeenCalledWith({ conversationId: "c", requestId: "request", delivery: "sent" });
    expect(fakeClient.send).not.toHaveBeenCalled();
  });
  it("fails an unconfirmed pending delivery without blindly resending it", async () => {
    const f = services(); f.state.activeRequestId = "request";
    vi.spyOn(chatReads, "loadConversationEventsAfter").mockResolvedValue({ events: [f.user], hasMore: false, nextAfterSeq: 6 });
    const failure = { ...f.user, id: "failure", type: "turn.failed", payload: {} };
    vi.spyOn(chatWrites, "insertConversationEventAllocating").mockResolvedValue(failure);
    vi.spyOn(chatWrites, "parkConversationTurn").mockResolvedValue(failure);
    await reconcilePendingConversationDeliveries({ tripId: "trip", conversationId: "c" }, []);
    expect(chatWrites.markUserMessageDelivery).toHaveBeenCalledWith(expect.objectContaining({ requestId: "request", delivery: "failed" }));
    expect(chatWrites.parkConversationTurn).toHaveBeenCalledWith(expect.objectContaining({ eventId: "failure", status: "failed" }));
    expect(fakeClient.send).not.toHaveBeenCalled();
  });
  it("drains runtime shutdown with no real clients or provider connections", async () => {
    await shutdownChatRuntime(); expect(activePumps.count()).toBe(0);
  });
});

import { createHash } from "node:crypto";
import { TRIP_AGENT_INSTRUCTIONS, parseManagedAgentsConfig } from "../../src/lib/managed-agents/config.server";
describe("Q2 agent instructions and fail-closed configuration", () => {
  it("states brevity and grounding as instructions without claiming API limits", () => {
    expect(TRIP_AGENT_INSTRUCTIONS).toContain("1–3 short sentences");
    expect(TRIP_AGENT_INSTRUCTIONS).toContain("not a token limit");
    expect(TRIP_AGENT_INSTRUCTIONS).toContain("without claiming older context was deleted");
    expect(TRIP_AGENT_INSTRUCTIONS).toContain("That's not in the trip notes yet — ask the organizer.");
    expect(TRIP_AGENT_INSTRUCTIONS).toContain("registered trip read tools and the single recordFlight write tool");
    expect(TRIP_AGENT_INSTRUCTIONS).toContain("attached booking screenshot at its mounted path");
    expect(TRIP_AGENT_INSTRUCTIONS).toContain("No other writes or tools are permitted");
    expect(TRIP_AGENT_INSTRUCTIONS).toContain("Never assert a flight was recorded unless recordFlight confirmed the commit");
    expect(TRIP_AGENT_INSTRUCTIONS).toContain("Never guess a name or timezone");
  });
  it("makes answering the reflex and the fallback the genuine last resort", () => {
    expect(TRIP_AGENT_INSTRUCTIONS).toContain("The fallback line is the last resort, not the reflex.");
    expect(TRIP_AGENT_INSTRUCTIONS).toContain("Reaching for that line when a tool could have answered it is a failure.");
    // Naming the read tools is what stops the model reaching for the fallback first.
    for (const tool of ["getTripOverview", "getSchedule", "getFlightTable", "getFlightRules", "getShuttles", "getProperty",
      "getRoomsByFloor", "getOpenSpots", "getChefSummary", "getGuestTasks", "getLinks", "getNotes"]) {
      expect(TRIP_AGENT_INSTRUCTIONS).toContain(tool);
    }
    expect(TRIP_AGENT_INSTRUCTIONS).toContain("do not use it to dodge a partial answer");
  });
  it("keeps social turns warm and uncited while grounded turns stay cited", () => {
    expect(TRIP_AGENT_INSTRUCTIONS).toContain("Social messages deserve a real reply.");
    expect(TRIP_AGENT_INSTRUCTIONS).toContain("must not carry a Source: line and must not use the fallback sentence");
    expect(TRIP_AGENT_INSTRUCTIONS).toContain("A Source: line belongs only on a grounded trip answer.");
    expect(TRIP_AGENT_INSTRUCTIONS).toContain("Source: and the real section names");
    // D5: plain text only, so the answer can never arrive as markdown.
    expect(TRIP_AGENT_INSTRUCTIONS).toContain("No markdown");
    expect(TRIP_AGENT_INSTRUCTIONS).toContain("at most 400 tokens");
  });
  it("forbids answering volatile facts from memory", () => {
    expect(TRIP_AGENT_INSTRUCTIONS).toContain("Live facts are never answered from memory.");
    expect(TRIP_AGENT_INSTRUCTIONS).toContain("If a tool result disagrees with memory, the tool wins");
  });
  it("pins the prompt to the digest the deployed agent manifest also pins", async () => {
    // apps/managed-agents/tests/deploy.test.ts asserts the same digest against the YAML, so
    // the two copies of the prompt cannot drift apart without one of the suites failing.
    const digest = createHash("sha256").update(TRIP_AGENT_INSTRUCTIONS, "utf8").digest("hex");
    expect(digest).toBe("69b30488a03dd9c7d1bc142d039b4dc837005b1699c9ecd0791c1b87a2910bd4");
  });
  it("requires fixed server configuration and never accepts a guest-selected agent", () => {
    expect(() => parseManagedAgentsConfig({})).toThrow("ANTHROPIC_API_KEY is required for chat.");
    expect(() => parseManagedAgentsConfig({ ANTHROPIC_API_KEY: "test-only" })).toThrow("CLAUDE_TRIP_AGENT_ID is required for chat.");
  });
  it("treats the memory store as optional so a missing id degrades instead of failing chat", () => {
    const base = { ANTHROPIC_API_KEY: "k", CLAUDE_TRIP_AGENT_ID: "agent_x", CLAUDE_MANAGED_ENVIRONMENT_ID: "env_x" };
    expect(parseManagedAgentsConfig(base).memoryStoreId).toBeUndefined();
    expect(parseManagedAgentsConfig({ ...base, CLAUDE_TRIP_MEMORY_STORE_ID: "  memstore_x  " }).memoryStoreId).toBe("memstore_x");
    expect(parseManagedAgentsConfig({ ...base, CLAUDE_TRIP_MEMORY_STORE_ID: "   " }).memoryStoreId).toBeUndefined();
  });
});
