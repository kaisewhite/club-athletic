// Controller ported from edge/routes/Execution/execution-details.tsx:
// render = f(durable rows), with cumulative transient blocks, acknowledged
// cursor, status/detail recovery, settlement and the existing composer reducer.
// Initial hydration/revalidation belongs to React Router, not edge's SPA cache.
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useRevalidator } from "react-router";
import type { ActivityEvent, ConversationChatCapability, ConversationDetails, ConversationSessionStateFrame, SessionEventRow, StreamDelta } from "@/lib/chat/contracts";
import { CHAT_SEND_ACK_TIMEOUT_MS, chatUiReducer, initialChatUiState } from "@/lib/chat/chat-state";
import { mapSessionEventsToPresentation, projectCurrentAgentActivityText, upsertSessionEventRow } from "@/lib/chat/event-projection";
import { applyStreamDelta, streamingBlockToEvent, unreconciledStreamingBlocks } from "@/lib/chat/stream-blocks";
import { resolveConversationLiveActivity } from "@/lib/chat/chat-live-activity";
import { ApiError, CHAT_UNAVAILABLE_MESSAGE, cancelConversation, createConversationStreamCursor, fetchConversationDetailsAfterStatus, sendConversationChatMessage, startConversation, subscribeToConversationStream } from "../../lib/chat/api";
import { isConversationNotFound, setConversationSelection } from "../../lib/chat/detail-loader";
import { scrollToLatest } from "../../lib/chat/use-auto-scroll";
import { useChatAttachment, AttachmentRequestError } from "../../lib/chat/use-chat-attachment";
import { ChatComposer } from "./chat-composer";
import { ChatThread, CHAT_FALLBACK, type ChatNotice } from "./chat-thread";
import { ChatLoading } from "./chat-loading";

const RECOVERY_POLL_MS = 2_000;
const STREAM_SETTLE_PAUSE_MS = 500;
const TRANSPORT_ERROR = "The connection was interrupted. Reconnecting…";
const CONVERSATION_GONE = "This conversation is no longer available. Start a new question.";
const STOP_FAILED = "Couldn't stop this answer. Please try again.";
const NEW_CHAT: ConversationChatCapability = { canSend: true, reason: null, runtimeStatus: null, pendingWakeupAt: null, activeTurn: false, waitingOnApproval: false };
export const CHAT_SUGGESTIONS = ["What time do I need to land?", "How much are the open spots?", "Which nights is there no chef dinner?", "What are we doing Monday?", "Where am I sleeping?"];

function activeRuntime(runtime: string | null) { return runtime === "starting" || runtime === "active" || runtime === "stopping"; }
function resumable(detail: ConversationDetails) { return detail.status === "running" || activeRuntime(detail.chat.runtimeStatus) || detail.chat.runtimeStatus === "waiting"; }
function applyStateFrame(current: ConversationDetails, frame: ConversationSessionStateFrame): ConversationDetails {
  const status = frame.status === "running" || frame.status === "completed" || frame.status === "failed" || frame.status === "stopped" ? frame.status : current.status;
  return { ...current, status, chat: { ...current.chat, runtimeStatus: frame.runtimeStatus,
    activeTurn: activeRuntime(frame.runtimeStatus), pendingWakeupAt: frame.pendingWakeupAt, waitingOnApproval: frame.waitingOnApproval,
    canSend: current.chat.reason === null && (activeRuntime(frame.runtimeStatus) || frame.runtimeStatus === "waiting") && !frame.waitingOnApproval } };
}

