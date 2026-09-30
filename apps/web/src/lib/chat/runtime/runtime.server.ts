/** Runtime composition: all mutations call Task 1's accepted bookkeeping seams. */
import { prepareAttachmentMessage } from "../upload.server";
import * as reads from "../repository.server";
import * as writes from "../../db/chat-writes.server";
import { createManagedAgentsClient, type ManagedAgentsProvider, type ProviderEvent } from "../../managed-agents/client.server";
import { conversationEventRelay } from "./event-relay.server";
import { activePumps } from "./active-pumps.server";
import { createStopConfirmationTimeouts } from "./stop-confirmation-timeout.server";
import { runWithTripTools } from "./tool-runner.server";
import { executeManagedAgentSession } from "./conversation-managed-agent-session.server";
import { ingestSessionEvent } from "./event-ingest.server";
import { applyLifecycleEvent } from "./close-conversation.server";
import { buildConversationStateFrame, clearApprovalState, publishConversationState, setApprovalPending } from "./conversation-state-frames.server";
import { CHAT_RETENTION_DAYS } from "../config";
import { computeConversationChatCapability } from "../projections";
import { textFromContent } from "../../managed-agents/map-managed-agent-event";
import { PUBLIC_ERROR } from "./public-frame.server";
import { logChatFailure } from "./chat-debug.server";
import { getTripOverview } from "../../db/repository.server";

type RuntimeOwner = {
  deadlines: ReturnType<typeof createStopConfirmationTimeouts>;
  locks: Map<string, Promise<unknown>>;
  operations: Set<Promise<unknown>>;
  recoveryRequested: Set<string>;
  serviceAbort: AbortController;
  provider?: ManagedAgentsProvider;
};
const processOwner = globalThis as typeof globalThis & { __clubAthleticChatRuntime?: RuntimeOwner };
const owner: RuntimeOwner = processOwner.__clubAthleticChatRuntime ??= {
  deadlines: createStopConfirmationTimeouts(), locks: new Map(), operations: new Set(),
  recoveryRequested: new Set(), serviceAbort: new AbortController(),
};
const { deadlines, locks, operations, recoveryRequested, serviceAbort } = owner;
const client = () => owner.provider ??= createManagedAgentsClient();
const scope = async (conversationId: string) => ({ tripId: (await getTripOverview()).id, conversationId });
async function exclusive<T>(id: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(() => { serviceAbort.signal.throwIfAborted(); return run(); });
  locks.set(id, task); operations.add(task);
  try { return await task; } finally { if (locks.get(id) === task) locks.delete(id); operations.delete(task); }
}
function relay(row: Awaited<ReturnType<typeof writes.markUserMessageDelivery>>) {
  if (row) conversationEventRelay.publish(row.conversationId, row.seq, row);
}
async function failDelivery(s: reads.ConversationScope, requestId: string) {
  const failed = await writes.markUserMessageDelivery({ conversationId: s.conversationId, requestId, delivery: "failed", error: PUBLIC_ERROR });
  if (!failed) return;
  relay(failed);
  const boundary = await writes.insertConversationEventAllocating({ conversationId: s.conversationId, type: "turn.failed", payload: { message: PUBLIC_ERROR }, providerEventKey: `delivery-failed:${failed.id}` });
  await applyLifecycleEvent(boundary);
  relay(boundary);
  await publishConversationState(s);
}
/** The pump's turn.started projection. A cancel in flight owns the runtime status
 * until the provider confirms it: the provider keeps emitting session.status_running
 * while it winds a turn down, and republishing `active` there both re-advertised an
 * in-flight turn and cleared the stop-confirmation deadline, which is the only
 * escalation from an unhonoured interrupt to a settled stop_failed. Leaving that
 * deadline armed is what stops a cancel from answering 202 and then nothing. */
