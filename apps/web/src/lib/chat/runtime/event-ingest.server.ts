import { insertConversationEventAllocating, updateConversationCursor } from "../../db/chat-writes.server";
import { applyLifecycleEvent } from "./close-conversation.server";
import { conversationEventRelay } from "./event-relay.server";
export async function ingestSessionEvent(input: {
  conversationId: string; type: string; payload: Record<string, unknown>;
  providerEventKey: string; streamIndex: number; deferLifecycle?: boolean; deferRelay?: boolean;
}, deps = { insertConversationEventAllocating, updateConversationCursor, applyLifecycleEvent, relay: conversationEventRelay }) {
  const row = await deps.insertConversationEventAllocating(input);
  await deps.updateConversationCursor({ conversationId: input.conversationId, streamIndex: input.streamIndex });
  if (!input.deferLifecycle) await deps.applyLifecycleEvent(row);
  if (!row.duplicate && !input.deferRelay) deps.relay.publish(row.conversationId, row.seq, row);
  return row;
}
