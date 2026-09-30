// edge's execution-stream event dispatch, with plain React text (D5), source
// navigation and decoded bubbles. The browser projection owns event order.
import { useRef } from "react";
import { Link } from "react-router";
import type { ActivityEvent } from "@/lib/chat/contracts";
import { parseAnswerSources } from "@/lib/chat/sources";
import { useAutoScroll } from "../../lib/chat/use-auto-scroll";
import { AttachmentLabel } from "./chat-attachment";
import { ChatActivity } from "./chat-activity";
import { ChatToolGroup } from "./chat-tool-group";

export const CHAT_FALLBACK = "That's not in the trip notes yet — ask the organizer.";

/**
 * A panel-owned line that is not a durable row: a delivery failure, a lost
 * conversation, a reconnecting transport. Every one of these is something the
 * assistant is telling the guest, so it renders as a message inside the thread —
 * never as a floating strip above the composer, which is what a real chat app
 * reserves for nothing at all. `tone` only changes the rule colour; the message
 * stays in the flow so the transcript reads in order.
 */
export interface ChatNotice {
  tone: "error" | "status";
  text: string;
  action?: { label: string; onAction: () => void };
}

function Answer({ text, sections }: { text: string; sections?: string[] }) {
  const answer = parseAnswerSources(text);
  const sources = answer.sources.length ? answer.sources : sections?.length ? parseAnswerSources(`Source: ${sections.join(", ")}`).sources : [];
  return <div className="chat-assistant"><div className="chat-prose">{answer.body}</div>
    {/* Owner, 2026-09-28: "don't need to underline this extra stuff… we're
        adding these extra arrows that we don't really need." The dot and the →
        are gone with them; a source chip is a quiet label, not a call to
        action, which previously had an underline from the global `a` rule. */}
    {sources.length > 0 && <div className="chat-sources">{sources.map(source => <Link key={source.id} to={source.href}>{source.label}</Link>)}</div>}
  </div>;
}

function Notice({ notice }: { notice: ChatNotice }) {
  return <div className={`chat-assistant chat-assistant-notice${notice.tone === "status" ? " chat-assistant-status" : ""}`}
    data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>
    <div className="chat-prose">{notice.text}</div>
    {notice.action && <div className="chat-message-actions">
      <button type="button" onClick={notice.action.onAction}>{notice.action.label}</button>
    </div>}
  </div>;
}

function ChatEvent({ event, live, newest, onEdit, onResend, canResend }: {
  event: ActivityEvent; live: boolean; newest: boolean; onEdit?: (text: string) => void;
  onResend?: (text: string) => void; canResend: boolean;
}) {
  switch (event.kind) {
    case "instructions": return null;
    case "prose": return <Answer text={event.text} sections={event.sourceSections} />;
    case "reasoning": return <div className="chat-notice">Thinking through the next step…</div>;
    case "summary": return <Answer text={[event.text, ...event.bullets.map(bullet => `${bullet.label}: ${bullet.text}`)].join("\n")} />;
    case "error": return <Answer text={CHAT_FALLBACK} />;
    case "group": return <ChatToolGroup group={event} live={live} />;
    case "subagent": return <>{event.events.map((child, index) => <ChatEvent key={`${child.id}:${index}`} event={child} live={live} newest={false} onEdit={onEdit} onResend={onResend} canResend={canResend} />)}</>;
    case "user": return <div className="chat-user">
      <div className="chat-user-bubble">{event.text}<AttachmentLabel value={event.upload} /></div>
      {/* Only a FAILURE is worth a status line. Owner, 2026-09-28: "There's never
          a `sent`. It just sends. After the message gets sent, there's no need to
          display a status underneath the user's message." A message that appears
          in the thread has self-evidently been sent; "Sent"/"Sending…" is noise
          that no real chat app shows. "Not delivered" stays, because that is the
          one state the guest has to act on — it pairs with Edit/Resend below. */}
      {event.failed && <span className="chat-delivery" role="status">Not delivered</span>}
      {event.failed && <div className="chat-message-actions">
        <button type="button" onClick={() => onEdit?.(event.text)}>Edit message</button>
        <button type="button" disabled={!canResend} onClick={() => onResend?.(event.text)}>Resend</button>
      </div>}
    </div>;
  }
}

/**
 * The transcript. Everything the guest is told lives inside it and in order:
 * messages, the pre-first-token loader, and any panel notice. One `useAutoScroll`
 * owns following the stream and reporting whether the reader is still pinned to
 * the bottom — a second scroll listener here would be able to disagree with it.
 */
export function ChatThread({ events, live = false, waiting = false, activity = null, notice = null, onEditUserMessage, onResendUserMessage, canResend = false, onPinnedChange }: {
  events: ActivityEvent[]; live?: boolean; waiting?: boolean; activity?: string | null;
  notice?: ChatNotice | null; onEditUserMessage?: (text: string) => void;
  onResendUserMessage?: (text: string) => void; canResend?: boolean;
  onPinnedChange?: (pinned: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // followWhenPinned keeps a settled transcript pinned as late rows land, which
  // is why this needs no second effect counting events.
  useAutoScroll({ contentRef: ref, active: live, followWhenPinned: true, onPinnedChange });
  return <div className="chat-thread" role="log" aria-live="polite" aria-label="Trip conversation" ref={ref}>
    {events.map((event, index) => <ChatEvent key={`${event.id}:${index}`} event={event} live={live} newest={index === events.length - 1} onEdit={onEditUserMessage} onResend={onResendUserMessage} canResend={canResend} />)}
    {waiting && <ChatActivity currentActivity={activity} indicatorOnly />}
    {notice && <Notice notice={notice} />}
  </div>;
}
