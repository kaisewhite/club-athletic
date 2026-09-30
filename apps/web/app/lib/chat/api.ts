// Selected browser transport from edge/apps/web-platform/src/lib/api/index.ts.
// Same-origin routes replace edge's separate API/authentication plumbing.
import type {
  ConversationDetails, ConversationMessageDeliveryMode, ConversationSessionStateFrame,
  ConversationStatusSnapshot, SendConversationMessageResponse,
  SessionEventRow, StreamDelta,
} from "../../../src/lib/chat/contracts";

export const CHAT_UNAVAILABLE_MESSAGE = "The trip assistant is temporarily unavailable. Please try again later.";
const connectionErrorMessage = "We couldn't connect to the trip assistant. Check your connection and try again.";
const sendErrorMessage = "Your message couldn't be sent. Please try again.";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "ApiError"; }
}

async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  try { return await fetch(input, { ...init, credentials: "same-origin" }); }
  catch (error) {
    if (init?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
    throw new Error(connectionErrorMessage);
  }
}

function publicError(status: number, fallback: string): string {
  if (status >= 500) return CHAT_UNAVAILABLE_MESSAGE;
  if (status === 429) return "Please wait before sending another message.";
  return fallback;
}

async function readJson<T>(response: Response): Promise<T> {
  // Matching Task 1 contracts and Task 2 routes own the response shapes.
  try { return await response.json() as T; }
  catch { throw new ApiError("The trip assistant returned an incomplete response. Please try again.", response.status); }
}

export async function fetchConversationDetails(conversationId: string, signal?: AbortSignal): Promise<ConversationDetails> {
  const response = await apiFetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}`, {
    headers: { Accept: "application/json" }, signal,
  });
  if (response.status === 404) throw new ApiError("Conversation not found.", 404);
  if (!response.ok) throw new ApiError(publicError(response.status, "Couldn't load this conversation. Please try again."), response.status);
  return readJson<ConversationDetails>(response);
}

export async function fetchConversationStatus(conversationId: string, signal?: AbortSignal): Promise<ConversationStatusSnapshot> {
  const response = await apiFetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/status`, {
    headers: { Accept: "application/json" }, signal,
  });
  if (response.status === 404) throw new ApiError("Conversation not found.", 404);
  if (!response.ok) throw new ApiError(publicError(response.status, "Couldn't reconnect to the trip assistant."), response.status);
  return readJson<ConversationStatusSnapshot>(response);
}

export async function fetchConversationDetailsAfterStatus(
  conversationId: string,
  loadStatus: typeof fetchConversationStatus = fetchConversationStatus,
  loadDetail: typeof fetchConversationDetails = fetchConversationDetails,
  signal?: AbortSignal,
): Promise<ConversationDetails> {
  await loadStatus(conversationId, signal);
  signal?.throwIfAborted();
  return loadDetail(conversationId, signal);
}

/** Only rows actually acknowledged by the controller advance the replay cursor. */
export function createConversationStreamCursor(initialSeq = -1) {
  let acknowledgedSeq = Number.isFinite(initialSeq) ? initialSeq : -1;
  return {
    acknowledge(seq: number) { if (Number.isFinite(seq)) acknowledgedSeq = Math.max(acknowledgedSeq, seq); },
    reset(seq: number) { acknowledgedSeq = Number.isFinite(seq) ? seq : -1; },
    value() { return acknowledgedSeq; },
  };
}

export type ConversationStreamHandlers = {
  onActivity: (seq: number, row: SessionEventRow) => void;
  onDelta?: (delta: StreamDelta) => void;
  onState?: (frame: ConversationSessionStateFrame) => void;
  onDone?: () => void;
  onError?: () => void;
};

