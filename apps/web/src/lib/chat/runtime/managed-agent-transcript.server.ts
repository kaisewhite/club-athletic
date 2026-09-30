import type { ManagedAgentsProvider, ProviderEvent } from "../../managed-agents/client.server";
import { canonicalEventIdFor, contextForManagedAgentEvent, contextFromManagedAgentThread, threadRoleFromMetadata, type ManagedAgentThreadContext } from "../../managed-agents/event-identity";
export interface HistoricalEvent { event: ProviderEvent; thread?: ManagedAgentThreadContext }
/** Edge's chronological session/thread merge, with canonical child identities. */
export async function backfillManagedAgentTranscript(provider: ManagedAgentsProvider, sessionId: string, signal: AbortSignal) {
  const primary = await provider.history(sessionId, signal);
  signal.throwIfAborted();
  const threads = new Map<string, ManagedAgentThreadContext>();
  let listedThreads: ProviderEvent[] = [];
  try { listedThreads = await provider.threads(sessionId, signal); }
  catch (error) { if (signal.aborted) throw error; }
  for (const row of listedThreads) {
    const thread = contextFromManagedAgentThread(row); if (thread) threads.set(thread.threadId, thread);
  }
  const events: HistoricalEvent[] = primary.map(event => ({ event, thread: contextForManagedAgentEvent(event, threads) }));
  for (const thread of threads.values()) if (threadRoleFromMetadata(thread) === "child") {
    try { for (const event of await provider.threadHistory(sessionId, thread.threadId, signal)) events.push({ event, thread }); }
    catch (error) { if (signal.aborted) throw error; }
  }
  signal.throwIfAborted();
  const timestamp = (event: ProviderEvent) => typeof event.processed_at === "string" ? Date.parse(event.processed_at) || 0 : 0;
  // Stable sorting retains provider order for equal/absent timestamps.
  events.sort((a, b) => timestamp(a.event) - timestamp(b.event));
  const seen = new Set<string>();
  return { threads, events: events.filter(({ event, thread }) => {
    const key = canonicalEventIdFor(typeof event.id === "string" ? event.id : undefined, thread);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  }) };
}