// Starting over is the sidebar's job (`AppShell.newChat`), which clears the
// selection cookie and remounts this panel — so the panel takes no such prop and
// renders no header of its own inside the thread.
export function ChatPanel({ initialConversation, selectedId = null, loadError = null, children }: {
  initialConversation: ConversationDetails | null; selectedId?: string | null; loadError?: string | null;
  children: ReactNode;
}) {
  const attachment = useChatAttachment();
  const revalidator = useRevalidator();
  const revalidateRef = useRef(revalidator.revalidate);
  revalidateRef.current = revalidator.revalidate;
  const [conversation, setConversation] = useState(initialConversation);
  const [streamingBlocks, setStreamingBlocks] = useState<StreamDelta[]>([]);
  const [error, setError] = useState<string | null>(loadError);
  const [chatUi, dispatchChat] = useReducer(chatUiReducer, undefined, initialChatUiState);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;
  const revision = useRef(0);
  const stateFrameRevision = useRef(0);
  const refreshRevision = useRef(0);
  const lifetime = useRef(true);
  const sendAttempt = useRef(0);
  const sendAbort = useRef<AbortController | null>(null);
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendPending = useRef(false);
  // A network-ambiguous retry retains its request key; editing starts a new send.
  const chatKey = useRef<{ text: string; key: string; file: File | null } | null>(null);
  const conversationId = conversation?.id ?? null;
  // The message the guest just sent, shown in the thread the instant they send it
  // rather than after the round trip that persists it. `seqFloor` is the tip at
  // send time, so the optimistic bubble is retired by *its own* durable row and
  // never by an older one carrying the same text.
  const [pending, setPending] = useState<{ key: string; text: string; seqFloor: number; failed: boolean } | null>(null);
  const [stopping, setStopping] = useState(false);
  const [pinned, setPinned] = useState(true);

  function revalidate() {
    refreshRevision.current = revision.current;
    void revalidateRef.current();
  }

  useEffect(() => {
    lifetime.current = true;
    return () => {
      lifetime.current = false; sendAttempt.current += 1; sendAbort.current?.abort();
      if (ackTimer.current !== null) clearTimeout(ackTimer.current);
    };
  }, []);

  useEffect(() => { if (loadError) setError(loadError); }, [loadError]);

  useEffect(() => {
    if (!initialConversation) return;
    setError(null);
    setConversation(current => {
      if (current && current.id !== initialConversation.id) return current;
      if (!current) return initialConversation;
      if (revision.current === refreshRevision.current) return { ...initialConversation, events: initialConversation.events.reduce(upsertSessionEventRow, current.events), lastEventSeq: Math.max(current.lastEventSeq, initialConversation.lastEventSeq) };
      // A loader response can race newer frames. Keep the live envelope/rows in
      // that case, filling only history missing from the live window.
      return { ...current, events: current.events.reduce(upsertSessionEventRow, initialConversation.events), lastEventSeq: Math.max(current.lastEventSeq, initialConversation.lastEventSeq) };
    });
  }, [initialConversation]);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    let streamGeneration = 0;
    let unsubscribe: ReturnType<typeof subscribeToConversationStream> | null = null;
    const abort = new AbortController();
    const cursor = createConversationStreamCursor(conversationRef.current?.lastEventSeq ?? -1);
    const pendingRows = new Map<string, SessionEventRow>();
    const settleTimers = new Map<string, ReturnType<typeof setTimeout>>();
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let recovering = false;
    const current = (generation: number) => !cancelled && streamGeneration === generation;
    const clearSettlements = () => { for (const timer of settleTimers.values()) clearTimeout(timer); settleTimers.clear(); };
    const schedulePoll = () => {
      if (cancelled || pollTimer !== null) return;
      pollTimer = setTimeout(() => { pollTimer = null; void recover(streamGeneration); }, RECOVERY_POLL_MS);
    };
    const recover = async (generation: number) => {
      if (!current(generation) || recovering) return;
      recovering = true;
      const before = revision.current;
      try {
        // Q7: reconcile detail even for a running turn so same-seq delivery
        // edits are recovered as well as replaying from the acknowledged cursor.
        const fresh = await fetchConversationDetailsAfterStatus(conversationId, undefined, undefined, abort.signal);
        if (!current(generation)) return;
        const unsettled = [...pendingRows.values()];
        setConversation(previous => {
          if (!previous || previous.id !== fresh.id) return previous;
          const installed = unsettled.reduce(upsertSessionEventRow, previous.events);
          if (before === revision.current) return { ...fresh, events: fresh.events.reduce(upsertSessionEventRow, installed), lastEventSeq: Math.max(previous.lastEventSeq, fresh.lastEventSeq) };
          return { ...previous, events: installed.reduce(upsertSessionEventRow, fresh.events), lastEventSeq: Math.max(previous.lastEventSeq, fresh.lastEventSeq) };
        });
        setError(null);
        if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null; }
        // Detail is bounded to the newest 200 rows. Reconnect from the SSE
        // acknowledgement, never from detail/status's potentially distant tip.
        // Install retained settlement rows before invalidating their generation.
        clearSettlements(); pendingRows.clear(); setStreamingBlocks([]);
        if (resumable(fresh) || fresh.lastEventSeq > cursor.value()) connectStream();
        revalidate();
      } catch (caught) {
        if (!current(generation)) return;
        if (isConversationNotFound(caught)) {
          unsubscribe?.(); streamGeneration += 1; clearSettlements();
          if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null; }
          if (refreshTimer !== null) { clearTimeout(refreshTimer); refreshTimer = null; }
          setError(CONVERSATION_GONE);
          setConversation(previous => previous ? { ...previous, status: "stopped", chat: { ...previous.chat, canSend: false, activeTurn: false, runtimeStatus: "closed", reason: "closed" } } : previous);
          return;
        }
        setError(TRANSPORT_ERROR); schedulePoll();
      } finally { recovering = false; }
    };
    const connectStream = () => {
      const generation = ++streamGeneration;
      unsubscribe?.();
      unsubscribe = subscribeToConversationStream(conversationId, cursor.value(), {
        onActivity: (seq, row) => {
          if (!current(generation)) return;
          revision.current += 1; cursor.acknowledge(seq); setError(null);
          const applyRow = () => {
            if (!current(generation)) return;
            setConversation(previous => previous ? { ...previous, events: upsertSessionEventRow(previous.events, row), lastEventSeq: Math.max(previous.lastEventSeq, seq) } : previous);
          };
          if (row.type === "message" || row.type === "reasoning" || row.type === "thinking") {
            const blockId = row.payload.activityEventId ?? row.payload.canonicalEventId ?? row.id;
            pendingRows.set(blockId, row);
            const existing = settleTimers.get(blockId);
            if (existing) clearTimeout(existing);
            settleTimers.set(blockId, setTimeout(() => {
              settleTimers.delete(blockId); pendingRows.delete(blockId);
              if (!current(generation)) return;
              setStreamingBlocks(blocks => blocks.filter(block => block.blockId !== blockId)); applyRow();
            }, STREAM_SETTLE_PAUSE_MS));
          } else applyRow();
        },
        onDelta: delta => {
          if (!current(generation)) return;
          revision.current += 1;
          setStreamingBlocks(blocks => applyStreamDelta(blocks, delta));
        },
        onState: frame => {
          if (!current(generation)) return;
          revision.current += 1;
          stateFrameRevision.current += 1;
          dispatchChat({ type: "state_frame", frame });
          setConversation(previous => previous ? applyStateFrame(previous, frame) : previous);
          if (frame.status !== conversationRef.current?.status) revalidate();
        },
        onDone: () => {
          if (!current(generation)) return;
          if (refreshTimer !== null) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => { refreshTimer = null; void recover(generation); }, STREAM_SETTLE_PAUSE_MS + 100);
        },
        onError: () => {
          if (!current(generation)) return;
          unsubscribe?.();
          void recover(generation);
        },
      });
    };
    if (conversationRef.current && resumable(conversationRef.current)) connectStream();
    return () => {
      cancelled = true; streamGeneration += 1; abort.abort(); unsubscribe?.();
      if (pollTimer !== null) clearTimeout(pollTimer);
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      clearSettlements();
    };
  }, [conversationId]);

  const capability = conversation?.chat ?? (selectedId ? { ...NEW_CHAT, canSend: false } : NEW_CHAT);
  const busy = sendPending.current || chatUi.phase === "sending" || capability.activeTurn || activeRuntime(capability.runtimeStatus);
  const presentation = useMemo(() => conversation ? mapSessionEventsToPresentation(conversation.events) : null, [conversation]);
  const startedBlocks = unreconciledStreamingBlocks(streamingBlocks.filter(block => block.text.trim()), conversation?.events ?? []);
  // Q7: CMA commentary metadata also accompanies visible message tokens.
  const visibleBlocks = startedBlocks.filter(block => block.variant === "message");
  const latestUserSeq = Math.max(-1, ...(conversation?.events.filter(row => row.type === "user_message").map(row => row.seq) ?? []));
  const liveActivity = resolveConversationLiveActivity({ isLive: busy, projectedActivity: projectCurrentAgentActivityText(conversation?.events ?? [], startedBlocks), runtimeStatus: capability.runtimeStatus, lastEventSeq: conversation?.lastEventSeq ?? -1, optimisticLastEventSeq: null });

  // The optimistic bubble stands only until its own persisted row lands, so the
  // swap is a delivery-label change and never a message appearing twice.
  const pendingSettled = pending !== null && Boolean(conversation?.events.some(row => row.type === "user_message" && row.seq > pending.seqFloor && row.payload.text === pending.text));
  useEffect(() => { if (pendingSettled) setPending(null); }, [pendingSettled]);
  const optimisticUser: ActivityEvent[] = pending && !pendingSettled
    ? [{ id: `pending:${pending.key}`, kind: "user", text: pending.text, failed: pending.failed, pending: !pending.failed, queued: false }]
    : [];
  const thread = [...(presentation?.activity ?? []), ...optimisticUser, ...visibleBlocks.map(streamingBlockToEvent)];
  // Every line the guest is shown belongs in the transcript, in order. A strip
  // floating above the composer is reserved for nothing: an assistant's fallback,
  // a lost conversation and a dropped transport are all messages.
  const notice: ChatNotice | null = error
    ? { tone: error === TRANSPORT_ERROR ? "status" : "error", text: error, ...(loadError && error === loadError ? { action: { label: "Reload conversation", onAction: revalidate } } : {}) }
    : chatUi.toast
      ? { tone: "error", text: chatUi.toast, ...(pending?.failed ? { action: { label: "Retry", onAction: () => void handleSend(pending.text) } } : {}) }
      : conversation && !busy && (conversation.error || conversation.chat.reason === "no_session")
        ? { tone: "error", text: CHAT_FALLBACK }
        : null;
  // Dots show until the first token of the answer to the *newest* question. While
  // the guest's own row is still optimistic, nothing in `events` sits after it, so
  // the previous answer must not be read as this one's first token.
  const awaitingOwnRow = pending !== null && !pendingSettled && !pending.failed;
  const visibleToken = visibleBlocks.length > 0 || (!awaitingOwnRow && chatUi.phase !== "sending" && Boolean(conversation?.events.some(row => row.seq > latestUserSeq && (row.type === "message" || row.type === "summary") && row.payload.text?.trim())));
  const waiting = busy && !visibleToken;
  const loadingDetail = Boolean(selectedId) && !conversation && !loadError;
  // 1:1 with the design's `hasMessages` switch: the tile grid gives way to the
  // thread only once the thread has something in it, which is what keeps a
  // screen-high void from ever opening between the chip row and the composer.
  const hasThreadContent = thread.length > 0 || waiting || notice !== null || loadingDetail;
  const threadMode = Boolean(conversation || selectedId || chatUi.phase === "sending" || chatUi.toast || pending) && hasThreadContent;

  async function handleStop() {
    if (stopping) return;
    const id = conversationId;
    // Before the first acknowledgement there is no run to cancel, only a POST in
    // flight. Abandon it and hand the guest back exactly what they had: their text
    // in the box, no half-sent message in the thread, and no error — they asked
    // for this. Same abandonment the unmount path already performs.
    if (!id) {
      const restore = chatUi.submittedDraft ?? pending?.text ?? "";
      sendAttempt.current += 1; sendPending.current = false;
      if (ackTimer.current !== null) { clearTimeout(ackTimer.current); ackTimer.current = null; }
      sendAbort.current?.abort(); sendAbort.current = null;
      setPending(null);
      dispatchChat({ type: "reset" });
      if (restore) dispatchChat({ type: "draft", text: restore });
      inputRef.current?.focus();
      return;
    }
    setStopping(true);
    try { await cancelConversation(id); }
    catch { if (lifetime.current) setError(STOP_FAILED); }
    finally { if (lifetime.current) setStopping(false); }
  }

  async function handleSend(override?: string, allowDuringTurn = false, retainedUploadId?: string) {
    const text = override ?? (chatUi.draft.trim() ? chatUi.draft : attachment.file ? "Please read this attachment." : chatUi.draft);
    // A second POST must wait for the first acknowledgement. Once acknowledged,
    // suggestion clicks can use the server's queue while the agent is answering.
    if (sendPending.current || chatUi.phase === "sending" || (!allowDuringTurn && busy) || !capability.canSend || !text.trim()) return;
    sendPending.current = true;
    const attempt = ++sendAttempt.current;
    const frameAtSend = stateFrameRevision.current;
    const controller = new AbortController(); sendAbort.current = controller;
    if (!chatKey.current || chatKey.current.text !== text || chatKey.current.file !== attachment.file) chatKey.current = { text, key: crypto.randomUUID(), file: attachment.file };
    const key = chatKey.current.key;
    dispatchChat({ type: "send_started", text });
    // Move the submitted text into the transcript immediately. If it fails, the
    // question stays visible beside the assistant's actionable error feedback.
    dispatchChat({ type: "draft", text: "" });
    setPending({ key, text, seqFloor: conversationRef.current?.lastEventSeq ?? -1, failed: false });
    setError(null);
    if (window.matchMedia("(width < 860px)").matches) inputRef.current?.blur();
    else inputRef.current?.focus();
    ackTimer.current = setTimeout(() => {
      if (!lifetime.current || sendAttempt.current !== attempt) return;
      sendAttempt.current += 1; sendPending.current = false; ackTimer.current = null; controller.abort();
      dispatchChat({ type: "send_failed", message: "The message wasn’t acknowledged. Please try again." });
      setPending(current => current && current.key === key ? { ...current, failed: true } : current);
    }, attachment.file ? 120_000 : CHAT_SEND_ACK_TIMEOUT_MS);
    try {
      const uploaded = await attachment.prepare(conversationId, controller.signal);
      const targetId = conversationId ?? uploaded?.conversationId;
      if (targetId) {
        const result = await sendConversationChatMessage(targetId, text, key, { signal: controller.signal, ...(uploaded ? { uploadId: uploaded.uploadId } : retainedUploadId ? { uploadId: retainedUploadId } : {}) });
        if (!lifetime.current || sendAttempt.current !== attempt) return;
        if (!result.ok) throw new ApiError(result.error, result.status ?? 500);
        if ((result.conversationId && result.conversationId !== targetId) || (result.requestId && result.requestId !== key)) throw new ApiError("The trip assistant returned an incomplete response. Please try again.", 500);
        if (!conversationId) {
          setConversationSelection(targetId);
          setConversation({ id: targetId, tripId: "", createdAt: "", finishedAt: null, error: null, status: "running", events: [], eventsTruncated: false, eventsCursor: null, lastEventSeq: -1, agentSessionId: null, pendingWakeupAt: null, chat: { ...NEW_CHAT, activeTurn: true, runtimeStatus: "starting" } });
        }
        // A fast provider boundary can precede its slower POST acknowledgement.
        // Keep that newer authoritative frame instead of making an idle turn busy.
        if (stateFrameRevision.current === frameAtSend) {
          setConversation(previous => previous ? { ...previous, status: "running", chat: { ...previous.chat, activeTurn: true, runtimeStatus: "active" } } : previous);
        }
      } else {
        const result = await startConversation(text, key, { signal: controller.signal });
        if (!lifetime.current || sendAttempt.current !== attempt) return;
        setConversationSelection(result.conversationId);
        // No fabricated row: start replay at -1 until the loader/stream supplies
        // the durable opening message. The POST acknowledgement is not a row.
        setConversation({ id: result.conversationId, tripId: "", createdAt: "", finishedAt: null, error: null, status: "running", events: [], eventsTruncated: false, eventsCursor: null, lastEventSeq: -1, agentSessionId: null, pendingWakeupAt: null, chat: { ...NEW_CHAT, activeTurn: true, runtimeStatus: "starting" } });
      }
      attachment.select(null);
      chatKey.current = null; dispatchChat({ type: "send_accepted" }); revalidate();
    } catch (error) {
      if (!lifetime.current || sendAttempt.current !== attempt) return;
      dispatchChat({ type: "send_failed", message: error instanceof AttachmentRequestError ? error.message : error instanceof ApiError ? error.message : CHAT_UNAVAILABLE_MESSAGE });
      // A definite provider/server failure is safe to retry as a new request.
      // Reusing its idempotency key would only replay the stored failed result.
      if (error instanceof ApiError && error.status >= 500) chatKey.current = null;
      // Keep the question visible; the notice above the composer carries retry.
      setPending(current => current && current.key === key ? { ...current, failed: true } : current);
    } finally {
      controller.abort();
      if (sendAttempt.current === attempt) {
        if (ackTimer.current !== null) clearTimeout(ackTimer.current);
        ackTimer.current = null; sendPending.current = false; sendAbort.current = null;
      }
    }
  }

  // No in-thread header: the sidebar's "New chat" is the only affordance that
  // starts a conversation over, exactly as in the design and in every real chat app.
  return <>
    {threadMode ? <>
      <h1 className="sr-only" id="overview-heading">Trip conversation</h1>
      {/* No chip row above the thread. Owner, 2026-09-28: "whenever we start a
          new message, it should take up everything on that screen. There should
          not be an additional header." The figures it repeated (10:30, 08:30,
          beds) are the FAQ's job on the home screen; in a conversation they are
          chrome competing with the answer. The sections remain reachable from
          the sidebar and from an answer's own source links. */}
      {loadingDetail ? <ChatLoading /> : <ChatThread events={thread} live={busy} waiting={waiting} activity={liveActivity.text} notice={notice}
        canRetryUserMessages={!busy && capability.canSend} onRetryUserMessage={(text, uploadId) => { chatKey.current = null; void handleSend(text, false, uploadId); }} onPinnedChange={setPinned} />}
    </> : children}
    <div className="composer-shell">
      {threadMode && !pinned && <div className="chat-jump-row">
        <button type="button" className="chat-jump" onClick={scrollToLatest}>Jump to latest ↓</button>
      </div>}
      <ChatComposer attachment={attachment.file} onAttachmentChange={attachment.select} capability={capability} state={chatUi} busy={busy} stopping={stopping}
        inputRef={inputRef} onDraftChange={text => dispatchChat({ type: "draft", text })} onSend={() => void handleSend()}
        onStop={() => void handleStop()} />
      <div className="suggestions navrow">{CHAT_SUGGESTIONS.map(question => <button type="button" key={question} disabled={sendPending.current || chatUi.phase === "sending" || !capability.canSend} onClick={() => void handleSend(question, true)}>{question}</button>)}</div>
    </div>
  </>;
}
