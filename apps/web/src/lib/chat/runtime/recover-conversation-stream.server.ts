/** Port of edge subscribe -> buffer -> paged replay -> flush -> snapshots/state.
 * Q7: a known row may change delivery at the same seq; only new seq moves cursor. */
import type { ConversationEventReplayPage, SessionEventRecord } from "../projections";
import type { ConversationSessionStateFrame, StreamDelta } from "../contracts";
import type { ConversationEventRelay } from "./event-relay.server";
import { isTerminalLifecycleEvent } from "./close-conversation.server";
export interface RecoverConversationStreamDeps {
  relay: ConversationEventRelay;
  loadEvents(after: number): Promise<ConversationEventReplayPage>;
  state(): Promise<ConversationSessionStateFrame | null>;
}
export async function recoverConversationStream(deps: RecoverConversationStreamDeps, input: {
  conversationId: string; afterSeq: number; signal: AbortSignal;
  onActivity(seq: number, row: SessionEventRecord): void;
  onDelta(delta: StreamDelta): void; onState(state: ConversationSessionStateFrame): void; onDone(): void;
}) {
  let cursor = input.afterSeq;
  let closed = false;
  let caughtUp = false;
  let terminal = false;
  let stateGeneration = 0;
  const known = new Map<number, string>();
  const versions = new Map<string, string>();
  const buffered: SessionEventRecord[] = [];
  const cleanups: Array<() => void> = [];
  const close = () => { if (closed) return; closed = true; for (const cleanup of cleanups) cleanup(); input.signal.removeEventListener("abort", close); };
  const done = () => { close(); input.onDone(); };
  const emit = (row: SessionEventRecord, live: boolean) => {
    if (closed) return;
    if (row.seq <= cursor && (!live || (known.has(row.seq) && known.get(row.seq) !== row.id))) return;
    // A subscriber reconnecting after this seq can still receive a delivery edit.
    // The identity remains the durable row id; this never advances its cursor.
    const version = JSON.stringify(row);
    if (versions.get(row.id) === version) return;
    versions.set(row.id, version);
    known.set(row.seq, row.id);
    input.onActivity(row.seq, row);
    cursor = Math.max(cursor, row.seq);
    terminal ||= isTerminalLifecycleEvent(row);
  };
  cleanups.push(deps.relay.subscribe(input.conversationId, (_seq, row) => {
    if (closed) return;
    if (!caughtUp) buffered.push(row);
    else { emit(row, true); if (terminal) done(); }
  }));
  cleanups.push(deps.relay.subscribeDeltas(input.conversationId, delta => { if (!closed) input.onDelta(delta); }));
  cleanups.push(deps.relay.subscribeState(input.conversationId, state => { stateGeneration++; if (!closed) input.onState(state); }));
  input.signal.addEventListener("abort", close, { once: true });
  if (input.signal.aborted) { close(); return close; }
  try {
    let page: ConversationEventReplayPage;
    do {
      const before = cursor;
      page = await deps.loadEvents(cursor);
      if (closed) return close;
      for (const row of page.events) emit(row, false);
      if (page.hasMore && page.nextAfterSeq <= before) throw new Error("Invalid replay page.");
    } while (page.hasMore);
    buffered.sort((a, b) => a.seq - b.seq);
    for (const row of buffered) emit(row, true);
    caughtUp = true;
    if (terminal) { done(); return close; }
    for (const delta of deps.relay.snapshotDeltas(input.conversationId)) if (!closed) input.onDelta(delta);
    const generation = stateGeneration;
    const state = await deps.state();
    if (closed) return close;
    if (state && generation === stateGeneration) input.onState(state);
    if (generation === stateGeneration && (!state || state.runtimeStatus === "closed")) done();
    return close;
  } catch (error) { close(); throw error; }
}