export async function markConversationTurnActive(s: reads.ConversationScope) {
  if ((await reads.loadConversationChatState(s))?.runtimeStatus === "stopping") return false;
  deadlines.clear(s.conversationId);
  await writes.updateConversationSessionState({ conversationId: s.conversationId, runtimeStatus: "active" });
  return true;
}
async function deliverQueued(s: reads.ConversationScope, signal: AbortSignal) {
  deadlines.clear(s.conversationId);
  const state = await reads.loadConversationChatState(s);
  const queued = await reads.loadOldestQueuedMessage(s);
  if (!state?.agentSessionId || !queued || state.runtimeStatus === "closed") return false;
  signal.throwIfAborted();
  await writes.updateConversationSessionState({ conversationId: s.conversationId, runtimeStatus: "active", activeRequestId: queued.requestId });
  try {
    await client().send(state.agentSessionId, queued.text, signal);
    relay(await writes.markQueuedMessageDelivered({ conversationId: s.conversationId, rowId: queued.id }));
    return true;
  } catch (error) {
    if (signal.aborted) throw error;
    logChatFailure("deliverQueued.send", error, { conversationId: s.conversationId, requestId: queued.requestId });
    await failDelivery(s, queued.requestId);
    return false;
  }
}
export async function reconcilePendingConversationDeliveries(s: reads.ConversationScope, history: ProviderEvent[]) {
  const providerMessages = history.filter(event => event.type === "user.message");
  let providerIndex = 0;
  let after = -1;
  for (;;) {
    const page = await reads.loadConversationEventsAfter(s, after);
    for (const row of page.events) {
      if (row.type !== "user_message") continue;
      const text = typeof row.payload.text === "string" ? row.payload.text : "";
      const matched = providerMessages[providerIndex] && textFromContent(providerMessages[providerIndex]!.content) === text;
      if (matched) providerIndex++;
      const requestId = typeof row.payload.requestId === "string" ? row.payload.requestId : null;
      if (!requestId) continue;
      if (matched && row.payload.delivery === "pending") relay(await writes.markUserMessageDelivery({ conversationId: s.conversationId, requestId, delivery: "sent" }));
      if (matched && row.payload.delivery === "queued") relay(await writes.markQueuedMessageDelivered({ conversationId: s.conversationId, rowId: row.id }));
      if (!matched && row.payload.delivery === "pending") {
        // Provider delivery has no app request identity in 0.122.0. Never blindly
        // resend an ambiguous request after a crash: surface an honest failure.
        const current = await reads.loadConversationChatState(s);
        if (current?.activeRequestId === requestId) await failDelivery(s, requestId);
        else relay(await writes.markUserMessageDelivery({ conversationId: s.conversationId, requestId, delivery: "failed", error: PUBLIC_ERROR }));
      }
    }
    if (!page.hasMore) return;
    if (page.nextAfterSeq <= after) throw new Error("Invalid replay page.");
    after = page.nextAfterSeq;
  }
}
export async function recoverManagedAgentPumpForConversation(s: reads.ConversationScope, force = false) {
  const state = await reads.loadConversationChatState(s);
  if (!state) return "not_found";
  if (!state.agentSessionId || state.runtimeStatus === "closed") return "not_needed";
  if (!force && !state.activeRequestId && !["active", "starting", "stopping"].includes(state.runtimeStatus ?? "") && !(await reads.hasQueuedMessages(s))) return "not_needed";
  const sessionId = state.agentSessionId;
  const p = client();
  const started = activePumps.start(s.conversationId, async signal => {
    await runWithTripTools({ scope: s, sessionId, signal, provider: p }, async ({ signal, provider }) => executeManagedAgentSession({ sessionId, streamIndex: state.streamIndex, signal }, {
      provider,
      withConversationLock: run => exclusive(s.conversationId, run),
      reconcileDeliveries: events => reconcilePendingConversationDeliveries(s, events),
      relay: row => relay(row),
      ingest: input => ingestSessionEvent({ ...input, conversationId: s.conversationId }),
      apply: async row => { const result = await applyLifecycleEvent(row); deadlines.clear(s.conversationId); return result; },
      active: async () => { await markConversationTurnActive(s); },
      state: () => publishConversationState(s),
      approval: pending => setApprovalPending(s.conversationId, pending),
      delta: delta => conversationEventRelay.publishDelta(s.conversationId, delta),
      clear: blockId => conversationEventRelay.clearDelta(s.conversationId, blockId),
      hasQueue: () => reads.hasQueuedMessages(s),
      continueQueue: () => deliverQueued(s, signal),
      waiting: async () => (await reads.loadConversationChatState(s))?.runtimeStatus === "waiting",
    }));
  }, async () => {
    if (recoveryRequested.delete(s.conversationId) && !serviceAbort.signal.aborted) await recoverManagedAgentPumpForConversation(s).then(() => {});
  });
  if (!started) recoveryRequested.add(s.conversationId);
  return started ? "attached" : "already_active";
}
export async function startConversation(text: string, requestId: string) {
  const tripId = (await getTripOverview()).id;
  client(); // Fail before creation if the required provider config is unavailable.
  return exclusive(`opening:${tripId}:${requestId}`, async () => {
    const result = await writes.createConversationWithOpeningMessage({ tripId, text, requestId });
    const s = { tripId, conversationId: result.conversation.id };
    if (result.message.duplicate) { if (!result.conversation.agentSessionId) throw new Error(PUBLIC_ERROR); await recoverManagedAgentPumpForConversation(s); return { conversationId: s.conversationId, seq: result.message.seq }; }
    let sessionId: string;
    try { sessionId = await client().create(text, s.conversationId, serviceAbort.signal); }
    catch (error) { if (!serviceAbort.signal.aborted) await failDelivery(s, requestId); throw error; }
    await writes.attachAgentSession({ conversationId: s.conversationId, sessionId });
    relay(await writes.markUserMessageDelivery({ conversationId: s.conversationId, requestId, delivery: "sent" }));
    await recoverManagedAgentPumpForConversation(s);
    return { conversationId: s.conversationId, seq: result.message.seq };
  });
}
export type SendResult = { status: number; body: Record<string, unknown> };
export async function sendConversationMessage(s: reads.ConversationScope, text: string, requestId: string, deliveryMode: "queue" | "interrupt_replace", uploadId?: string): Promise<SendResult> {
  return exclusive(s.conversationId, async () => {
    const state = await reads.loadConversationChatState(s);
    if (!state) return { status: 404, body: { ok: false, error: "Conversation not found." } };
    const existing = await reads.findUserMessageByRequestId(s, requestId);
    if (existing) return { status: 200, body: { ok: true, seq: existing.seq, requestId, conversationId: s.conversationId, ...(existing.payload.delivery === "sent" || existing.payload.delivery === "queued" ? { delivery: existing.payload.delivery } : {}) } };
    const capability = computeConversationChatCapability(state, { retentionDays: CHAT_RETENTION_DAYS });
    if (!capability.canSend || !state.agentSessionId) return { status: capability.reason === "expired" ? 410 : 409, body: { ok: false, error: "This conversation cannot accept messages." } };
    const p = client();
    const attachment = await prepareAttachmentMessage(s, text, uploadId);
    const row = await writes.appendUserMessage({ ...attachment, requestId });
    relay(row);
    const queued = capability.activeTurn;
    const delivery = queued ? "queued" : "sent";
    if (queued) {
      relay(await writes.markUserMessageDelivery({ conversationId: s.conversationId, requestId, delivery: "queued" }));
      if (deliveryMode === "interrupt_replace") {
        await writes.updateConversationSessionState({ conversationId: s.conversationId, runtimeStatus: "stopping" });
        try { await p.interrupt(state.agentSessionId, serviceAbort.signal); }
        catch (error) {
          logChatFailure("sendMessage.interrupt", error, { conversationId: s.conversationId, requestId });
          relay(await writes.markUserMessageDelivery({ conversationId: s.conversationId, requestId, delivery: "failed", error: PUBLIC_ERROR }));
          await writes.updateConversationSessionState({ conversationId: s.conversationId, runtimeStatus: "stop_failed" });
          await publishConversationState(s);
          return { status: 502, body: { ok: false, error: PUBLIC_ERROR } };
        }
        scheduleStop(s, state.activeRequestId, state.activeTurnId);
        for (const failed of await writes.supersedeQueuedMessagesBeforeSeq({ conversationId: s.conversationId, beforeSeq: row.seq, error: "Superseded by a newer message." })) relay(failed);
      }
    } else {
      await writes.updateConversationSessionState({ conversationId: s.conversationId, runtimeStatus: "active", activeRequestId: requestId });
      try { await p.send(state.agentSessionId, attachment.text, serviceAbort.signal); }
      catch (error) {
        if (serviceAbort.signal.aborted) throw error;
        logChatFailure("sendMessage.send", error, { conversationId: s.conversationId, requestId });
        await failDelivery(s, requestId);
        return { status: 502, body: { ok: false, error: PUBLIC_ERROR } };
      }
      relay(await writes.markUserMessageDelivery({ conversationId: s.conversationId, requestId, delivery: "sent" }));
    }
    await recoverManagedAgentPumpForConversation(s);
    await publishConversationState(s);
    return { status: 200, body: { ok: true, seq: row.seq, requestId, conversationId: s.conversationId, sessionId: state.agentSessionId, threadId: null, delivery } };
  });
}
function scheduleStop(s: reads.ConversationScope, requestId: string | null, turnId: string | null) {
  deadlines.schedule(s.conversationId, () => exclusive(s.conversationId, async () => {
    const current = await reads.loadConversationChatState(s);
    if (current?.runtimeStatus === "stopping" && current.activeRequestId === requestId && current.activeTurnId === turnId) {
      await writes.updateConversationSessionState({ conversationId: s.conversationId, runtimeStatus: "stop_failed" });
      await publishConversationState(s);
    }
  }));
}
export async function requestConversationCancel(s: reads.ConversationScope): Promise<SendResult> {
  return exclusive(s.conversationId, async () => {
    const state = await reads.loadConversationChatState(s);
    if (!state) return { status: 404, body: { error: "Conversation not found." } };
    if (state.runtimeStatus === "waiting" || state.runtimeStatus === "closed") return { status: 409, body: { error: "There is no active turn." } };
    if (!state.agentSessionId) return { status: 503, body: { error: PUBLIC_ERROR } };
    await writes.updateConversationSessionState({ conversationId: s.conversationId, runtimeStatus: "stopping" });
    try { await client().interrupt(state.agentSessionId, serviceAbort.signal); }
    catch (error) {
      logChatFailure("cancel.interrupt", error, { conversationId: s.conversationId });
      await writes.updateConversationSessionState({ conversationId: s.conversationId, runtimeStatus: "stop_failed" });
      return { status: 502, body: { error: "The agent could not stop. Try again." } };
    }
    scheduleStop(s, state.activeRequestId, state.activeTurnId);
    await recoverManagedAgentPumpForConversation(s);
    await publishConversationState(s);
    return { status: 202, body: { status: "stopping" } };
  });
}
export async function recoverRunningManagedAgentConversations() {
  const tripId = (await getTripOverview()).id;
  const rows = await reads.loadResumableConversations(tripId);
  for (const row of rows) await recoverManagedAgentPumpForConversation({ tripId, conversationId: row.id });
}
export async function shutdownChatRuntime() {
  serviceAbort.abort();
  try { await activePumps.stop(); await deadlines.stop(); await Promise.allSettled([...operations]); }
  finally { clearApprovalState(); recoveryRequested.clear(); owner.provider = undefined; }
}
export const conversationScope = scope;
export { buildConversationStateFrame };
