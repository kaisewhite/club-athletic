// Controlled composer ported from edge's execution-chat-input.tsx. Q1 gates
// only the guest affordance; the shared reducer still supports queued sends.
import { ChatAttachment } from "./chat-attachment";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { canSubmitChat, chatDisabledReason, type ConversationChatUiState } from "@/lib/chat/chat-state";
import type { ConversationChatCapability } from "@/lib/chat/contracts";

export function ChatComposer({ capability, state, busy, onDraftChange, onSend, onStop, stopping = false, inputRef, attachment, onAttachmentChange }: {
  capability: ConversationChatCapability; state: ConversationChatUiState; busy: boolean;
  onDraftChange: (text: string) => void; onSend: () => void;
  /** Cancels the answer in flight. Given only when there is a run to cancel. */
  onStop?: () => void; stopping?: boolean;
  attachment?: File | null; onAttachmentChange?: (file: File | null) => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? localRef;
  const disabledReason = chatDisabledReason(capability);
  const submitReady = !busy && (canSubmitChat(state, capability) || Boolean(attachment && capability.canSend && state.phase !== "sending"));
  // While a turn is in flight the primary control stops it instead of sitting
  // there disabled with nothing to say. Without an `onStop` there is nothing to
  // cancel, so Send stays and is honestly disabled.
  const showStop = busy && Boolean(onStop);
  // Auto-size, unchanged in what it computes — with the one addition that it is
  // recomputed when the textarea's WIDTH changes, which TODO §2.15's mobile pass
  // showed to be necessary below the 860px seam.
  //
  // The measured `scrollHeight` depends on the box's width: a narrower textarea
  // wraps the draft — or, when empty, the placeholder — onto more lines. At mount
  // on a phone that width is wrong. `useWideLayout()` starts from the SSR
  // snapshot (`true`), so the 250px sidebar is still in the DOM for the first
  // layout pass and, at 320–414px, the composer is measured at roughly zero
  // width. The placeholder wrapped onto a dozen lines, `scrollHeight` sailed past
  // the 160px cap, and the height stuck there: a 174px-tall composer on every
  // phone, ~30% of an iPhone SE's viewport, because nothing re-ran the effect
  // once the sidebar unmounted.
  //
  // Observing width fixes the seam flip, and device rotation and the soft
  // keyboard along with it. The guard is what keeps it from looping: the
  // observer also fires for the height *this effect just set*.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      // A zero-width box cannot be measured meaningfully — that is exactly the
      // SSR "wide" layout still in the DOM on a phone, where `flex: 1` plus
      // `min-width: 0` collapses the textarea to nothing. Writing a height from
      // that pass is what produced the 160px cap; skipping it leaves the CSS
      // one-row default until the observer sees a real width.
      if (el.clientWidth === 0) return;
      el.style.height = "auto";
      const height = el.scrollHeight;
      el.style.height = `${Math.max(38, Math.min(height, 160))}px`;
      el.style.overflowY = height > 160 ? "auto" : "hidden";
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, [state.draft, ref]);
  return <>
    {disabledReason && <p className="chat-notice" role="status">{disabledReason}</p>}
    <ChatAttachment file={attachment ?? null} disabled={busy || !capability.canSend} onChange={onAttachmentChange ?? (() => {})}>{control => <form className="composer" onSubmit={event => { event.preventDefault(); if (submitReady) onSend(); }}>
      {control}
      <textarea ref={ref} rows={1} maxLength={8192} aria-label="Ask anything about the trip" placeholder="Ask anything about the trip…"
        value={state.draft} onChange={event => onDraftChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault(); if (submitReady) onSend();
          }
        }} />
      {showStop
        ? <button type="button" disabled={stopping} className="stop" aria-label="Stop response" onClick={onStop}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
        </button>
        : <button type="submit" disabled={!submitReady} className="send" aria-label="Send">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
        </button>}
    </form>}</ChatAttachment>
  </>;
}
