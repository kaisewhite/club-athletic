// Q7 lifecycle-seam regression fixtures for the two provider-attachment races the
// live runtime hit: a follow-up turn whose events land in the window between the
// pump's history snapshot and its live subscription, and a cancel whose provider
// evidence lands in the same window.
//
// The fake provider below models the two properties of the real Managed Agents
// session API that make the window fatal, both verified against 0.122.0:
//   1. `events.stream` has no cursor (`EventStreamParams` carries only
//      `event_deltas`), so a subscription replays nothing — it delivers only what
//      is produced after it attaches.
//   2. The provider holds an idle session's stream open indefinitely, so the
//      pump's `for await` never returns and the reconnect loop never re-reads
//      history to notice what it missed.
// Together those mean any event produced between the snapshot and the
// subscription is invisible for the lifetime of the attachment.
import { describe, expect, it, vi } from "vitest";
import { executeManagedAgentSession, type PumpDeps } from "../../src/lib/chat/runtime/conversation-managed-agent-session.server";
import type { ManagedAgentsProvider, ProviderEvent } from "../../src/lib/managed-agents/client.server";
import type { InsertConversationEventResult } from "../../src/lib/db/chat-writes.server";

const message = (id: string, text = "The bus leaves at 10:30.") => ({ id, type: "agent.message", content: [{ type: "text", text }] });
const idle = (id: string, stop: Record<string, unknown> = { type: "end_turn" }) => ({ id, type: "session.status_idle", stop_reason: stop });
const running = (id: string) => ({ id, type: "session.status_running" });
const userMessage = (id: string, text: string) => ({ id, type: "user.message", content: [{ type: "text", text }] });
const toolCall = (id: string, name: string) => ({ id, type: "agent.custom_tool_use", name, input: {} });
const toolResult = (id: string, callId: string) => ({ id, type: "user.custom_tool_result", custom_tool_use_id: callId, content: [{ type: "text", text: "{\"ok\":true}" }] });

/** A turn-1 transcript exactly as the live provider records it, through its
 * `session.status_idle {end_turn}` boundary, plus the opening events of a
 * follow-up turn that `provider.send` has already started. */
const settledFirstTurn: ProviderEvent[] = [
  running("t1-start"),
  userMessage("t1-ask", "What time do I need to land?"),
  toolCall("t1-call", "getFlightRules"),
  idle("t1-wait", { type: "requires_action", event_ids: ["t1-call"] }),
  toolResult("t1-result", "t1-call"),
  running("t1-resume"),
  message("t1-answer", "Land by 08:30."),
  idle("t1-end"),
];
const followUpOpening: ProviderEvent[] = [running("t2-start"), userMessage("t2-ask", "And what time does the bus leave?")];

