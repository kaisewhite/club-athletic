import type { SessionEventRecord } from "../projections";
import { closeConversation, parkConversationTurn } from "../../db/chat-writes.server";
export function isTerminalLifecycleEvent(event: { type: string }) {
  return ["session.completed", "session.failed", "session.cancelled"].includes(event.type);
}
export async function applyLifecycleEvent(row: SessionEventRecord, writes = { closeConversation, parkConversationTurn }) {
  if (!/^(turn|session)\.(completed|failed|cancelled)$/.test(row.type)) return null;
  const status = row.type.endsWith("failed") ? "failed" : row.type.endsWith("cancelled") ? "stopped" : "completed";
  const input = { conversationId: row.conversationId, eventId: row.id, status,
    ...(status === "failed" ? { error: "The agent could not finish this turn. Try again." } : {}) } as const;
  // Task 1 atomically stamps lifecycleAppliedAt with its state change. Retry even
  // duplicate inserts: a crash may have happened before this transaction.
  return isTerminalLifecycleEvent(row) ? writes.closeConversation(input) : writes.parkConversationTurn(input);
}
