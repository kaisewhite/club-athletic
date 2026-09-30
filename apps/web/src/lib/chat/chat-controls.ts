// Ported from edge/apps/web-platform/src/lib/execution/execution-controls.ts; trip adaptations are local.
// Conversation-control decisions kept as pure functions so the button state machine and
// the working-indicator condition are unit-tested independently of the view.
import type { ConversationStatus, SessionEventRow } from "./contracts";

/** The internal stream-drop sentinel used to trigger persisted-event recovery. */
export const CONVERSATION_STREAM_DISCONNECTED_MESSAGE = "Conversation stream disconnected.";

/** Only an active conversation may animate a pending tool row. */
export function shouldShowPendingToolSpinner(conversationIsLive: boolean, itemStatus: string): boolean {
  return conversationIsLive && itemStatus === "pending";
}

/**
 * Show the "Reconnecting…" chip only when a still-running conversation has lost its
 * live stream (SSE drop + status retry both failed → the disconnect sentinel).
 * A stale transcript with no indicator would otherwise look silently frozen.
 */
export function shouldShowReconnectingChip(error: string | null, status: ConversationStatus): boolean {
  return status === "running" && error === CONVERSATION_STREAM_DISCONNECTED_MESSAGE;
}

/** Poll persisted status after cancellation so the control cannot stay at Stopping forever. */
export async function waitForTerminalConversationStatus(
  readStatus: () => Promise<ConversationStatus>,
  options: { delayMs?: number; maxAttempts?: number } = {},
): Promise<ConversationStatus> {
  const delayMs = options.delayMs ?? 250;
  const maxAttempts = options.maxAttempts ?? 40;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await readStatus();
    if (status !== "running") return status;
    if (attempt < maxAttempts - 1 && delayMs > 0) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
    }
  }
  throw new Error("The conversation did not reach a terminal state after stopping.");
}

/**
 * Whether to show the "working" indicator. A live conversation needs feedback whenever
 * nothing else on screen already signals activity — i.e. the startup gap before
 * the first token, or a gap between blocks. Visible text and tool spinners already signal activity.
 */
export function shouldShowThinking(opts: { isLive: boolean; streaming: boolean; pendingTool: boolean }): boolean {
  return opts.isLive && !opts.streaming && !opts.pendingTool;
}

/**
 * Ported from the route's hasFinalAssistantAfterLatestUser. Q7: mapper-supplied
 * commentary metadata does not disqualify a final answer. A successful provider
 * boundary must follow the root answer, with no later turn or user message.
 * Visibility remains the row projection's responsibility, including live prose.
 */
export function hasFinalAssistantAfterLatestUser(rows: SessionEventRow[]): boolean {
  const ordered = [...rows].sort((left, right) => left.seq - right.seq);
  let hasAnswer = false;
  let completed = false;
  for (const row of ordered) {
    if (row.payload.threadRole === "child" || (row.payload.threadId && row.payload.threadRole !== "root")) continue;
    if (row.type === "user_message" || row.type === "turn.started" || row.type === "tool_call" || row.type === "tool_result") {
      hasAnswer = false;
      completed = false;
    } else if ((row.type === "message" || row.type === "summary") && typeof row.payload.text === "string" && row.payload.text.trim()) {
      hasAnswer = true;
      completed = false;
    } else if (row.type === "turn.completed" || row.type === "session.completed") {
      completed = hasAnswer && row.payload.continuation !== true;
      if (row.payload.continuation === true) hasAnswer = false;
    } else if (row.type === "turn.failed" || row.type === "turn.cancelled" || row.type === "session.failed" || row.type === "session.cancelled") {
      hasAnswer = false;
      completed = false;
    }
  }
  return completed;
}
