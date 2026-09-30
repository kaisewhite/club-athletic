import { useEffect, useRef, useState } from "react";
import { UPLOAD_ERRORS, type UploadedAttachment, type UploadErrorCode } from "@/lib/chat/upload-policy";

export class AttachmentRequestError extends Error {}
async function requestUpload(body: BodyInit, signal: AbortSignal, headers?: HeadersInit): Promise<Record<string, unknown>> {
  const response = await fetch("/api/chat/uploads", { method: "POST", body, signal, headers });
  const data: unknown = await response.json();
  signal.throwIfAborted();
  if (!response.ok || !data || typeof data !== "object" || !("ok" in data) || data.ok !== true) {
    const code = data && typeof data === "object" && "code" in data && typeof data.code === "string" && Object.hasOwn(UPLOAD_ERRORS, data.code) ? data.code as UploadErrorCode : "failed";
    throw new AttachmentRequestError(UPLOAD_ERRORS[code]);
  }
  return data as Record<string, unknown>;
}
export function useChatAttachment() {
  const [file, setFile] = useState<File | null>(null);
  const saved = useRef<{ file: File; result: UploadedAttachment } | null>(null);
  const draft = useRef<{ key: string; conversationId?: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; saved.current = null; draft.current = null; }; }, []);
  function select(next: File | null) { saved.current = null; setFile(next); }
  async function prepare(conversationId: string | null, signal: AbortSignal) {
    if (!file) return null;
    if (saved.current?.file === file && (!conversationId || saved.current.result.conversationId === conversationId)) return saved.current.result;
    draft.current ??= { key: crypto.randomUUID() };
    let id = conversationId ?? draft.current.conversationId;
    if (!id) {
      const result = await requestUpload(JSON.stringify({ draft: true }), signal, { "Content-Type": "application/json", "Idempotency-Key": draft.current.key });
      if (typeof result.conversationId !== "string" || !/^[a-z0-9]+$/.test(result.conversationId)) throw new AttachmentRequestError(UPLOAD_ERRORS.failed);
      id = result.conversationId;
      if (!alive.current || signal.aborted) throw new AttachmentRequestError(UPLOAD_ERRORS.failed);
      draft.current.conversationId = id;
    }
    const form = new FormData(); form.set("conversationId", id); form.set("file", file);
    const result = await requestUpload(form, signal);
    if (result.conversationId !== id || typeof result.uploadId !== "string" || typeof result.mimeType !== "string" || typeof result.sizeBytes !== "number") throw new AttachmentRequestError(UPLOAD_ERRORS.failed);
    const uploaded: UploadedAttachment = { conversationId: id, uploadId: result.uploadId,
      filename: result.mimeType === "application/pdf" ? "attachment.pdf" : "attachment.webp", mimeType: result.mimeType, sizeBytes: result.sizeBytes };
    if (!alive.current || signal.aborted) throw new AttachmentRequestError(UPLOAD_ERRORS.failed);
    saved.current = { file, result: uploaded };
    return uploaded;
  }
  return { file, select, prepare };
}
