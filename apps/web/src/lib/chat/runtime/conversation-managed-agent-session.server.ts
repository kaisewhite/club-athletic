/** Port of edge execution-managed-agent-session: preview accumulation, durable
 * ingest, explicit history, queue boundaries, reconnect, child stream ownership.
 * Q7 adaptation: history is fully drained before its latest lifecycle is applied. */
import type { ManagedAgentsProvider, ProviderEvent } from "../../managed-agents/client.server";
import { canonicalEventIdFor, contextForManagedAgentEvent, contextFromManagedAgentThread, threadRoleFromMetadata, type ManagedAgentThreadContext } from "../../managed-agents/event-identity";
import { mapManagedAgentEvent } from "../../managed-agents/map-managed-agent-event";
import type { StreamDelta } from "../contracts";
import type { SessionEventRecord } from "../projections";
import type { InsertConversationEventResult } from "../../db/chat-writes.server";
import { backfillManagedAgentTranscript } from "./managed-agent-transcript.server";
import { pause } from "./active-pumps.server";
import { logChatFailure } from "./chat-debug.server";
export interface PumpDeps {
  provider: ManagedAgentsProvider;
  reconcileDeliveries?(events: ProviderEvent[]): Promise<void>;
  withConversationLock?<T>(run: () => Promise<T>): Promise<T>;
  ingest(input: { type: string; payload: Record<string, unknown>; providerEventKey: string; streamIndex: number; deferLifecycle: boolean; deferRelay: boolean }): Promise<InsertConversationEventResult>;
  relay?(row: SessionEventRecord): void;
  apply(row: SessionEventRecord): Promise<unknown>;
  active(): Promise<void>;
  state(): Promise<void>;
  approval(pending: boolean): void;
  delta(delta: StreamDelta): void;
  clear(blockId: string): void;
  continueQueue(): Promise<boolean>;
  hasQueue(): Promise<boolean>;
  waiting(): Promise<boolean>;
  sleep?: typeof pause;
  maxStaleReconnects?: number;
}
export async function executeManagedAgentSession(input: { sessionId: string; streamIndex: number; signal: AbortSignal }, deps: PumpDeps) {
  const lifetime = new AbortController();
  const abort = () => lifetime.abort(input.signal.reason);
  input.signal.addEventListener("abort", abort, { once: true });
  if (input.signal.aborted) abort();
  const signal = lifetime.signal;
  const blocks = new Map<string, StreamDelta>();
  const consumed = new Set<string>();
  const children = new Map<string, Promise<void>>();
  let threads = new Map<string, ManagedAgentThreadContext>();
  const replayRows = new Map<string, InsertConversationEventResult>();
  let index = input.streamIndex;
  let interrupted = false;
  // Provider ids seen on the live subscription, and whether the snapshot just read
  // overlapped them. Together they decide when replay has caught up.
  const liveIds = new Set<string>();
  let overlapped = false;
  // Serialize concurrent root/child ingestion; never lose ownership of a promise.
  let ingestion = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const result = ingestion.then(run); ingestion = result.then(() => {}, () => {}); return result;
  };
  // The durable row is the source of truth, so a row that has landed simply retires
  // its preview: the browser swaps preview for row in one tick. Sending `done` here
  // would instead delete the preview immediately and leave the bubble blank for as
  // long as the row's own relay lags behind, which is a visible flicker mid-answer.
  const settleBlock = (key: string) => { blocks.delete(key); deps.clear(key); };
  // No durable row is coming — an interrupted or failed model request, or a pump
  // shutting down — so the half-streamed preview is withdrawn instead of being left
  // on screen forever. `done` is what tells the browser to drop the block.
  const abandonBlock = (key: string) => {
    const block = blocks.get(key);
    if (block) deps.delta({ ...block, done: true });
    blocks.delete(key); deps.clear(key);
  };
  // Previews are live-only and carry no durable identity, so they must never be queued
  // behind durable replay: whichever transport delivers an event calls this first, and
  // previews are dispatched straight through. A key already in `consumed` means the
  // durable event landed first, which makes any preview of it stale by definition.
  //
  // This also owns the preview's end, because only the live order can decide it. The
  // provider emits the final event before its `span.model_request_end`, so a block
  // whose final event has been seen on the wire is handed over to that durable row
  // (`settleBlock`, once it is ingested). A request that ends without one — an error or
  // an interrupt mid-stream — never produces that row, and its preview is withdrawn.
  // The drained buffer cannot make this call: its `model_request_end` events run whole
  // seconds late and would close a preview belonging to a much later request.
  const wired = new Set<string>();
  const liveArrival = (event: ProviderEvent, explicit?: ManagedAgentThreadContext): boolean => {
    const thread = explicit ?? contextForManagedAgentEvent(event, threads);
    if (event.type === "event_start") {
      const started = event.event as { id?: string; type?: string } | undefined;
      const key = canonicalEventIdFor(started?.id, thread);
      if (key && !consumed.has(key)) blocks.set(key, { blockId: key, variant: started?.type === "agent.thinking" ? "reasoning" : "message", text: "", done: false, canonicalEventId: key, providerEventId: started?.id, ...thread });
      return true;
    }
    if (event.type === "event_delta") {
      const key = canonicalEventIdFor(typeof event.event_id === "string" ? event.event_id : undefined, thread);
      const block = key ? blocks.get(key) : undefined;
      const fragment = event.delta as { type?: string; content?: { text?: unknown } } | undefined;
      if (block && !consumed.has(block.blockId) && fragment?.type === "content_delta" && typeof fragment.content?.text === "string") {
        block.text += fragment.content.text; deps.delta({ ...block });
      }
      return true;
    }
    const arrived = canonicalEventIdFor(typeof event.id === "string" ? event.id : undefined, thread);
    if (arrived && blocks.has(arrived)) wired.add(arrived);
    if (event.type === "span.model_request_end") {
      for (const [key, block] of Array.from(blocks)) {
        if ((block.threadId ?? null) !== (thread?.threadId ?? null)) continue;
        if (!wired.has(key)) abandonBlock(key);
      }
    }
    return false;
  };
  // Durable activity rows have to reach the browser as the turn produces them, for
  // the same reason previews do. `history` pages a whole transcript, so the catch-up
  // replay below spans most of a live turn, and a row parked behind it is delivered
  // only once the answer is already on screen — tool calls arriving after the answer
  // they preceded. `consumed` makes this idempotent against the replay that reads the
  // same event back, and `seq` still follows the provider's order because every
  // ingest goes through one FIFO (`serial`) and this path never overtakes a buffered
  // event that owes a row of its own (`ordered`).
  //
  // Only display rows qualify. A boundary's effects — lifecycle application, the
  // queue handoff, a terminal that ends the pump — decide the pump's control flow,
  // and only the ordered consumer at the bottom of this file can own that. And
  // `session.thread_created` has to discover its threads (an awaited provider read)
  // before anything after it is mapped, so it stays in the buffer too.
  const activityArrival = (event: ProviderEvent): boolean =>
    event.type !== "session.thread_created"
    && mapManagedAgentEvent(event, contextForManagedAgentEvent(event, threads)).kind === "display";
  const dispatchActivity = (event: ProviderEvent): Promise<boolean> =>
    serial(() => full(event, contextForManagedAgentEvent(event, threads), false));
  // Does a buffered event still owe the guest a durable row? Only those constrain
  // ordering, because `seq` is what the transcript renders by. An approval wait, a
  // `turn.started`, an interrupt, an ignored event, or one replay has already
  // consumed produces no row — and those are exactly the events that punctuate a
  // working turn: every tool confirmation emits an approval wait. Blocking on them
  // would park every row after the first tool call for the rest of the turn, which
  // is the same lump this fix exists to remove.
  const ordered = (event: ProviderEvent): boolean => {
    const thread = contextForManagedAgentEvent(event, threads);
    const key = canonicalEventIdFor(typeof event.id === "string" ? event.id : undefined, thread);
    if (!key || consumed.has(key)) return false;
    const mapped = mapManagedAgentEvent(event, thread);
    if (mapped.kind === "approval" || mapped.kind === "ignore") return false;
    return !(mapped.kind === "lifecycle" && mapped.type === "turn.started");
  };
  // False until this attachment's first snapshot has been applied. Before that the
  // pump does not yet know what preceded the subscription, and ingesting a live row
  // ahead of the snapshot would give it a `seq` below events that came before it.
  let primed = false;
  type Boundary = { row: InsertConversationEventResult; terminal: boolean };
  let latest: Boundary | "active" | "approval" | null = null;
  const fullUnlocked = async (event: ProviderEvent, thread: ManagedAgentThreadContext | undefined, replay: boolean): Promise<boolean> => {
    signal.throwIfAborted();
    const id = typeof event.id === "string" ? event.id : undefined;
    const key = canonicalEventIdFor(id, thread);
    if (!key || consumed.has(key)) return false;
    const child = threadRoleFromMetadata(thread) === "child";
    if (event.type === "user.message" && !child) latest = "active";
    if (event.type === "user.interrupt" && !child) { interrupted = true; consumed.add(key); return false; }
    const mapped = mapManagedAgentEvent(event, thread);
    if (mapped.kind === "ignore") { consumed.add(key); return false; }
    if (mapped.kind === "approval") {
      if (!child) { latest = "approval"; deps.approval(mapped.pending); if (!replay) await deps.state(); }
      consumed.add(key); return false;
    }
    if (mapped.kind === "lifecycle" && mapped.type === "turn.started") {
      if (!child) { latest = "active"; deps.approval(false); if (!replay) { await deps.active(); await deps.state(); } }
      consumed.add(key); return false;
    }
    if (child && mapped.kind !== "display") { consumed.add(key); return false; }
    const type = mapped.type === "turn.completed" && interrupted ? "turn.cancelled" : mapped.type;
    if (type === "turn.cancelled") interrupted = false;
    const boundary = mapped.kind === "lifecycle" || mapped.kind === "terminal";
    const terminal = mapped.kind === "terminal";
    const continuation = !replay && !terminal && (type === "turn.completed" || type === "turn.cancelled") && await deps.hasQueue();
    const row = await deps.ingest({ type, payload: { ...mapped.payload,
      ...(mapped.payload.activityEventId ? { activityEventId: key } : {}), ...(continuation ? { continuation: true } : {}) },
      providerEventKey: key, streamIndex: ++index, deferLifecycle: true, deferRelay: replay || boundary });
    signal.throwIfAborted();
    consumed.add(key);
    if (replay && !row.duplicate) replayRows.set(key, row);
    if (!replay && !boundary) settleBlock(key);
    if (!boundary) return false;
    latest = { row, terminal };
    if (replay) return false;
    await deps.apply(row); // duplicate may still need its atomic lifecycle effect
    if (!row.duplicate) deps.relay?.(row);
    settleBlock(key);
    deps.approval(false);
    await deps.state();
    if (terminal) return true;
    if (!row.duplicate && continuation) return !(await deps.continueQueue());
    return !row.duplicate || await deps.waiting();
  };
  const withLock = deps.withConversationLock ?? (async <T>(run: () => Promise<T>) => run());
  const full = (event: ProviderEvent, thread: ManagedAgentThreadContext | undefined, replay: boolean) => withLock(() => fullUnlocked(event, thread, replay));
  const item = async (event: ProviderEvent, explicit?: ManagedAgentThreadContext) => {
    signal.throwIfAborted();
    if (!explicit && event.type === "session.thread_created") {
      for (const row of await deps.provider.threads(input.sessionId, signal)) {
        const context = contextFromManagedAgentThread(row);
        if (context) threads.set(context.threadId, context);
      }
      startChildren();
    }
    const thread = explicit ?? contextForManagedAgentEvent(event, threads);
    return serial(() => full(event, thread, false));
  };
  const history = async () => {
    const result = await backfillManagedAgentTranscript(deps.provider, input.sessionId, signal);
    threads = result.threads;
    if (deps.reconcileDeliveries) await withLock(() => deps.reconcileDeliveries!(result.events.filter(entry => threadRoleFromMetadata(entry.thread) !== "child").map(entry => entry.event)));
    latest = null;
    // Process every history event, even if streamIndex is nonzero. No queue work
    // at obsolete boundaries, and no business-state parking mid-replay.
    for (const entry of result.events) {
      signal.throwIfAborted();
      if (typeof entry.event.id === "string" && liveIds.has(entry.event.id)) overlapped = true;
      // Already consumed events still tell us which history boundary is latest.
      const mapped = mapManagedAgentEvent(entry.event, entry.thread);
      if (threadRoleFromMetadata(entry.thread) !== "child" && (entry.event.type === "user.message" || (mapped.kind === "lifecycle" && mapped.type === "turn.started"))) latest = "active";
      await serial(() => full(entry.event, entry.thread, true));
    }
    const current = (() : Boundary | "active" | "approval" | null => latest)();
    const flushReplay = () => {
      for (const [key, row] of [...replayRows].sort((a, b) => a[1].seq - b[1].seq)) { deps.relay?.(row); settleBlock(key); }
      replayRows.clear();
    };
    return withLock(async () => {
    if (current === "active") { await deps.active(); deps.approval(false); flushReplay(); await deps.state(); return false; }
    if (current === "approval") { flushReplay(); await deps.state(); return false; }
    if (current) {
      deps.approval(false);
      if (!current.terminal && await deps.hasQueue()) {
        const continued = await deps.continueQueue(); flushReplay(); await deps.state(); return !continued;
      }
      await deps.apply(current.row);
      flushReplay();
      await deps.state();
      return current.terminal || !current.row.duplicate || await deps.waiting();
    }
    flushReplay();
    return false;
    });
  };
  const startChildren = () => {
    for (const thread of threads.values()) if (threadRoleFromMetadata(thread) === "child" && !children.has(thread.threadId)) {
      const child = (async () => {
        for await (const event of deps.provider.stream(input.sessionId, signal, thread.threadId)) if (!liveArrival(event, thread)) await item(event, thread);
      })().catch(() => { /* Primary durable history reconciles child transport gaps. */ });
      children.set(thread.threadId, child);
    }
  };
  // Subscribe before replaying, exactly as the SSE recovery seam does for durable
  // rows. `EventStreamParams` carries no cursor, so a session subscription replays
  // nothing, and the provider holds an idle session's stream open indefinitely, so
  // `for await` never returns to let the reconnect loop re-read history. A snapshot
  // taken before the subscription therefore leaves a window whose events belong to
  // neither source and are lost for the whole attachment: that is what stalled every
  // follow-up turn, whose agent work `send` had already started before this pump
  // existed. Buffering from the moment we attach closes the window; `consumed` makes
  // the overlap between the two sources idempotent.
  const attach = () => {
    const own = new AbortController();
    const stop = () => own.abort(signal.reason);
    if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
    const pending: ProviderEvent[] = [];
    let wake: (() => void) | undefined;
    let ended = false;
    let failure: unknown;
    const iterator = deps.provider.stream(input.sessionId, own.signal)[Symbol.asyncIterator]();
    const reader = (async () => {
      try {
        for (;;) {
          const next = await iterator.next();
          if (next.done || own.signal.aborted) return;
          // Dispatch previews the moment they arrive. Queueing them behind durable
          // replay is what made the whole answer land in one lump: `history` re-reads
          // the transcript for as long as the turn keeps producing events, so this
          // buffer only drained once the turn was already finished.
          if (liveArrival(next.value)) continue;
          if (typeof next.value.id === "string") liveIds.add(next.value.id);
          // Activity rows go straight through, unless a buffered event still owes a
          // row of its own: that row arrived first and must keep the lower `seq`. A
          // failed live ingest is handed to `drain` so the attachment reconnects and
          // its next snapshot re-reads the row.
          if (primed && !pending.some(ordered) && activityArrival(next.value)) {
            dispatchActivity(next.value).catch(error => {
              if (failure === undefined) failure = error;
              const notify = wake; wake = undefined; notify?.();
            });
            continue;
          }
          pending.push(next.value);
          const notify = wake; wake = undefined; notify?.();
        }
      } catch (error) { failure = error; }
      finally { ended = true; const notify = wake; wake = undefined; notify?.(); }
    })();
    return {
      // Hand the buffer's activity over before the caller spends another snapshot
      // read on it, and stop at the first event that still owes a row of its own —
      // that row has to be relayed before anything behind it. Rowless events are
      // skipped rather than consumed: they order nothing, and their effects still
      // belong to the ordered consumer below.
      async handoff() {
        for (let index = 0; index < pending.length;) {
          const event = pending[index]!;
          if (activityArrival(event)) { pending.splice(index, 1); await dispatchActivity(event); continue; }
          if (ordered(event)) return;
          index++;
        }
      },
      async *drain() {
        for (;;) {
          while (pending.length) yield pending.shift()!;
          if (failure !== undefined) throw failure;
          if (ended || own.signal.aborted) return;
          await new Promise<void>(resolve => {
            const settle = () => { own.signal.removeEventListener("abort", settle); resolve(); };
            wake = settle;
            own.signal.addEventListener("abort", settle, { once: true });
          });
        }
      },
      // Own the subscription's lifetime: abort first so a generator suspended on the
      // network cannot make this await outlive the attachment.
      async close() { own.abort(); signal.removeEventListener("abort", stop); await reader; },
    };
  };
  try {
    let stale = 0;
    while (!signal.aborted) {
      const before = consumed.size;
      // Every attachment starts unprimed: a reconnect has its own gap, and its first
      // snapshot is what closes it.
      primed = false;
      const live = attach();
      try {
        // Replay until a snapshot is caught up with the subscription: either it adds
        // nothing new, or it contains an event the subscription also delivered, which
        // proves the snapshot was taken after the subscription attached.
        for (;;) {
          const replayed = consumed.size;
          overlapped = false;
          if (await history()) return;
          // This snapshot has been applied, so everything the subscription delivers
          // from here on is newer than all of it: activity can go live.
          primed = true;
          signal.throwIfAborted();
          if (consumed.size === replayed || overlapped) break;
          // A further pass is another full transcript read; the rows already buffered
          // are this turn's activity and the guest is waiting on them right now.
          await live.handoff();
        }
        startChildren();
        for await (const event of live.drain()) if (await item(event)) return;
        // The buffer ends quietly when the attachment is aborted, so an aborted pump
        // must still reject rather than look like a clean reconnect.
        signal.throwIfAborted();
      } catch (error) {
        if (signal.aborted) throw error;
        // A replay or transport failure is retried by the reconnect below, but a catch
        // that tells nobody anything is how a broken provider seam survives unnoticed.
        logChatFailure("pump.attachment", error, { sessionId: input.sessionId, consumed: consumed.size, stale });
      } finally { await live.close(); }
      stale = consumed.size > before ? 0 : stale + 1;
      if (stale > (deps.maxStaleReconnects ?? 5)) return;
      await (deps.sleep ?? pause)(Math.min(500 * 2 ** Math.max(0, stale - 1), 5_000), signal);
    }
  } finally {
    lifetime.abort();
    await Promise.allSettled(children.values());
    await ingestion;
    for (const key of Array.from(blocks.keys())) abandonBlock(key);
    deps.approval(false);
    input.signal.removeEventListener("abort", abort);
  }
}
