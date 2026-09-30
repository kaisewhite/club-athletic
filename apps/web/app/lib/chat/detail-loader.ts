// Recovery helpers ported from edge's execution-details-loader. Initial detail
// ownership belongs to the React Router framework loader, never an SPA cache.
import type { ConversationDetails, ConversationStatusSnapshot } from "../../../src/lib/chat/contracts";
import { ApiError } from "./api";

type LoadConversationDetails = (conversationId: string, signal?: AbortSignal) => Promise<ConversationDetails>;
type LoadConversationStatus = (conversationId: string, signal?: AbortSignal) => Promise<ConversationStatusSnapshot>;
type RetryOptions = { attempts: number; delayMs: number };
export const INITIAL_CONVERSATION_RECORD_LOOKUP_RETRY = { attempts: 12, delayMs: 250 } as const;

export function isConversationNotFound(error: unknown): boolean {
  return error instanceof Error && (error.message === "Conversation not found." || (error instanceof ApiError && error.status === 404));
}

export function conversationLookupRetryPolicy(pendingConversationStart: boolean): RetryOptions {
  return pendingConversationStart ? INITIAL_CONVERSATION_RECORD_LOOKUP_RETRY : { attempts: 1, delayMs: 0 };
}

function sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, delayMs);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function loadConversationDetailsWithRetry(
  conversationId: string, loadConversationDetails: LoadConversationDetails, options: RetryOptions, signal?: AbortSignal,
): Promise<ConversationDetails> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    signal?.throwIfAborted();
    try { return await loadConversationDetails(conversationId, signal); }
    catch (error) {
      lastError = error;
      if (!isConversationNotFound(error) || attempt === options.attempts) throw error;
      await sleep(options.delayMs, signal);
    }
  }
  throw lastError;
}

export async function loadKnownCreatedConversationDetails(
  conversationId: string, loadConversationDetails: LoadConversationDetails, signal?: AbortSignal,
): Promise<ConversationDetails> {
  signal?.throwIfAborted();
  return loadConversationDetails(conversationId, signal);
}

export async function loadConversationDetailsAfterStatusWithRetry(
  conversationId: string, loadConversationStatus: LoadConversationStatus, loadConversationDetails: LoadConversationDetails,
  options: RetryOptions, signal?: AbortSignal,
): Promise<ConversationDetails> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    signal?.throwIfAborted();
    try { await loadConversationStatus(conversationId, signal); }
    catch (error) {
      lastError = error;
      if (!isConversationNotFound(error) || attempt === options.attempts) throw error;
      await sleep(options.delayMs, signal);
      continue;
    }
    signal?.throwIfAborted();
    // Existence established: a detail failure is not a persistence-gap retry.
    return loadConversationDetails(conversationId, signal);
  }
  throw lastError;
}

const selectionCookie = "club-athletic-conversation";
const validConversationId = /^[A-Za-z0-9_-]{1,128}$/;

/** The cookie selects an opaque trip-scoped row; it carries no transcript data. */
export function readConversationSelection(cookie: string | null): string | null {
  const value = cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${selectionCookie}=`))?.slice(selectionCookie.length + 1);
  return value && validConversationId.test(value) ? value : null;
}

export function setConversationSelection(id: string | null): void {
  if (id !== null && !validConversationId.test(id)) throw new Error("Invalid conversation selection.");
  if (typeof document === "undefined") return;
  document.cookie = `${selectionCookie}=${id ?? ""}; Path=/; SameSite=Lax; Max-Age=${id === null ? 0 : 30 * 24 * 60 * 60}${location.protocol === "https:" ? "; Secure" : ""}`;
}
