import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatAttachment, AttachmentLabel } from "../../app/components/chat/chat-attachment";
import { ChatComposer } from "../../app/components/chat/chat-composer";
import { useChatAttachment } from "../../app/lib/chat/use-chat-attachment";
import { initialChatUiState } from "../../src/lib/chat/chat-state";
import { UPLOAD_FILE_BYTES } from "../../src/lib/chat/upload-policy";

let root: Root | undefined;
let container: HTMLDivElement;
const revoke = vi.fn(); const createURL = vi.fn(() => "blob:preview");
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: createURL, revokeObjectURL: revoke }));
  vi.clearAllMocks(); container = document.createElement("div"); document.body.append(container);
});
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function mount(element: React.ReactNode) { await act(async () => { root = createRoot(container); root.render(element); }); }
const image = () => new File(["image-fixture"], "Jane-Doe-ABC123.png", { type: "image/png" });
const pdf = () => new File(["%PDF-1.7"], "secret-ABC123.pdf", { type: "application/pdf" });
function Picker({ disabled = false }: { disabled?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  return <ChatAttachment file={file} disabled={disabled} onChange={setFile}>{control => <>{control}<textarea aria-label="Message" /></>}</ChatAttachment>;
}
async function select(files: File[], mode: "change" | "drop" | "paste" = "change") {
  const event = new Event(mode, { bubbles: true, cancelable: true });
  const data = { files, items: files.map(file => ({ kind: "file", type: file.type, getAsFile: () => file })), types: ["Files"] };
  if (mode === "change") Object.defineProperty(container.querySelector("input"), "files", { value: files, configurable: true });
  else Object.defineProperty(event, mode === "paste" ? "clipboardData" : "dataTransfer", { value: data });
  await act(async () => { (mode === "change" ? container.querySelector("input")! : mode === "paste" ? container.querySelector("textarea")! : container.querySelector(".chat-attachment-area")!).dispatchEvent(event); });
}

describe("composer attachments", () => {
  it.each(["change", "drop", "paste"] as const)("uses one validation path for %s and offers a clear remove button", async mode => {
    await mount(<Picker />); await select([image()], mode);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:preview");
    expect(container.textContent).not.toMatch(/Jane|ABC123/);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove attachment"]')!.click());
    expect(container.querySelector("img")).toBeNull(); expect(revoke).toHaveBeenCalledWith("blob:preview");
  });
  it("shows a safe PDF label without a broken thumbnail", async () => {
    await mount(<Picker />); await select([pdf()]);
    expect(container.textContent).toContain("attachment.pdf"); expect(container.querySelector("img")).toBeNull(); expect(createURL).not.toHaveBeenCalled();
  });
  it("revokes the previous preview on replacement and unmount", async () => {
    await mount(<Picker />); await select([image()]); await select([pdf()]); expect(revoke).toHaveBeenCalledTimes(1);
    await select([image()]); await act(async () => root!.unmount()); root = undefined;
    expect(revoke).toHaveBeenCalledTimes(2);
  });
  it.each(["multiple", "oversize", "unsupported"])("rejects %s input", async kind => {
    await mount(<Picker />);
    const files = kind === "multiple" ? [image(), pdf()] : kind === "oversize" ? [new File([new Uint8Array(UPLOAD_FILE_BYTES + 1)], "big.png", { type: "image/png" })] : [new File(["bad"], "run.exe", { type: "application/octet-stream" })];
    await select(files, "paste"); expect(container.querySelector('[role="alert"]')).not.toBeNull(); expect(container.querySelector('[aria-label="Remove attachment"]')).toBeNull();
  });
  it("preserves plain-text paste and gates selection while single-flight is busy", async () => {
    await mount(<Picker disabled />);
    expect(container.querySelector('[aria-label="Attach an image or PDF"]')?.hasAttribute("disabled")).toBe(true);
    await select([image()], "paste"); expect(container.querySelector("img")).toBeNull();
    const event = new Event("paste", { bubbles: true, cancelable: true }); Object.defineProperty(event, "clipboardData", { value: { files: [], items: [], types: ["text/plain"] } });
    container.querySelector("textarea")!.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
  });
  it("permits an attachment-only message but gates send, Enter and removal while busy", async () => {
    const send = vi.fn(); const capability = { canSend: true, reason: null, runtimeStatus: "waiting", pendingWakeupAt: null, activeTurn: false, waitingOnApproval: false } as const;
    const render = (busy: boolean) => <ChatComposer capability={capability} state={initialChatUiState()} busy={busy} attachment={pdf()} onAttachmentChange={vi.fn()} onDraftChange={vi.fn()} onSend={send} />;
    await mount(render(false)); expect(container.querySelector(".send")?.hasAttribute("disabled")).toBe(false);
    await act(async () => { root!.render(render(true)); });
    await act(async () => { container.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(send).not.toHaveBeenCalled(); expect(container.querySelector('[aria-label="Remove attachment"]')?.hasAttribute("disabled")).toBe(true);
  });
  it("retains a safe transcript label after provider deletion without a remote thumbnail", async () => {
    await mount(<AttachmentLabel value={{ mimeType: "image/webp", filename: "ABC123-secret.webp", fileId: "provider" }} />);
    expect(container.textContent).toBe("attachment.webp"); expect(container.querySelector("img")).toBeNull();
  });
});

describe("attachment draft/upload transport", () => {
  let current!: ReturnType<typeof useChatAttachment>;
  function Surface() { current = useChatAttachment(); return <span>{current.file ? "selected" : "empty"}</span>; }
  const success = (body: object) => new Response(JSON.stringify({ ok: true, ...body }), { headers: { "Content-Type": "application/json" } });
  const uploaded = { conversationId: "conversation", uploadId: "upload", mimeType: "application/pdf", sizeBytes: 8 };
  it("creates the draft first, uploads once, preserves selection on failed send, and reuses mounted upload on retry", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(success({ conversationId: "conversation" })).mockResolvedValueOnce(success(uploaded)); vi.stubGlobal("fetch", fetcher);
    await mount(<Surface />); await act(async () => current.select(pdf())); const abort = new AbortController();
    let result: Awaited<ReturnType<typeof current.prepare>>;
    await act(async () => { result = await current.prepare(null, abort.signal); });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ draft: true });
    expect(fetcher.mock.calls[1]![1].body.get("conversationId")).toBe("conversation");
    expect(container.textContent).toBe("selected");
    await act(async () => { expect(await current.prepare(null, abort.signal)).toEqual(result); }); expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => current.select(null)); expect(container.textContent).toBe("empty"); abort.abort();
  });
  it("keeps file and draft ID on upload failure and never shows raw server details", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(success({ conversationId: "conversation" })).mockResolvedValueOnce(new Response(JSON.stringify({ code: "failed", error: "sk-secret ABC123" }), { status: 503 })).mockResolvedValueOnce(success(uploaded)); vi.stubGlobal("fetch", fetcher);
    await mount(<Surface />); await act(async () => current.select(pdf())); const abort = new AbortController();
    await expect(current.prepare(null, abort.signal)).rejects.toThrow("could not be uploaded"); expect(container.textContent).toBe("selected");
    await current.prepare(null, abort.signal); expect(fetcher).toHaveBeenCalledTimes(3); expect(fetcher.mock.calls[2]![1].body).toBeInstanceOf(FormData); abort.abort();
  });
  it("does not start upload or publish a late draft response after owner abort/unmount", async () => {
    let resolve!: (value: Response) => void; const fetcher = vi.fn(() => new Promise<Response>(next => { resolve = next; })); vi.stubGlobal("fetch", fetcher);
    await mount(<Surface />); await act(async () => current.select(pdf())); const abort = new AbortController();
    const preparing = current.prepare(null, abort.signal); const rejected = expect(preparing).rejects.toThrow();
    abort.abort(); await act(async () => root!.unmount()); root = undefined;
    resolve(success({ conversationId: "conversation" })); await rejected; expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
