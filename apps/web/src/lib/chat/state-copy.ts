// Ported from edge/apps/web-platform/src/lib/shared/state-copy.ts; trip adaptations are local.
// Shared copy + label rules for the app-wide empty/error/loading states. Keeping
// these pure makes the load-bearing guarantees testable: user-facing error copy
// never leaks status codes or internals (the raw error is logged to the console
// separately), breadcrumbs stay honest on load failure, and count badges hide at
// zero.

type ErrorCopy = { title: string; description: string };
type ConversationLoadErrorCopy = ErrorCopy & { retryable: boolean };

/**
 * Product-language copy for an error state. The raw error is intentionally NOT
 * surfaced (log it to the console for debugging); users see a stable sentence
 * with no status codes, stack traces, or internal identifiers.
 */
export function describeErrorForUser(_raw?: string | null | undefined, subject = "this page"): ErrorCopy {
  const copy = {
    title: `Couldn't load this ${subject}`,
    description: "Something went wrong on our end. Try again in a moment.",
  } satisfies ErrorCopy;
  return copy;
}

/** Turn persisted conversation diagnostics into concise product copy while keeping the exact duration authoritative. */
export function conversationFailureCopy(raw: string | null | undefined, durationLabel: string): string {
  const normalized = raw?.trim().toLowerCase() ?? "";
  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return durationLabel ? `This conversation timed out after ${durationLabel}.` : "This conversation timed out.";
  }
  if (normalized.includes("cancel")) return "This conversation was stopped before it finished.";
  return "This conversation failed before it could finish.";
}

/**
 * Copy for a failed conversation-page load. "Conversation not found." is permanent — the conversation was
 * removed or never finished starting — so the card is
 * honest about that and offers no retry. Everything else stays transient and
 * retryable.
 */
export function conversationLoadErrorCopy(raw: string | null | undefined): ConversationLoadErrorCopy {
  if (raw === "Conversation not found.") {
    const copy = {
      title: "This conversation no longer exists",
      description: "It may have been removed, or it never started.",
      retryable: false,
    } satisfies ConversationLoadErrorCopy;
    return copy;
  }
  const copy = { ...describeErrorForUser(raw, "conversation"), retryable: true } satisfies ConversationLoadErrorCopy;
  return copy;
}

// Markers that identify a raw provider/runtime message (socket errors, status
// codes, code snippets, stack frames). Anything matching these must never
// reach the user verbatim — the chokepoint below rewrites it.
const INTERNAL_ERROR_MARKERS = [
  /\bfetch\s*\(/i,
  /verbose:\s*true/i,
  /\bsocket\b/i,
  /\bconnection reset\b/i,
  /\beconn/i,
  /\betimedout\b/i,
  /\(\d{3}\)/, // "(502)" style status codes
  /\bstream ended\b/i,
  /\beve\b/i, // runtime name is an internal detail
  /`[^`]+`/, // inline code
  /\n\s+at\s/, // stack frames
];

/**
 * The single chokepoint every user-visible error string passes through.
 * Product-authored sentences pass unchanged; raw provider/runtime messages
 * are replaced with stable product copy. Blank input gets an honest default.
 */
export function userFacingError(raw: string | null | undefined): string {
  const text = raw?.trim() ?? "";
  if (!text) return "The conversation hit an error before it could finish.";
  if (INTERNAL_ERROR_MARKERS.some((marker) => marker.test(text))) {
    return "The agent's connection was interrupted before it could finish.";
  }
  return text;
}

