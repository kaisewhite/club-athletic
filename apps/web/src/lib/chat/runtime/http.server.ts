/** React Router adapter for edge's HTTP contract. No React or attachment path. */
import { z } from "zod";
import { SSE_HEARTBEAT_MS, CHAT_RETENTION_DAYS } from "../config";
import * as read from "../repository.server";
import * as runtime from "./runtime.server";
import { conversationEventRelay } from "./event-relay.server";
import { recoverConversationStream, type RecoverConversationStreamDeps } from "./recover-conversation-stream.server";
import { serializeConversationStreamEvent, serializeConversationStreamDeltaEvent, serializeConversationStreamStateEvent, serializeConversationStreamDoneEvent, serializeConversationStreamErrorEvent } from "../projections";
import { publicRow, publicDelta, PUBLIC_ERROR } from "./public-frame.server";
import { createTextLimiter } from "../rate-limit.server";
import { logChatFailure } from "./chat-debug.server";
const processStreams = globalThis as typeof globalThis & { __clubAthleticChatStreams?: {
  limiter: ReturnType<typeof createTextLimiter>; liveStreams: Set<() => void>; recoveryTasks: Set<Promise<unknown>>;
} };
const { limiter, liveStreams, recoveryTasks } = processStreams.__clubAthleticChatStreams ??= {
  limiter: createTextLimiter(), liveStreams: new Set(), recoveryTasks: new Set(),
};
export async function shutdownChatStreams() {
  for (const close of liveStreams) close();
  await Promise.allSettled([...recoveryTasks]);
  limiter.clear();
}
export const STREAM_HEADERS = { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" };
export function streamCursor(request: Request) {
  const parse = (value: string | null) => { if (!value) return -1; const parsed = Number(value); return Number.isFinite(parsed) && parsed >= -1 ? Math.floor(parsed) : -1; };
  return Math.max(parse(new URL(request.url).searchParams.get("after")), parse(request.headers.get("Last-Event-ID")));
}
export function streamResponse(request: Request, conversationId: string, deps: RecoverConversationStreamDeps): Response {
  const abort = new AbortController();
  let unsubscribe = () => {};
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const encoder = new TextEncoder();
  const write = (frame: string) => { if (!closed) controller.enqueue(encoder.encode(frame)); };
  const close = () => {
    if (closed) return; closed = true;
    if (heartbeat) clearInterval(heartbeat);
    abort.abort(); unsubscribe(); request.signal.removeEventListener("abort", close); liveStreams.delete(close);
    try { controller.close(); } catch { /* reader already cancelled */ }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(next) {
      controller = next;
      liveStreams.add(close);
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) { close(); return; }
      // A comment immediately commits the Response through the Express adapter.
      write(": heartbeat\n\n");
      heartbeat = setInterval(() => write(": heartbeat\n\n"), SSE_HEARTBEAT_MS);
      heartbeat.unref?.();
      const task = recoverConversationStream(deps, {
        conversationId, afterSeq: streamCursor(request), signal: abort.signal,
        onActivity: (seq, row) => write(serializeConversationStreamEvent(seq, publicRow(row))),
        onDelta: delta => write(serializeConversationStreamDeltaEvent(publicDelta(delta))),
        onState: frame => write(serializeConversationStreamStateEvent(frame)),
        onDone: () => { write(serializeConversationStreamDoneEvent()); close(); },
      }).then(cleanup => { unsubscribe = cleanup; if (closed) cleanup(); })
        .catch(error => { logChatFailure("stream.recover", error, { conversationId }); write(serializeConversationStreamErrorEvent(PUBLIC_ERROR)); close(); })
        .finally(() => recoveryTasks.delete(task));
      recoveryTasks.add(task);
    },
    cancel() { close(); },
  });
  return new Response(stream, { headers: STREAM_HEADERS });
}
const bodySchema = z.object({ text: z.string().min(1).max(8192).refine(text => text.trim().length > 0), uploadId: z.string().regex(/^[a-z][a-z0-9]{23}$/).optional(), deliveryMode: z.enum(["queue", "interrupt_replace"]).default("queue") }).strict();
const json = (value: unknown, status = 200, headers?: HeadersInit) => Response.json(value, { status, headers });
export type ChatRouteArgs = { request: Request; params: { conversationId?: string } };
async function body(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw json({ ok: false, error: "JSON is required." }, 415);
  if (!request.body) throw json({ ok: false, error: "Message text is required." }, 400);
  const reader = request.body.getReader();
  const decoder = new TextDecoder(); let text = ""; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 40_000) throw json({ ok: false, error: "Message is too long." }, 413); text += decoder.decode(part.value, { stream: true }); }
    text += decoder.decode();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && "text" in parsed && typeof parsed.text === "string" && parsed.text.length > 8192) throw json({ ok: false, error: "Message is too long." }, 413);
    return bodySchema.parse(parsed);
  } catch (error) { if (error instanceof Response) throw error; throw json({ ok: false, error: "Provide text and an optional queue or interrupt_replace deliveryMode." }, 400); }
}
async function mutation(request: Request) {
  if (request.method !== "POST") throw json({ error: "Method not allowed." }, 405, { Allow: "POST" });
  const origin = request.headers.get("Origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) throw json({ error: "Request origin is not allowed." }, 403);
  // Express provides a trusted socket-derived key; do not trust public forwarded headers.
  const key = request.headers.get("x-club-chat-client") ?? "shared-public";
  const retry = limiter.take(key);
  if (retry) throw json({ ok: false, error: "Please wait before sending another message." }, 429, { "Retry-After": String(retry) });
}
export async function handleChatRoute(kind: "conversations" | "conversation" | "status" | "stream" | "messages" | "cancel", { request, params }: ChatRouteArgs): Promise<Response> {
  try {
    if (["conversations", "messages", "cancel"].includes(kind)) await mutation(request);
    else if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
    if (kind === "conversations" || kind === "messages") {
      const key = request.headers.get("Idempotency-Key")?.trim();
      if (!key || key.length > 256) return json({ ok: false, error: "An Idempotency-Key header is required." }, 400);
      const input = await body(request);
      if (kind === "conversations" && input.uploadId) return json({ ok: false, error: "Create an attachment draft before uploading." }, 400);
      if (kind === "conversations") return json({ ok: true, ...await runtime.startConversation(input.text, key) }, 201);
      if (!params.conversationId) return json({ error: "Conversation id is required." }, 400);
      const result = await runtime.sendConversationMessage(await runtime.conversationScope(params.conversationId), input.text, key, input.deliveryMode, input.uploadId);
      return json(result.body, result.status);
    }
    if (!params.conversationId) return json({ error: "Conversation id is required." }, 400);
    const scope = await runtime.conversationScope(params.conversationId);
    if (kind === "cancel") { const result = await runtime.requestConversationCancel(scope); return json(result.body, result.status); }
    if (kind === "stream") {
      // Subscribe immediately. Read-time provider recovery runs inside replay's
      // first DB read, after relay subscriptions have been installed.
      let recovering = false;
      return streamResponse(request, params.conversationId, {
        relay: conversationEventRelay,
        loadEvents: async after => {
          if (!recovering) { recovering = true; try { await runtime.recoverManagedAgentPumpForConversation(scope); } catch (error) { /* Durable replay remains available without the provider. */ logChatFailure("stream.pumpRecover", error, { conversationId: params.conversationId }); } }
          return read.loadConversationEventsAfter(scope, after);
        }, state: () => runtime.buildConversationStateFrame(scope),
      });
    }
    try { await runtime.recoverManagedAgentPumpForConversation(scope); } catch (error) { /* Read-time recovery is best effort. */ logChatFailure("read.pumpRecover", error, { kind, conversationId: params.conversationId }); }
    if (kind === "status") {
      const state = await read.loadConversationStatusSnapshot(scope);
      return state ? json({ ...state, error: state.error ? PUBLIC_ERROR : null }) : json({ error: "Conversation not found." }, 404);
    }
    const details = await read.loadConversationDetails(scope, { retentionDays: CHAT_RETENTION_DAYS });
    if (!details) return json({ error: "Conversation not found." }, 404);
    if (!details.events.some(row => row.type !== "user_message")) {
      try { await runtime.recoverManagedAgentPumpForConversation(scope, true); } catch (error) { /* Return the stored transcript. */ logChatFailure("read.pumpRecoverForced", error, { conversationId: params.conversationId }); }
    }
    return json({ ...details, agentSessionId: null, error: details.error ? PUBLIC_ERROR : null, events: details.events.map(publicRow) });
  } catch (error) {
    if (error instanceof Response) return error;
    // Redact for the public guest, but never for the server log.
    logChatFailure("route", error, { kind, conversationId: params.conversationId ?? null, method: request.method });
    return json({ ok: false, error: PUBLIC_ERROR }, 503);
  }
}
