// Ported from edge/apps/web-platform/src/lib/execution/execution-chat-state.ts; trip adaptations are local.
// Pure conversation-chat UI state machine: server-derived capability stays separate
// from transient input/send/toast state. The composer has no stop — the
// whole-run Stop lives in the top bar — and a send while the agent is working is
// accepted by the provider, so only the in-flight POST ever blocks a second send.
// Turn progress belongs to the server (`capability.activeTurn`), not to this
// reducer.
import type { ConversationChatCapability, ConversationSessionStateFrame } from "./contracts";

/** Exact disabled-tooltip copy for a conversation outside retention. */
export const CHAT_EXPIRED_COPY = "This conversation has expired.";
export const CHAT_SEND_ACK_TIMEOUT_MS = 15_000;

/** Transient, browser-only chat state (persisted transcript lives in rows). */
export interface ConversationChatUiState {
  /** idle → sending (POST in flight) → idle on acknowledgement. */
  phase: "idle" | "sending";
  /** The composer's current text; preserved verbatim on failure. */
  draft: string;
  /** Message currently being submitted, used to restore the composer on failure. */
  submittedDraft: string | null;
  /** One transient failure message; null when nothing to show. */
  toast: string | null;
}

export type ConversationChatUiEvent =
  | { type: "draft"; text: string }
  | { type: "send_started"; text?: string }
  | { type: "send_accepted" }
  | { type: "send_failed"; message: string }
  | { type: "state_frame"; frame: ConversationSessionStateFrame }
  | { type: "toast_dismissed" }
  | { type: "reset" };

/** The pristine state used on mount, navigation, and reload. */
export function initialChatUiState(): ConversationChatUiState {
  return { phase: "idle", draft: "", submittedDraft: null, toast: null };
}

/** Apply one UI event; unknown transitions leave state unchanged. */
export function chatUiReducer(state: ConversationChatUiState, event: ConversationChatUiEvent): ConversationChatUiState {
  switch (event.type) {
    case "draft":
      // Typing is always allowed — only submitting is gated.
      return { ...state, draft: event.text };
    case "send_started": {
      // Move the submitted text into the transcript immediately. If the guest
      // had already started a different draft, keep that text in the composer.
      const submittedDraft = event.text ?? state.draft;
      const draft = !event.text || state.draft === event.text ? "" : state.draft;
      return { ...state, phase: "sending", draft, submittedDraft, toast: null };
    }
    case "send_accepted":
      // Acknowledged and durable: clear the box. The composer is free again even
      // though the agent may still be working — that is the point of this change.
      return { ...state, phase: "idle", draft: "", submittedDraft: null };
    case "send_failed":
      // Keep the failed question in the transcript. Preserve any newer text the
      // guest typed while the request was in flight.
      return { ...state, phase: "idle", submittedDraft: null, toast: event.message };
    case "state_frame": {
      // session.waiting is the sole success signal: the turn is over (completed
      // OR cancelled) and the next message may send. A cancelled turn is not a
      // failure, so no toast appears here.
      if (event.frame.runtimeStatus === "waiting" || event.frame.runtimeStatus === "closed") {
        if (state.phase === "sending" && !event.frame.activeRequestIdPresent) {
          return state;
        }
        return { ...state, phase: "idle" };
      }
      return state;
    }
    case "toast_dismissed":
      return { ...state, toast: null };
    case "reset":
      return initialChatUiState();
    default:
      return state;
  }
}

/** Whether the composer may submit right now (server capability + local phase). */
export function canSubmitChat(state: ConversationChatUiState, capability: ConversationChatCapability): boolean {
  if (!capability.canSend) return false;
  if (state.phase !== "idle") return false;
  return state.draft.trim().length > 0;
}

/** Human copy for a disabled composer; null when input is allowed. */
export function chatDisabledReason(capability: ConversationChatCapability): string | null {
  if (capability.reason === "expired") return CHAT_EXPIRED_COPY;
  if (capability.waitingOnApproval) return "Waiting on approval";
  if (capability.reason === "closed") return "This conversation has ended.";
  if (capability.reason === "no_session") return "This conversation has not started yet.";
  return null;
}