function racingPumpFixture(seed: ProviderEvent[]) {
  const log: ProviderEvent[] = [...seed];
  const subscribers = new Set<(event: ProviderEvent) => void>();
  const rows = new Map<string, InsertConversationEventResult>();
  const applied = new Set<string>();
  const order: string[] = [];
  let state = "active";
  let queue = 0;
  let historyCalls = 0;
  let snapshotTaken!: () => void;
  const captured = new Promise<void>(resolve => { snapshotTaken = resolve; });
  let openGate!: () => void;
  const gate = new Promise<void>(resolve => { openGate = resolve; });

  const provider: ManagedAgentsProvider = {
    create: vi.fn(async () => "session"),
    send: vi.fn(async () => {}),
    interrupt: vi.fn(async () => { emit({ id: `interrupt-${log.length}`, type: "user.interrupt" }); }),
    threads: vi.fn(async () => []),
    threadHistory: vi.fn(async () => []),
    // A paginated snapshot: the rows are chosen when the read starts, and the
    // read only resolves later. The first read is the slow one, as in production
    // where it pages a whole prior turn.
    history: vi.fn(async () => {
      const snapshot = [...log];
      order.push(`history:${snapshot.length}`);
      if (++historyCalls === 1) { snapshotTaken(); await gate; }
      return snapshot;
    }),
    // Live-only, and never ends by itself.
    stream: vi.fn((_session: string, signal: AbortSignal) => ({
      async *[Symbol.asyncIterator]() {
        const pending: ProviderEvent[] = [];
        let wake: (() => void) | undefined;
        const push = (event: ProviderEvent) => { pending.push(event); wake?.(); };
        subscribers.add(push);
        order.push("subscribed");
        try {
          for (;;) {
            while (pending.length) yield pending.shift()!;
            if (signal.aborted) return;
            await new Promise<void>(resolve => {
              const settle = () => resolve();
              wake = settle;
              signal.addEventListener("abort", settle, { once: true });
            });
          }
        } finally { subscribers.delete(push); order.push("unsubscribed"); }
      },
    })),
  };
  const emit = (...events: ProviderEvent[]) => {
    for (const event of events) { log.push(event); for (const push of [...subscribers]) push(event); }
  };

  const deps: PumpDeps = {
    provider,
    ingest: vi.fn(async input => {
      const previous = rows.get(input.providerEventKey);
      if (previous) return { ...previous, duplicate: true };
      const row = { id: input.providerEventKey, conversationId: "c", seq: rows.size, type: input.type, payload: input.payload, duplicate: false };
      rows.set(input.providerEventKey, row);
      order.push(`persist:${input.type}`);
      return row;
    }),
    apply: vi.fn(async row => {
      if (applied.has(row.id)) return null;
      applied.add(row.id);
      if (!row.payload.continuation) { state = "waiting"; order.push("park"); }
      return null;
    }),
    active: vi.fn(async () => { state = "active"; order.push("active"); }),
    state: vi.fn(async () => {}),
    approval: vi.fn(),
    delta: vi.fn(),
    clear: vi.fn(),
    hasQueue: vi.fn(async () => queue > 0),
    continueQueue: vi.fn(async () => {
      if (!queue) return false;
      queue--; state = "active"; order.push("send.queued");
      emit(running(`q-start-${queue}`), userMessage(`q-ask-${queue}`, "Which nights is there no chef dinner?"));
      return true;
    }),
    waiting: async () => state === "waiting",
    maxStaleReconnects: 0,
    sleep: vi.fn(async () => {}),
  };
  const controller = new AbortController();
  return {
    rows, applied, order, deps, provider, controller, captured, emit,
    releaseHistory: openGate,
    queued: (count: number) => { queue = count; },
    state: () => state,
    run: (streamIndex = 0) => executeManagedAgentSession({ sessionId: "session", streamIndex, signal: controller.signal }, deps),
  };
}

/** Fail fast instead of hanging: a pump that never settles is the defect. */
async function settles<T>(task: Promise<T>, ms = 3_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("the pump never settled this turn")), ms); timer.unref?.(); }),
    ]);
  } finally { clearTimeout(timer); }
}

describe("a follow-up turn whose provider events land during the history read", () => {
  it("still reaches turn.completed and parks the conversation", async () => {
    const f = racingPumpFixture([...settledFirstTurn, ...followUpOpening]);
    const run = f.run(8);
    try {
      await f.captured;
      // The provider finishes the whole follow-up turn while the snapshot read is
      // still in flight. `events.stream` will never replay any of this.
      f.emit(toolCall("t2-call", "getShuttles"), idle("t2-wait", { type: "requires_action", event_ids: ["t2-call"] }),
        toolResult("t2-result", "t2-call"), running("t2-resume"), message("t2-answer"), idle("t2-end"));
      f.releaseHistory();
      await settles(run);
    } finally { f.controller.abort(); }
    expect(f.rows.get("t2-answer")?.payload.text).toBe("The bus leaves at 10:30.");
    expect(f.rows.get("t2-end")?.type).toBe("turn.completed");
    expect(f.applied.has("t2-end")).toBe(true);
    expect(f.state()).toBe("waiting");
  });

  it("subscribes to the live stream before reading the durable snapshot", async () => {
    const f = racingPumpFixture([...settledFirstTurn, ...followUpOpening]);
    const run = f.run(8);
    try {
      await f.captured;
      f.emit(message("t2-answer"), idle("t2-end"));
      f.releaseHistory();
      await settles(run);
    } finally { f.controller.abort(); }
    // The ordering is the fix: a snapshot taken before the subscription exists
    // leaves a window in which events belong to neither source.
    expect(f.order.indexOf("subscribed")).toBeLessThan(f.order.indexOf("history:10"));
  });

  it("delivers a message queued during that turn instead of stranding it", async () => {
    const f = racingPumpFixture([...settledFirstTurn, ...followUpOpening]);
    f.queued(1);
    const run = f.run(8);
    try {
      await f.captured;
      f.emit(message("t2-answer"), idle("t2-end"));
      f.releaseHistory();
      // The queued third turn is sent at the follow-up's boundary and answered live.
      await new Promise(resolve => setTimeout(resolve, 50));
      f.emit(message("t3-answer", "There is no chef dinner on Wednesday or Saturday."), idle("t3-end"));
      await settles(run);
    } finally { f.controller.abort(); }
    expect(f.deps.continueQueue).toHaveBeenCalled();
    // The recovered boundary hands off to the queue instead of parking on it, so the
    // conversation never advertises an idle turn it is about to leave.
    expect(f.order.indexOf("send.queued")).toBeLessThan(f.order.indexOf("park"));
    expect(f.rows.get("t2-end")?.type).toBe("turn.completed");
    expect(f.rows.get("t3-answer")?.payload.text).toBe("There is no chef dinner on Wednesday or Saturday.");
    expect(f.rows.get("t3-end")?.type).toBe("turn.completed");
    expect(f.state()).toBe("waiting");
  });
});

