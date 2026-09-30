// Selected pure helpers ported from edge/apps/api/src/modules/executions/projections.ts.
import type { ConversationChatCapability, ConversationSessionStateFrame, ConversationStatus, SessionEventRow, StreamDelta } from "./contracts";

export type SessionEventRecord = {
  id: string;
  payload: Record<string, unknown>;
  conversationId: string;
  seq: number;
  type: string;
};

/** One bounded cursor page used by SSE replay and reconnect recovery. */
export type ConversationEventReplayPage = {
  events: SessionEventRecord[];
  hasMore: boolean;
  nextAfterSeq: number;
};

/** Keep the newest bounded transcript rows and expose the cursor for omitted history. */
export function boundConversationEvents(events: SessionEventRecord[], limit: number): {
  events: SessionEventRecord[];
  eventsCursor: number | null;
  eventsTruncated: boolean;
} {
  const newestFirst = [...events].sort((left, right) => right.seq - left.seq);
  const retained = newestFirst.slice(0, limit).sort((left, right) => left.seq - right.seq);
  const eventsTruncated = newestFirst.length > limit;
  return {
    events: retained,
    eventsCursor: eventsTruncated && retained.length > 0 ? retained[0]!.seq - 1 : null,
    eventsTruncated,
  };
}

export interface ConversationCapabilityState {
  activeRequestId?: string | null;
  activeTurnId?: string | null;
  finishedAt: Date | string | null;
  agentSessionId?: string | null;
  runtimeStatus?: string | null;
  status: string;
}

/** Options for computing the chat capability carried on a conversation detail. */
export interface ChatCapabilityOptions {
  retentionDays: number;
  now?: Date;
  waitingOnApproval?: boolean;
}

/**
 * Pure chat-capability policy: whether the conversation-page input can send right now,
 * and why not when it can't. Session lifecycle uses the canonical vocabulary;
 * conversations without an active session lifecycle (or with a closed session) read as closed.
 */
export function computeConversationChatCapability(
  conversation: ConversationCapabilityState,
  options: ChatCapabilityOptions,
): ConversationChatCapability {
  const now = options.now ?? new Date();
  const waitingOnApproval = options.waitingOnApproval ?? false;
  const runtimeStatus = conversation.runtimeStatus ?? null;
  const pendingWakeupAt = null; // No trip scheduler; preserve the wire field.
  // Runtime state, rather than a send claim, identifies provider work. A settled
  // conversation can retain an idle session for follow-up messages.
  const activeTurn = runtimeStatus === "starting" || runtimeStatus === "active" || runtimeStatus === "stopping";
  const base = { runtimeStatus, pendingWakeupAt, activeTurn, waitingOnApproval };
  // Edge's separate historical-session recreation path is outside Task 1/Q2.
  // A retained transcript alone cannot advertise an unsupported send path.
  if (!conversation.agentSessionId) return { canSend: false, reason: "no_session", ...base };
  const resumable =
    runtimeStatus === "waiting" || runtimeStatus === "active" || runtimeStatus === "starting" || runtimeStatus === "stopping";
  if (!resumable) return { canSend: false, reason: "closed", ...base };

  if (conversation.status !== "running") {
    const finishedAt = conversation.finishedAt ? new Date(conversation.finishedAt) : null;
    // A null `finishedAt` means no turn has ever run — it does NOT mean the
    // conversation settled. `createDraftConversation` writes exactly that state
    // (status "completed", runtimeStatus "waiting", finishedAt null) so a guest
    // can attach a screenshot before asking anything. Treating it as settled made
    // every draft→upload→send return 409 "This conversation cannot accept
    // messages", which killed the composer's paperclip flow entirely. Retention
    // can only expire something that actually finished, so skip the window here
    // and let the checks above (session present, runtime resumable) decide.
    if (finishedAt) {
      const ageMs = now.getTime() - finishedAt.getTime();
      if (ageMs > options.retentionDays * 24 * 60 * 60 * 1000) {
        return { canSend: false, reason: "expired", ...base };
      }
    }
  }

  // A turn in flight no longer blocks the composer: the message queues and the
  // agent reads it at the next turn boundary.
  return { canSend: !waitingOnApproval, reason: null, ...base };
}

export function parseConversationStatus(value: string | null | undefined): ConversationStatus {
  if (value === "running" || value === "completed" || value === "failed" || value === "stopped") {
    return value;
  }
  return "failed";
}

export { parseConversationStatus as toConversationStatus };

/** Encode an already-public-safe persisted row; the HTTP boundary owns redaction. */
export function serializeConversationStreamEvent(seq: number, row: SessionEventRow): string {
  return `id: ${seq}\nevent: activity\ndata: ${JSON.stringify({ id: row.id, seq: row.seq, type: row.type, payload: row.payload })}\n\n`;
}

/**
 * Encode one ephemeral token delta as an SSE frame. Deltas carry no `id:` so
 * they never advance the browser's `last-event-id` reconnect cursor — only
 * durable activity rows do.
 */
export function serializeConversationStreamDeltaEvent(delta: StreamDelta): string {
  return `event: delta\ndata: ${JSON.stringify(delta)}\n\n`;
}

/**
 * Encode one ephemeral session-state frame. Like deltas, state frames carry no
 * `id:` so they never advance the browser's reconnect cursor.
 */
export function serializeConversationStreamStateEvent(frame: ConversationSessionStateFrame): string {
  return `event: state\ndata: ${JSON.stringify(frame)}\n\n`;
}

/** Encode one clean stream-completion marker so browsers can stop listening. */
export function serializeConversationStreamDoneEvent(): string {
  return "event: done\ndata: {}\n\n";
}

/** Encode one SSE error frame without leaking transport-specific formatting to callers. */
export function serializeConversationStreamErrorEvent(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `event: error\ndata: ${JSON.stringify({ error: message })}\n\n`;
}
