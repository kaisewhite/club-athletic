import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider, useLoaderData } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../../app/components/chat/chat-panel";
import { ChatThread, CHAT_FALLBACK } from "../../app/components/chat/chat-thread";
import { ChatComposer } from "../../app/components/chat/chat-composer";
import { ApiError, CHAT_UNAVAILABLE_MESSAGE } from "../../app/lib/chat/api";
import { canSubmitChat, chatUiReducer, initialChatUiState } from "@/lib/chat/chat-state";
import { mapSessionEventsToPresentation } from "@/lib/chat/event-projection";
import type { ConversationDetails, ConversationSessionStateFrame, SessionEventRow } from "@/lib/chat/contracts";
import type { ConversationStreamHandlers } from "../../app/lib/chat/api";
import { readConversationSelection, setConversationSelection } from "../../app/lib/chat/detail-loader";
import { isAutoScrollFollowSuspended, isPinnedToBottom } from "../../app/lib/chat/use-auto-scroll";

const api = vi.hoisted(() => ({ subscribe: vi.fn(), recover: vi.fn(), send: vi.fn(), start: vi.fn(), cancel: vi.fn() }));
vi.mock("../../app/lib/chat/api", async importOriginal => ({ ...await importOriginal<object>(), subscribeToConversationStream: api.subscribe, fetchConversationDetailsAfterStatus: api.recover, sendConversationChatMessage: api.send, startConversation: api.start, cancelConversation: api.cancel }));
const row = (seq: number, type: string, payload: SessionEventRow["payload"]): SessionEventRow => ({ id: `row-${seq}`, seq, type, payload });
const opening = row(0, "user_message", { text: "When do I land?", delivery: "sent" });
function detail(active = true, events = [opening]): ConversationDetails {
  return { id: "conversation-1", tripId: "trip", createdAt: "", finishedAt: null, error: null, status: active ? "running" : "completed", events, eventsTruncated: false, eventsCursor: null, lastEventSeq: events.at(-1)?.seq ?? -1, agentSessionId: null, pendingWakeupAt: null,
    chat: { canSend: true, reason: null, runtimeStatus: active ? "active" : "waiting", pendingWakeupAt: null, activeTurn: active, waitingOnApproval: false } };
}
const frame = (runtimeStatus: string): ConversationSessionStateFrame => ({ runtimeStatus, status: runtimeStatus === "waiting" ? "completed" : "running", activeRequestIdPresent: false, activeTurnId: null, pendingWakeupAt: null, waitingOnApproval: false });
let root: Root | undefined;
let router: ReturnType<typeof createMemoryRouter> | undefined;
let container: HTMLDivElement;
let handlers: ConversationStreamHandlers[];
let unsubscribes: ReturnType<typeof vi.fn>[];
let observers: { disconnect: ReturnType<typeof vi.fn>; callback: ResizeObserverCallback }[];

beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.subscribe.mockReset(); api.recover.mockReset(); api.send.mockReset(); api.start.mockReset(); api.cancel.mockReset().mockResolvedValue(undefined);
  handlers = []; unsubscribes = []; observers = [];
  api.subscribe.mockImplementation((_id, _seq, callbacks: ConversationStreamHandlers) => {
    handlers.push(callbacks); const stop = Object.assign(vi.fn(), { finished: Promise.resolve() }); unsubscribes.push(stop); return stop;
  });
  vi.stubGlobal("ResizeObserver", class {
    disconnect = vi.fn(); observe = vi.fn(); unobserve = vi.fn();
    constructor(callback: ResizeObserverCallback) { observers.push({ disconnect: this.disconnect, callback }); }
  });
  container = document.createElement("div"); document.body.append(container);
});
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined; router?.dispose(); router = undefined;
  setConversationSelection(null); document.body.innerHTML = "";
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function mount(element: React.ReactNode) {
  router = createMemoryRouter([{ path: "*", element }]);
  await act(async () => { root = createRoot(container); root.render(<RouterProvider router={router!} />); });
}
async function panel(initial: ConversationDetails | null, loader = vi.fn(async () => initial)) {
  function Surface() {
    const loaded = useLoaderData<ConversationDetails | null>();
    const [reset, setReset] = useState(false);
    // Stands in for AppShell's sidebar button: starting over is the shell's job,
    // and the panel renders no such control inside the conversation thread.
    return <>
      <button type="button" onClick={() => { setConversationSelection(null); setReset(true); }}>New question</button>
      <ChatPanel key={String(reset)} initialConversation={reset ? null : loaded}><div className="overview-tiles">Home tile grid</div></ChatPanel>
    </>;
  }
  router = createMemoryRouter([{ path: "/", loader, element: <Surface /> }]);
  await act(async () => { root = createRoot(container); root.render(<RouterProvider router={router!} />); });
  return loader;
}
async function click(selector: string) { await act(async () => { container.querySelector<HTMLButtonElement>(selector)!.click(); }); }
async function emit(callback: (value: ConversationStreamHandlers) => void, index = handlers.length - 1) { await act(async () => callback(handlers[index]!)); }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function button(text: string) { return [...container.querySelectorAll<HTMLButtonElement>("button")].find(el => el.textContent === text)!; }

