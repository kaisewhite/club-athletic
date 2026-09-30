import type { ThreadMetadata, ThreadRole } from "../chat/contracts";

export type ManagedAgentThreadContext = ThreadMetadata & {
  threadId: string;
};

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function threadRoleFromMetadata(thread?: ThreadMetadata): ThreadRole | undefined {
  if (!thread) return undefined;
  if (thread.threadRole) return thread.threadRole;
  if (thread.parentThreadId === null) return "root";
  if (thread.parentThreadId) return "child";
  return undefined;
}

export function canonicalEventIdFor(providerEventId: string | undefined, thread?: ThreadMetadata): string | undefined {
  if (!providerEventId) return undefined;
  return threadRoleFromMetadata(thread) === "child" && thread?.threadId
    ? `${thread.threadId}:${providerEventId}`
    : providerEventId;
}

export function contextFromManagedAgentThread(thread: Record<string, unknown>): ManagedAgentThreadContext | undefined {
  const threadId = str(thread.id);
  if (!threadId) return undefined;
  const parentThreadId =
    typeof thread.parent_thread_id === "string" ? thread.parent_thread_id : thread.parent_thread_id === null ? null : undefined;
  const agent = thread.agent as Record<string, unknown> | undefined;
  const threadRole = parentThreadId ? "child" : parentThreadId === null ? "root" : undefined;
  return {
    threadId,
    parentThreadId,
    threadRole,
    agentName: str(agent?.name),
    threadStatus: str(thread.status),
  };
}

export function contextFromManagedAgentEvent(
  event: Record<string, unknown>,
  knownThreads: Map<string, ManagedAgentThreadContext>,
): ManagedAgentThreadContext | undefined {
  const threadId = str(event.session_thread_id);
  if (!threadId) return undefined;
  const known = knownThreads.get(threadId);
  return {
    ...known,
    threadId,
    agentName: str(event.agent_name) ?? known?.agentName,
  };
}

function singleRootThreadContext(
  knownThreads: Map<string, ManagedAgentThreadContext>,
): ManagedAgentThreadContext | undefined {
  const roots = Array.from(knownThreads.values()).filter((thread) => threadRoleFromMetadata(thread) === "root");
  return roots.length === 1 ? roots[0] : undefined;
}

export function contextForManagedAgentEvent(
  event: Record<string, unknown>,
  knownThreads: Map<string, ManagedAgentThreadContext>,
): ManagedAgentThreadContext | undefined {
  const explicitThread = contextFromManagedAgentEvent(event, knownThreads);
  if (explicitThread) return explicitThread;
  const eventType = str(event.type) ?? "";
  return eventType.startsWith("agent.") ? singleRootThreadContext(knownThreads) : undefined;
}