describe("a cancel whose provider evidence lands during the history read", () => {
  it("reaches turn.cancelled so the conversation settles instead of staying stopping", async () => {
    const f = racingPumpFixture([...settledFirstTurn, ...followUpOpening]);
    const run = f.run(8);
    try {
      await f.captured;
      // requestConversationCancel appends user.interrupt; the provider then ends
      // the turn. Both land inside the snapshot/subscription window.
      await f.provider.interrupt("session", f.controller.signal);
      f.emit(idle("t2-stopped"));
      f.releaseHistory();
      await settles(run);
    } finally { f.controller.abort(); }
    expect(f.rows.get("t2-stopped")?.type).toBe("turn.cancelled");
    expect(f.applied.has("t2-stopped")).toBe(true);
    expect(f.state()).toBe("waiting");
  });
});


/** Fail fast on a condition that should already hold or hold very soon: a fixture
 * that hangs here is describing a row the browser never received. */
async function until(predicate: () => boolean, what: string, ms = 2_000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

/** The live-activity fixture. It differs from the racing fixture above in one
 * property, and that property is the whole bug: *every* snapshot read is gated,
 * not just the first. Production pages a whole transcript, so a catch-up pass takes
 * real time, and the provider keeps producing the running turn's events for the
 * entire duration of that read. Anything the pump parks behind those reads is
 * invisible to the guest until the turn is already over. */
function liveActivityFixture(seed: ProviderEvent[]) {
  const log: ProviderEvent[] = [...seed];
  const subscribers = new Set<(event: ProviderEvent) => void>();
  const rows = new Map<string, InsertConversationEventResult>();
  const applied = new Set<string>();
  // Exactly what the browser has been handed, in order, by provider event id.
  // `ingest` publishes a fresh row unless the pump defers it, and a deferred row is
  // published through `relay` — the two seams `ingestSessionEvent` and the pump use.
  const delivered: string[] = [];
  const gates: Array<() => void> = [];
  let reads = 0;
  let ungated = false;
  let state = "active";
  const provider: ManagedAgentsProvider = {
    create: vi.fn(async () => "session"),
    send: vi.fn(async () => {}),
    interrupt: vi.fn(async () => { emit({ id: `interrupt-${log.length}`, type: "user.interrupt" }); }),
    threads: vi.fn(async () => []),
    threadHistory: vi.fn(async () => []),
    history: vi.fn(async () => {
      // The rows are chosen when the read starts; it resolves only when released.
      const snapshot = [...log];
      reads++;
      if (!ungated) await new Promise<void>(resolve => { gates.push(resolve); });
      return snapshot;
    }),
    stream: vi.fn((_session: string, signal: AbortSignal) => ({
      async *[Symbol.asyncIterator]() {
        const pending: ProviderEvent[] = [];
        let wake: (() => void) | undefined;
        const push = (event: ProviderEvent) => { pending.push(event); wake?.(); };
        subscribers.add(push);
        try {
          for (;;) {
            while (pending.length) yield pending.shift()!;
            if (signal.aborted) return;
            await new Promise<void>(resolve => {
              const settle = () => resolve();
              wake = settle;
              signal.addEventListener("abort", settle, { once: true });
            });
          }
        } finally { subscribers.delete(push); }
      },
    })),
  };
  const emit = (...events: ProviderEvent[]) => {
    for (const event of events) { log.push(event); for (const push of [...subscribers]) push(event); }
  };
  const deps: PumpDeps = {
    provider,
    ingest: vi.fn(async input => {
      const previous = rows.get(input.providerEventKey);
      if (previous) return { ...previous, duplicate: true };
      const row = { id: input.providerEventKey, conversationId: "c", seq: rows.size, type: input.type, payload: input.payload, duplicate: false };
      rows.set(input.providerEventKey, row);
      if (!input.deferRelay) delivered.push(input.providerEventKey);
      return row;
    }),
    relay: row => { delivered.push(row.id); },
    apply: vi.fn(async row => { if (!applied.has(row.id)) { applied.add(row.id); if (!row.payload.continuation) state = "waiting"; } return null; }),
    active: vi.fn(async () => { state = "active"; }),
    state: vi.fn(async () => {}),
    approval: vi.fn(),
    delta: vi.fn(),
    clear: vi.fn(),
    hasQueue: vi.fn(async () => false),
    continueQueue: vi.fn(async () => false),
    waiting: async () => state === "waiting",
    maxStaleReconnects: 0,
    sleep: vi.fn(async () => {}),
  };
  const controller = new AbortController();
  return {
    rows, applied, delivered, deps, provider, controller, emit,
    seq: (key: string) => rows.get(key)?.seq,
    turn2: () => delivered.filter(id => id.startsWith("t2-")),
    /** Wait until snapshot read `n` has started and is blocked in flight. */
    reading: (n: number) => until(() => reads >= n && gates.length > 0, `snapshot read ${n} to be in flight`),
    release: () => { gates.shift()?.(); },
    /** Stop gating reads so the turn can settle. */
    open: () => { ungated = true; while (gates.length) gates.shift()!(); },
    waitDelivered: (id: string) => until(() => delivered.includes(id), `the client to receive ${id}`),
    run: (streamIndex = 0) => executeManagedAgentSession({ sessionId: "session", streamIndex, signal: controller.signal }, deps),
  };
}

describe("tool activity produced while the pump is still replaying history", () => {
  it("reaches the client during the turn instead of after it", async () => {
    const f = liveActivityFixture([...settledFirstTurn, ...followUpOpening]);
    const run = f.run(8);
    try {
      await f.reading(1);
      f.release();
      // The pump is now inside a catch-up snapshot read, which is where the live
      // runtime spends most of a turn. The turn keeps working the whole time.
      await f.reading(2);
      f.emit({ type: "event_start", event: { id: "t2-answer", type: "agent.message" } },
        { type: "event_delta", event_id: "t2-answer", delta: { type: "content_delta", content: { text: "The bus " } } },
        toolCall("t2-call", "getShuttles"), toolResult("t2-result", "t2-call"));
      // The guest must see the tool rows now, not once the answer is already in.
      await f.waitDelivered("t2-call");
      await f.waitDelivered("t2-result");
      expect(f.delivered).not.toContain("t2-answer");
      f.emit(message("t2-answer"), idle("t2-end"));
      f.open();
      await settles(run);
    } finally { f.controller.abort(); }
    expect(f.turn2()).toEqual(["t2-call", "t2-result", "t2-answer", "t2-end"]);
    expect(f.rows.get("t2-end")?.type).toBe("turn.completed");
    expect(f.applied.has("t2-end")).toBe(true);
  });

  it("hands the subscription's backlog over before spending another snapshot read on it", async () => {
    const f = liveActivityFixture([...settledFirstTurn, ...followUpOpening]);
    const run = f.run(8);
    try {
      await f.reading(1);
      // Produced inside the window the first snapshot cannot contain: the buffer is
      // the only place these rows exist, and it must not hold them for the turn. The
      // `session.status_running` in front of them owes no durable row, so it must not
      // hold them either — a working turn is full of those.
      f.emit(running("t2-resume"), toolCall("t2-call", "getShuttles"), toolResult("t2-result", "t2-call"));
      f.release();
      await f.reading(2);
      expect(f.delivered).toContain("t2-call");
      expect(f.delivered).toContain("t2-result");
      f.emit(message("t2-answer"), idle("t2-end"));
      f.open();
      await settles(run);
    } finally { f.controller.abort(); }
    expect(f.turn2()).toEqual(["t2-call", "t2-result", "t2-answer", "t2-end"]);
  });

  it("keeps provider order, so a tool call after the answer text never jumps above it", async () => {
    const f = liveActivityFixture([...settledFirstTurn, ...followUpOpening]);
    const run = f.run(8);
    try {
      await f.reading(1);
      f.release();
      await f.reading(2);
      f.emit(toolCall("t2-call", "getShuttles"), toolResult("t2-result", "t2-call"), message("t2-answer"),
        toolCall("t2-late", "getBeds"), toolResult("t2-late-result", "t2-late"));
      await f.waitDelivered("t2-late-result");
      f.emit(idle("t2-end"));
      f.open();
      await settles(run);
    } finally { f.controller.abort(); }
    // Ordering is by `seq`, and `seq` must follow the provider's own order.
    expect(f.seq("t2-call")!).toBeLessThan(f.seq("t2-answer")!);
    expect(f.seq("t2-answer")!).toBeLessThan(f.seq("t2-late")!);
    expect(f.turn2()).toEqual(["t2-call", "t2-result", "t2-answer", "t2-late", "t2-late-result", "t2-end"]);
  });
});