describe("ported chat presentation and guest composer", () => {
  it("keeps the queue-capable reducer beneath the single-flight button and Enter gate", async () => {
    const state = chatUiReducer(initialChatUiState(), { type: "draft", text: "Follow up" });
    const capability = detail().chat;
    expect(canSubmitChat(state, capability)).toBe(true);
    const send = vi.fn();
    await mount(<ChatComposer capability={capability} state={state} busy onDraftChange={vi.fn()} onSend={send} />);
    expect(container.querySelector(".send")?.hasAttribute("disabled")).toBe(true);
    await act(async () => { container.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(send).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Interrupt");
  });
  it("parses ordered, deduplicated Source chips into real route links and leaves markdown escaped", async () => {
    await mount(<ChatThread events={[{ id: "answer", kind: "prose", text: '**Plain** <script>bad()</script>\nSource: links chalet schedule events chef pricing spots room flight shuttle' }]} />);
    expect([...container.querySelectorAll(".chat-sources a")].map(el => el.getAttribute("href"))).toEqual(["/shuttle", "/flights", "/rooms", "/spots", "/chef", "/schedule", "/chalet", "/links"]);
    expect(container.querySelector("script")).toBeNull(); expect(container.querySelector(".chat-prose strong")).toBeNull();
    expect(container.textContent).toContain("**Plain** <script>bad()</script>"); expect(container.textContent).not.toContain("Source:");
    await act(async () => { container.querySelector<HTMLAnchorElement>('a[href="/flights"]')!.click(); });
    expect(router!.state.location.pathname).toBe("/flights");
  });
  it("uses sources already parsed by the browser projection", async () => {
    const events = mapSessionEventsToPresentation([row(1, "message", { text: "Arrive early.\nSource: flights" })]).activity;
    await mount(<ChatThread events={events} />);
    expect(container.querySelector(".chat-sources a")?.getAttribute("href")).toBe("/flights");
  });
  it("pairs tools across narration, preserves accordion state during streaming and never shows diagnostics", async () => {
    const rows = [opening, row(1, "tool_call", { toolName: "getRooms", invocationId: "call", input: { secret: "secret-value" } }), row(2, "message", { text: "Checking." })];
    const events = mapSessionEventsToPresentation(rows).activity;
    function ToolSurface() { const [done, setDone] = useState(false); return <><ChatThread live events={done ? mapSessionEventsToPresentation([...rows, row(3, "tool_result", { toolName: "getRooms", invocationId: "call", ok: false, error: "raw-diagnostic" })]).activity : events} /><button onClick={() => setDone(true)}>Finish tool</button></>; }
    await mount(<ToolSurface />);
    await click(".chat-tool-group > button"); expect(container.textContent).toContain("Checking trip notes…");
    expect(isAutoScrollFollowSuspended()).toBe(true);
    await act(async () => button("Finish tool").click());
    expect(container.querySelector(".chat-tool-group > button")?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Trip notes unavailable."); expect(container.textContent).not.toMatch(/secret-value|raw-diagnostic|Show raw/);
  });
  it("does not add delivery labels to transcript messages", async () => {
    // Owner, 2026-09-28: "There's never a `sent`. It just sends. After the message
    // gets sent, there's no need to display a status underneath the user's
    // message." A message visible in the thread has self-evidently been sent, so
    // "Sent"/"Sending…"/"Queued" are noise. A current send failure gets its
    // actionable assistant notice from the panel.
    const events = mapSessionEventsToPresentation([row(0, "user_message", { text: "one", delivery: "queued" }), row(1, "user_message", { text: "two", delivery: "failed" }), row(2, "user_message", { text: "three", delivery: "pending" })]).activity;
    await mount(<ChatThread events={events} />);
    expect(container.textContent).not.toContain("Not delivered");
    for (const noise of ["Sent", "Sending…", "Queued"]) expect(container.textContent).not.toContain(noise);
  });
  it("shows the grid initially, then thread shortcuts and blink dots as a suggestion sends", async () => {
    api.start.mockReturnValue(new Promise(() => {}));
    await panel(null);
    expect(container.querySelector(".overview-tiles")).not.toBeNull();
    expect(container.querySelectorAll(".suggestions button")).toHaveLength(5);
    await click(".suggestions button");
    // Thread mode replaces the home content entirely: no tile grid, and no chip
    // row above the conversation either (owner, 2026-09-28 — the thread "should
    // take up everything on that screen. There should not be an additional header").
    expect(container.querySelector(".overview-tiles")).toBeNull(); expect(container.querySelectorAll(".chat-tile-chips a")).toHaveLength(0);
    expect(container.querySelectorAll(".chat-dots span")).toHaveLength(3);
    expect([...container.querySelectorAll<HTMLElement>(".chat-dots span")].map(el => el.style.animationDelay)).toEqual(["0s", "0.2s", "0.4s"]);
    expect(api.start).toHaveBeenCalledTimes(1);
    await click(".suggestions button"); expect(api.start).toHaveBeenCalledTimes(1);
  });
  it("sends the selected quick option and closes the mobile keyboard", async () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ media: query, matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    api.start.mockReturnValue(new Promise(() => {}));
    await panel(null);
    await click(".suggestions button");
    expect(api.start.mock.calls[0]?.[0]).toBe("What time do I need to land?");
    expect(document.activeElement).not.toBe(container.querySelector("textarea"));
  });
  it("closes the mobile keyboard after sending a typed message", async () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ media: query, matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    api.start.mockReturnValue(new Promise(() => {}));
    await panel(null);
    const input = container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Typed question");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(".send");
    expect(api.start.mock.calls[0]?.[0]).toBe("Typed question");
    expect(document.activeElement).not.toBe(input);
  });
  it("replaces dots with the first visible CMA commentary token and settles durable text once", async () => {
    await panel(detail()); expect(container.querySelector(".chat-dots")).not.toBeNull();
    await emit(h => h.onDelta?.({ blockId: "answer", variant: "message", text: "Arrive early ", done: false, activityKind: "commentary" }));
    expect(container.querySelector(".chat-dots")).toBeNull(); expect(container.textContent).toContain("Arrive early");
    await emit(h => h.onActivity(1, row(1, "message", { text: "Arrive early.", canonicalEventId: "answer", activityEventId: "answer", activityKind: "commentary" })));
    await advance(500);
    expect(container.querySelectorAll(".chat-assistant")).toHaveLength(1); expect(container.textContent).toContain("Arrive early.");
  });
  it("keeps a failed question visible and retries it once from actionable error feedback", async () => {
    api.start.mockRejectedValueOnce(new ApiError(CHAT_UNAVAILABLE_MESSAGE, 503)).mockResolvedValue({ ok: true, conversationId: "retried-conversation", seq: 0 });
    await panel(null); await click(".suggestions button");
    expect(container.querySelector("textarea")?.value).toBe("");
    expect(container.textContent).toContain(CHAT_UNAVAILABLE_MESSAGE);
    expect(container.querySelectorAll(".chat-user-bubble")).toHaveLength(1);
    expect(container.querySelector(".chat-user-bubble")?.textContent).toBe("What time do I need to land?");
    expect(container.textContent).not.toContain("Not delivered");
    expect(container.textContent).not.toContain("Edit message");
    expect(container.textContent).not.toContain("Resend");
    expect(container.textContent).not.toContain(CHAT_FALLBACK);
    expect(vi.getTimerCount()).toBe(0);
    const retry = [...container.querySelectorAll<HTMLButtonElement>(".chat-assistant-notice button")].find(el => /retry/i.test(el.textContent ?? ""))!;
    await act(async () => { retry.click(); retry.click(); });
    expect(api.start).toHaveBeenCalledTimes(2);
    expect(api.start.mock.calls[1]?.[0]).toBe("What time do I need to land?");
    expect(api.start.mock.calls[1]?.[1]).not.toBe(api.start.mock.calls[0]?.[1]);
  });
  it("New question detaches selection, preserves old rows and creates a new conversation on the next ask", async () => {
    const old = detail(false); setConversationSelection(old.id);
    api.start.mockResolvedValue({ ok: true, conversationId: "new-conversation", seq: 0 });
    await panel(old);
    await act(async () => button("New question").click());
    expect(readConversationSelection(document.cookie)).toBeNull(); expect(container.querySelector(".overview-tiles")).not.toBeNull();
    expect(unsubscribes[0]).toHaveBeenCalledTimes(1); expect(old.events).toEqual([opening]);
    await click(".suggestions button");
    expect(api.start).toHaveBeenCalledTimes(1); expect(api.send).not.toHaveBeenCalled();
    expect(readConversationSelection(document.cookie)).toBe("new-conversation");
    expect(api.subscribe.mock.calls.at(-1)?.slice(0, 2)).toEqual(["new-conversation", -1]);
  });
});

describe("stream recovery, acknowledgements and lifetime", () => {
  it("reconnects from acknowledged rows without duplicates and rejects stale callbacks", async () => {
    const fresh = detail(true, [opening, row(1, "message", { text: "Answer." })]); api.recover.mockResolvedValue(fresh);
    await panel(detail());
    await emit(h => h.onActivity(1, fresh.events[1]!)); await advance(500);
    await emit(h => h.onError?.());
    expect(api.subscribe.mock.calls.at(-1)?.slice(0, 2)).toEqual(["conversation-1", 1]);
    await emit(h => h.onActivity(1, fresh.events[1]!)); await advance(500);
    await emit(h => { h.onActivity(9, row(9, "message", { text: "STALE" })); h.onDelta?.({ blockId: "late", variant: "message", text: "STALE", done: false }); h.onState?.(frame("closed")); }, 0);
    expect(container.querySelectorAll(".chat-assistant")).toHaveLength(1); expect(container.textContent).not.toContain("STALE");
  });
  it("polls every 2s after transport/status failure, reconciles delivery edits, then unsubscribes", async () => {
    const failed = detail(true, [row(0, "user_message", { text: "When do I land?", delivery: "failed" })]);
    api.recover.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(failed);
    await panel(detail()); await emit(h => h.onError?.());
    expect(container.textContent).toContain("Reconnecting…"); await advance(1999); expect(api.recover).toHaveBeenCalledTimes(1);
    await advance(1); expect(api.recover).toHaveBeenCalledTimes(2); expect(container.textContent).not.toContain("Reconnecting…");
    await act(async () => root!.unmount()); root = undefined;
    expect(unsubscribes.every(stop => stop.mock.calls.length > 0)).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it("clears pending settlement, done-refresh, polling, ResizeObserver and scroll listeners on unmount", async () => {
    const add = vi.spyOn(window, "addEventListener"); const remove = vi.spyOn(window, "removeEventListener");
    api.recover.mockRejectedValue(new Error("offline"));
    await panel(detail()); await emit(h => { h.onActivity(1, row(1, "message", { text: "Late" })); h.onDone?.(); h.onError?.(); });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    const signal = api.recover.mock.calls[0]![3] as AbortSignal;
    await act(async () => root!.unmount()); root = undefined;
    expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0); expect(observers.every(observer => observer.disconnect.mock.calls.length > 0)).toBe(true);
    for (const call of add.mock.calls.filter(call => call[0] === "scroll")) expect(remove.mock.calls.some(removed => removed[0] === "scroll" && removed[1] === call[1])).toBe(true);
    await emit(h => { h.onActivity(2, row(2, "message", { text: "After unmount" })); h.onDelta?.({ blockId: "x", variant: "message", text: "late", done: false }); h.onError?.(); });
    expect(vi.getTimerCount()).toBe(0); expect(container.textContent).toBe("");
  });
  it("aborts an unacknowledged send and timer on unmount; ignores its late success", async () => {
    let resolve!: (value: unknown) => void; api.start.mockReturnValue(new Promise(next => { resolve = next; }));
    await panel(null); await click(".suggestions button");
    const signal = api.start.mock.calls[0]![2].signal as AbortSignal;
    await act(async () => root!.unmount()); root = undefined;
    expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
    await act(async () => resolve({ ok: true, conversationId: "late-conversation", seq: 0 }));
    expect(readConversationSelection(document.cookie)).toBeNull(); expect(api.subscribe).not.toHaveBeenCalled();
  });
  it("times out after 15s, keeps one failed bubble and reuses its request key on retry", async () => {
    api.start.mockReturnValue(new Promise(() => {})); await panel(null); await click(".suggestions button");
    const first = api.start.mock.calls[0]!; await advance(15_000);
    expect(first[2].signal.aborted).toBe(true); expect(container.querySelector("textarea")?.value).toBe("");
    expect(container.querySelectorAll(".chat-user-bubble")).toHaveLength(1);
    expect(container.textContent).toContain("wasn’t acknowledged");
    const retry = [...container.querySelectorAll<HTMLButtonElement>(".chat-assistant-notice button")].find(el => /retry/i.test(el.textContent ?? ""))!;
    await act(async () => retry.click()); expect(api.start.mock.calls[1]![1]).toBe(first[1]);
  });
  it("rejects an acknowledgement for a different conversation without duplicating its bubble", async () => {
    api.send.mockResolvedValue({ ok: true, seq: 1, conversationId: "wrong" }); await panel(detail(false)); await click(".suggestions button");
    expect(container.querySelector("textarea")?.value).toBe(""); expect(container.querySelectorAll(".chat-user-bubble")).toHaveLength(2);
    expect(container.textContent).toContain("The trip assistant returned an incomplete response."); expect(container.textContent).not.toContain(CHAT_FALLBACK);
  });
  it("does not skip a replay gap beyond the bounded detail window or lose unsettled acknowledged rows", async () => {
    const recent = row(1000, "message", { text: "Latest answer." });
    api.recover.mockResolvedValue(detail(true, [recent]));
    await panel(detail());
    await emit(h => h.onActivity(1, row(1, "message", { text: "Unsettled answer." })));
    await emit(h => h.onError?.());
    expect(api.subscribe.mock.calls.at(-1)?.slice(0, 2)).toEqual(["conversation-1", 1]);
    expect(container.textContent).toContain("When do I land?");
    expect(container.textContent).toContain("Unsettled answer.");
    await emit(h => h.onActivity(2, row(2, "message", { text: "Missed history." })));
    await advance(500);
    expect(container.textContent).toContain("Missed history.");
    expect(container.textContent).toContain("Latest answer.");
  });
  it("replays a large missed window even after the session has closed, then stops reconnecting", async () => {
    const fresh = detail(false, [row(1000, "message", { text: "Last answer." })]);
    fresh.chat = { ...fresh.chat, runtimeStatus: "closed", canSend: false, reason: "closed" };
    api.recover.mockResolvedValue(fresh);
    await panel(detail()); await emit(h => h.onError?.());
    expect(api.subscribe.mock.calls.at(-1)?.slice(0, 2)).toEqual(["conversation-1", 0]);
    await emit(h => { h.onActivity(2, row(2, "message", { text: "Missed before closing." })); h.onActivity(1000, fresh.events[0]!); h.onDone?.(); });
    await advance(600);
    expect(container.textContent).toContain("Missed before closing.");
    expect(api.subscribe).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts an in-progress recovery and ignores a fresh detail arriving after unmount", async () => {
    let resolve!: (value: ConversationDetails) => void;
    api.recover.mockReturnValue(new Promise(next => { resolve = next; }));
    await panel(detail()); await emit(h => h.onError?.());
    const signal = api.recover.mock.calls[0]![3] as AbortSignal;
    await act(async () => root!.unmount()); root = undefined;
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(detail()));
    expect(api.subscribe).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps Send and suggestions disabled if a waiting frame arrives before the POST acknowledgement", async () => {
    api.send.mockReturnValue(new Promise(() => {}));
    await panel(detail(false)); await click(".suggestions button");
    await emit(h => h.onState?.({ ...frame("waiting"), activeRequestIdPresent: true }));
    // A turn in flight puts Stop where Send was, rather than a dead Send button.
    expect(container.querySelector(".send")).toBeNull();
    expect(container.querySelector(".stop")).not.toBeNull();
    expect([...container.querySelectorAll(".suggestions button")].every(el => el.hasAttribute("disabled"))).toBe(true);
    expect(api.send).toHaveBeenCalledTimes(1);
  });
  it("does not let a late acknowledgement reactivate a turn already settled by SSE", async () => {
    let resolve!: (value: unknown) => void;
    api.send.mockReturnValue(new Promise(next => { resolve = next; }));
    const loader = vi.fn().mockResolvedValueOnce(detail(false)).mockResolvedValue(null);
    await panel(detail(false), loader); await click(".suggestions button");
    await emit(h => h.onState?.(frame("waiting")));
    await act(async () => resolve({ ok: true, seq: 1, conversationId: "conversation-1" }));
    expect([...container.querySelectorAll(".suggestions button")].every(el => !el.hasAttribute("disabled"))).toBe(true);
    expect(container.querySelector(".chat-dots")).toBeNull();
  });
  it("stops polling a confirmed missing conversation and offers New question", async () => {
    api.recover.mockRejectedValue(new Error("Conversation not found."));
    await panel(detail()); await emit(h => h.onError?.()); await advance(10_000);
    expect(api.recover).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    expect(container.querySelector(".chat-thread")?.textContent).toContain("no longer available");
    expect(container.querySelector(".chat-thread .chat-assistant-notice")).not.toBeNull();
  });
  it("keeps the 80px scroll pin boundary", () => {
    expect(isPinnedToBottom({ scrollHeight: 1000, clientHeight: 700, scrollTop: 220 })).toBe(true);
    expect(isPinnedToBottom({ scrollHeight: 1000, clientHeight: 700, scrollTop: 219 })).toBe(false);
  });
});

describe("streaming experience", () => {
  it("renders no header of its own inside the conversation thread", async () => {
    api.start.mockReturnValue(new Promise(() => {}));
    await panel(null); await click(".suggestions button");
    expect(container.querySelector(".chat-thread")).not.toBeNull();
    expect(container.querySelector(".chat-thread-actions")).toBeNull();
    // The only "New question" on the page is the harness's sidebar stand-in.
    expect([...container.querySelectorAll("button")].filter(el => el.textContent === "New question")).toHaveLength(1);
    expect(container.querySelector(".chat-thread")!.contains(button("New question"))).toBe(false);
  });
  it("shows the sent message and empties the box before the server has answered", async () => {
    api.start.mockReturnValue(new Promise(() => {}));
    await panel(null); await click(".suggestions button");
    expect(container.querySelector(".chat-user-bubble")?.textContent).toBe("What time do I need to land?");
    expect(container.querySelector("textarea")?.value).toBe("");
    // No "Sending…" under the bubble; the thinking dots are the only progress cue.
    expect(container.textContent).not.toContain("Sending…");
    // Dots sit inside the thread, in flow after the message, not below it.
    expect(container.querySelector(".chat-thread .chat-dots")).not.toBeNull();
    await advance(15_000);
  });
  it("retires the optimistic bubble on its own durable row without showing the message twice", async () => {
    api.send.mockResolvedValue({ ok: true, seq: 1, conversationId: "conversation-1" });
    await panel(detail(false)); await click(".suggestions button");
    expect(container.querySelectorAll(".chat-user-bubble")).toHaveLength(2);
    await emit(h => h.onActivity(1, row(1, "user_message", { text: "What time do I need to land?", delivery: "sent" })));
    expect(container.querySelectorAll(".chat-user-bubble")).toHaveLength(2);
    expect([...container.querySelectorAll(".chat-user-bubble")].at(-1)?.textContent).toBe("What time do I need to land?");
    expect(container.querySelector(".chat-thread")?.textContent).not.toContain("Sending…");
  });
  it("puts a failed send in the thread as a message with no dismissible strip", async () => {
    api.start.mockRejectedValue(new Error("PrismaClient SQLSTATE secret"));
    await panel(null); await click(".suggestions button");
    const thread = container.querySelector(".chat-thread")!;
    expect(thread.textContent).toContain(CHAT_UNAVAILABLE_MESSAGE);
    expect(thread.textContent).not.toContain(CHAT_FALLBACK);
    expect(thread.textContent).not.toContain("SQLSTATE");
    expect(thread.querySelector(".chat-assistant-notice")).not.toBeNull();
    expect(container.querySelector('[aria-label="Dismiss error"]')).toBeNull();
    expect(container.querySelector(".chat-error")).toBeNull();
    // The message stays visible and retry feedback belongs with the assistant error.
    expect(thread.querySelector(".chat-user-bubble")?.textContent).toBe("What time do I need to land?");
    expect(thread.textContent).not.toContain("Not delivered");
    expect(thread.textContent).not.toContain("Edit message");
    expect(thread.textContent).not.toContain("Resend");
    expect([...thread.querySelectorAll(".chat-assistant-notice button")].map(el => el.textContent)).toContain("Retry");
    expect([...thread.querySelectorAll(".chat-assistant-notice button")].map(el => el.textContent)).not.toContain("Try again");
  });
  it("offers Stop only while a turn is in flight and cancels that conversation", async () => {
    await panel(detail(false));
    expect(container.querySelector(".stop")).toBeNull(); expect(container.querySelector(".send")).not.toBeNull();
    await panel(detail(true));
    expect(container.querySelector(".send")).toBeNull();
    await click(".stop");
    expect(api.cancel).toHaveBeenCalledTimes(1); expect(api.cancel.mock.calls[0]![0]).toBe("conversation-1");
  });
  it("lets Stop abandon a send that has not been acknowledged yet, with no error", async () => {
    api.start.mockReturnValue(new Promise(() => {}));
    await panel(null); await click(".suggestions button");
    // No conversation exists yet, so Stop cannot cancel a run — it abandons the POST.
    expect(container.querySelector(".stop")).not.toBeNull();
    const signal = api.start.mock.calls[0]![2].signal as AbortSignal;
    await click(".stop");
    expect(signal.aborted).toBe(true);
    expect(api.cancel).not.toHaveBeenCalled();
    // The guest is handed back exactly what they had: their text, no stray bubble.
    expect(container.querySelector("textarea")?.value).toBe("What time do I need to land?");
    expect(container.querySelector(".chat-user-bubble")).toBeNull();
    expect(container.querySelector(".chat-assistant-notice")).toBeNull();
    expect(container.querySelector(".overview-tiles")).not.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("offers a jump to latest once the reader scrolls away from the newest content", async () => {
    const scroller = document.scrollingElement ?? document.documentElement;
    for (const [name, value] of [["scrollHeight", 2000], ["clientHeight", 700]] as const) {
      Object.defineProperty(scroller, name, { value, configurable: true });
    }
    Object.defineProperty(scroller, "scrollTop", { value: 0, writable: true, configurable: true });
    try {
      await panel(detail(false));
      expect(container.querySelector(".chat-jump")).not.toBeNull();
      await click(".chat-jump");
      expect(scroller.scrollTop).toBe(2000);
    } finally {
      for (const name of ["scrollHeight", "clientHeight", "scrollTop"]) Reflect.deleteProperty(scroller, name);
    }
  });
  it("keeps a settled, pinned transcript free of a jump affordance", async () => {
    await panel(detail(false));
    expect(container.querySelector(".chat-jump")).toBeNull();
  });
});