/** Port of subscribeToExecutionStream, including its streaming decoder/frame parser. */
export function subscribeToConversationStream(conversationId: string, lastEventSeq: number, handlers: ConversationStreamHandlers) {
  const controller = new AbortController();
  let stopped = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancellation: Promise<void> | undefined;
  const cancelReader = () => {
    if (reader && !cancellation) cancellation = reader.cancel().catch(() => undefined);
    return cancellation;
  };
  const dispatch = (frame: string) => {
    if (stopped) return;
    let eventType = "message";
    let eventId = "";
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventType = line.slice(6).trimStart();
      else if (line.startsWith("id:")) eventId = line.slice(3).trimStart();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    const payload = data.join("\n");
    // The matching serializers emit these exact Task 1 contract shapes.
    if (eventType === "activity") handlers.onActivity(Number(eventId || "0"), JSON.parse(payload) as SessionEventRow);
    else if (eventType === "delta") handlers.onDelta?.(JSON.parse(payload) as StreamDelta);
    else if (eventType === "state") handlers.onState?.(JSON.parse(payload) as ConversationSessionStateFrame);
    else if (eventType === "done") {
      stopped = true;
      controller.abort();
      handlers.onDone?.();
    } else if (eventType === "error") throw new Error("Conversation stream error.");
  };

  const finished = (async () => {
    try {
      const response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/stream?after=${lastEventSeq}`, {
        credentials: "same-origin", headers: { Accept: "text/event-stream" }, signal: controller.signal,
      });
      if (response.body) reader = response.body.getReader();
      if (!response.ok || !reader) throw new Error("Conversation stream unavailable.");
      const decoder = new TextDecoder();
      let buffer = "";
      while (!stopped) {
        const { done, value } = await reader.read();
        if (stopped || done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary: number;
        while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const separatorMatch = buffer.slice(boundary).match(/^\r?\n\r?\n/);
          if (!separatorMatch) break;
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + separatorMatch[0].length);
          if (frame) dispatch(frame);
          if (stopped) break;
        }
      }
      if (!stopped) handlers.onError?.();
    } catch (error) {
      if (!stopped && !(error instanceof DOMException && error.name === "AbortError")) handlers.onError?.();
    } finally {
      // Edge aborts fetch; explicitly own reader cancellation/release as well.
      controller.abort();
      await cancelReader();
      reader?.releaseLock();
    }
  })();
  return Object.assign(() => {
    stopped = true;
    controller.abort();
    void cancelReader();
  }, { finished });
}

export type StartConversationResponse = { ok: true; conversationId: string; seq: number };

export async function startConversation(text: string, idempotencyKey: string, options: { signal?: AbortSignal } = {}): Promise<StartConversationResponse> {
  const response = await apiFetch("/api/chat/conversations", {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ text }), signal: options.signal,
  });
  if (!response.ok) throw new ApiError(publicError(response.status, sendErrorMessage), response.status);
  const body = await readJson<StartConversationResponse>(response);
  if (!body || body.ok !== true || typeof body.conversationId !== "string" || !Number.isFinite(body.seq)) {
    throw new ApiError(sendErrorMessage, response.status);
  }
  return body;
}

/** Preserve edge's idempotent queue/interrupt API independently of the guest send gate. */
export async function sendConversationChatMessage(
  conversationId: string, text: string, idempotencyKey: string,
  options: { deliveryMode?: ConversationMessageDeliveryMode; signal?: AbortSignal; uploadId?: string } = {},
): Promise<SendConversationMessageResponse> {
  const requestBody: { text: string; deliveryMode?: ConversationMessageDeliveryMode; uploadId?: string } = { text };
  if (options.uploadId) requestBody.uploadId = options.uploadId;
  if (options.deliveryMode) requestBody.deliveryMode = options.deliveryMode;
  const response = await apiFetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(requestBody), signal: options.signal,
  });
  if (!response.ok) return { ok: false, error: publicError(response.status, sendErrorMessage), status: response.status };
  const value: unknown = await response.json().catch(() => null);
  if (!value || typeof value !== "object" || !("seq" in value) || typeof value.seq !== "number" || !Number.isFinite(value.seq)) {
    return { ok: false, error: sendErrorMessage, status: response.status };
  }
  const body = value as Record<string, unknown>;
  const result: SendConversationMessageResponse = { ok: true, seq: value.seq };
  if (typeof body.requestId === "string") result.requestId = body.requestId;
  if (typeof body.conversationId === "string") result.conversationId = body.conversationId;
  if (typeof body.sessionId === "string" || body.sessionId === null) result.sessionId = body.sessionId;
  if (typeof body.threadId === "string" || body.threadId === null) result.threadId = body.threadId;
  if (body.delivery === "sent" || body.delivery === "queued") result.delivery = body.delivery;
  return result;
}

export async function cancelConversation(conversationId: string, signal?: AbortSignal): Promise<void> {
  const response = await apiFetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/cancel`, { method: "POST", signal });
  // A completed-turn race is a benign no-op in edge.
  if (!response.ok && response.status !== 409) throw new ApiError(publicError(response.status, "Couldn't stop this answer. Please try again."), response.status);
}
