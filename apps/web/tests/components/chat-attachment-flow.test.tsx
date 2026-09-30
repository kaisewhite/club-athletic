import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../../app/components/chat/chat-panel";
import { setConversationSelection } from "../../app/lib/chat/detail-loader";
const api = vi.hoisted(() => ({ send: vi.fn(), subscribe: vi.fn(), stop: vi.fn() }));
vi.mock("../../app/lib/chat/api", async original => ({ ...await original<object>(), sendConversationChatMessage: api.send, subscribeToConversationStream: api.subscribe }));
let root: Root | undefined;
let router: ReturnType<typeof createMemoryRouter>;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  api.send.mockReset(); api.stop.mockReset(); api.subscribe.mockReturnValue(Object.assign(api.stop, { finished: Promise.resolve() }));
  container = document.createElement("div"); document.body.append(container);
});
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined; router.dispose(); container.remove(); setConversationSelection(null);
  expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
async function mount() {
  router = createMemoryRouter([{ path: "/", element: <ChatPanel initialConversation={null}>Home</ChatPanel> }]);
  await act(async () => { root = createRoot(container); root.render(<RouterProvider router={router} />); });
  const input = container.querySelector("input")!;
  Object.defineProperty(input, "files", { value: [new File(["%PDF-1.7"], "private-ABC123.pdf", { type: "application/pdf" })] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
}
function uploadResponses() {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ok: true, conversationId: "conversation" }))
    .mockResolvedValueOnce(Response.json({ ok: true, conversationId: "conversation", uploadId: "upload", mimeType: "application/pdf", sizeBytes: 8 }));
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
async function send() { await act(async () => { container.querySelector<HTMLButtonElement>(".send")!.click(); }); }
describe("attachment through the existing panel send controller", () => {
  it("mounts before sending and clears the file only after the message acknowledgement", async () => {
    const fetcher = uploadResponses(); api.send.mockResolvedValue({ ok: true, seq: 0, conversationId: "conversation" });
    await mount(); await send();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(api.send).toHaveBeenCalledWith("conversation", "Please read this attachment.", expect.any(String), expect.objectContaining({ uploadId: "upload", signal: expect.any(AbortSignal) }));
    expect(container.querySelector('[aria-label="Remove attachment"]')).toBeNull(); expect(api.subscribe).toHaveBeenCalled();
  });
  it("keeps the attachment on failure and retries the failed transcript message", async () => {
    const fetcher = uploadResponses(); api.send.mockResolvedValueOnce({ ok: false, error: "unavailable" }).mockResolvedValueOnce({ ok: true, seq: 0, conversationId: "conversation" });
    await mount(); await send();
    expect(container.querySelector('[aria-label="Remove attachment"]')).not.toBeNull(); expect(container.querySelector("textarea")?.value).toBe("");
    expect(container.textContent).toContain("Please read this attachment.");
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>(".chat-assistant-notice button")].find(button => button.textContent === "Retry")!.click());
    expect(fetcher).toHaveBeenCalledTimes(2); expect(api.send.mock.calls[1]![2]).not.toBe(api.send.mock.calls[0]![2]);
  });
  it("replaces Send with Stop for the turn in flight and aborts an in-flight upload on unmount", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ok: true, conversationId: "conversation" })).mockImplementationOnce((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      const abort = () => { init.signal?.removeEventListener("abort", abort); reject(new DOMException("Aborted", "AbortError")); };
      init.signal?.addEventListener("abort", abort, { once: true });
    }));
    vi.stubGlobal("fetch", fetcher); await mount(); await send();
    // A second send is structurally impossible rather than merely disabled: the
    // control in flight is Stop, so there is no Send to press twice.
    expect(container.querySelector(".send")).toBeNull();
    expect(container.querySelector(".stop")).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2); expect(api.send).not.toHaveBeenCalled();
    const signal = fetcher.mock.calls[1]![1].signal as AbortSignal;
    await act(async () => root!.unmount()); root = undefined; expect(signal.aborted).toBe(true);
  });
});
