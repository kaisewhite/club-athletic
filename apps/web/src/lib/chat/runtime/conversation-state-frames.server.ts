import { loadConversationSessionState, type ConversationScope } from "../repository.server";
import type { ConversationSessionStateFrame } from "../contracts";
import { conversationEventRelay } from "./event-relay.server";
const processApprovals = globalThis as typeof globalThis & { __clubAthleticChatApprovals?: Set<string> };
const approvals = processApprovals.__clubAthleticChatApprovals ??= new Set<string>();
export function setApprovalPending(id: string, value: boolean) { if (value) approvals.add(id); else approvals.delete(id); }
export function isApprovalPending(id: string) { return approvals.has(id); }
export function clearApprovalState() { approvals.clear(); }
export async function buildConversationStateFrame(scope: ConversationScope, load = loadConversationSessionState): Promise<ConversationSessionStateFrame | null> {
  const row = await load(scope);
  return row ? { runtimeStatus: row.runtimeStatus, status: row.status, activeRequestIdPresent: row.activeRequestId !== null,
    activeTurnId: row.activeTurnId, pendingWakeupAt: null, waitingOnApproval: isApprovalPending(scope.conversationId) } : null;
}
export async function publishConversationState(scope: ConversationScope) {
  const frame = await buildConversationStateFrame(scope);
  if (frame) conversationEventRelay.publishState(scope.conversationId, frame);
}
