import { fileTypeFromBuffer } from "file-type";
import * as writes from "../db/chat-writes.server";
import { withChatReadDatabase } from "../db/chat-client.server";
import * as reads from "./repository.server";
import { createUploadProvider, type UploadProvider } from "../managed-agents/upload-client.server";
import { normaliseImage } from "./upload-image.server";
import { attachmentName, UPLOAD_ACCEPT, UPLOAD_ERRORS, UPLOAD_EXPIRY_MS, UPLOAD_FILE_BYTES, UPLOAD_REQUEST_BYTES, type UploadErrorCode, type UploadedAttachment } from "./upload-policy";

type UploadRow = Awaited<ReturnType<typeof writes.createUploadRecord>>;
type UploadWrites = Pick<typeof writes, "createUploadRecord" | "attachUploadResource" | "markUploadProcessed" | "markUploadCopyDeleted" | "createDraftConversation" | "attachAgentSession" | "updateConversationSessionState">;
export class UploadError extends Error {
  constructor(public code: UploadErrorCode, public status = 400) { super(UPLOAD_ERRORS[code]); }
}
export interface UploadDeps {
  writes: UploadWrites;
  provider: UploadProvider;
  loadState: typeof reads.loadConversationChatState;
  loadUpload: typeof reads.loadUpload;
  normalise: typeof normaliseImage;
  now: () => number;
  diagnostic: (stage: string) => void;
}
// Process-local exclusion only. The global sha256 constraint remains authoritative
// across processes; this service is deployed as one task, like the accepted limiter.
const locks = new Set<string>();
async function exclusive<T>(key: string, run: () => Promise<T>) {
  if (locks.has(key)) throw new UploadError("busy", 409);
  locks.add(key);
  try { return await run(); } finally { locks.delete(key); }
}
export const activeUploadCount = () => locks.size;
export function createUploadService(deps: UploadDeps) {
  const expired = (row: UploadRow) => deps.now() - row.uploadedAt.getTime() >= UPLOAD_EXPIRY_MS;
  const summary = (row: UploadRow): UploadedAttachment => ({ uploadId: row.id, conversationId: row.conversationId,
    filename: attachmentName(row.mimeType), mimeType: row.mimeType, sizeBytes: row.sizeBytes });

  async function cleanup(row: UploadRow, sessionId: string, signal: AbortSignal) {
    if (row.fileId && !row.sessionResourceId && !row.deletedFromAnthropicAt) {
      try {
        const resource = await deps.provider.findMount(sessionId, `/${row.id}.${row.mimeType === "application/pdf" ? "pdf" : "webp"}`, signal);
        if (resource) row = await deps.writes.attachUploadResource({ conversationId: row.conversationId, uploadId: row.id,
          fileId: row.fileId, mountedFileId: resource.file_id, sessionResourceId: resource.id, mountPath: resource.mount_path });
      } catch { deps.diagnostic("cleanup-discover-mount"); return false; }
    }
    // Retain identities on the row and retry only unconfirmed deletions. A resource
    // deletion is not evidence that either Files API copy was also deleted.
    const parts = [
      { copy: "resource" as const, id: row.sessionResourceId, at: row.sessionResourceDeletedAt },
      { copy: "mounted" as const, id: row.mountedFileId, at: row.mountedFileDeletedAt },
      { copy: "original" as const, id: row.fileId, at: row.originalFileDeletedAt },
    ];
    const removed = new Set<string>();
    let failed = false;
    for (const part of parts) {
      if (!part.id || part.at) continue;
      try {
        if (part.copy === "resource") await deps.provider.deleteResource(sessionId, part.id, signal);
        else if (!removed.has(part.id)) { await deps.provider.deleteFile(part.id, signal); removed.add(part.id); }
        await deps.writes.markUploadCopyDeleted({ conversationId: row.conversationId, uploadId: row.id, copy: part.copy, providerId: part.id });
      } catch { failed = true; deps.diagnostic(`cleanup-${part.copy}`); }
    }
    return !failed;
  }

  async function draft(tripId: string, requestId: string, signal: AbortSignal) {
    return exclusive(`draft:${tripId}:${requestId}`, async () => {
      signal.throwIfAborted();
      const row = await deps.writes.createDraftConversation({ tripId, requestId: `upload:${requestId}` });
      if (!row.agentSessionId) {
        // Empty session: no provider turn starts until the mounted attachment is sent.
        const sessionId = await deps.provider.draft(row.id, signal);
        await deps.writes.attachAgentSession({ conversationId: row.id, sessionId });
        await deps.writes.updateConversationSessionState({ conversationId: row.id, runtimeStatus: "waiting" });
      }
      return { conversationId: row.id };
    });
  }

  async function ingest(scope: reads.ConversationScope, file: File, signal: AbortSignal) {
    return exclusive(`upload:${scope.conversationId}`, async () => {
      let original: Uint8Array | undefined;
      let transmitted: Uint8Array | undefined;
      let row: UploadRow | undefined;
      let sessionId: string | undefined;
      let fileId: string | undefined;
      let mountAttempted = false;
      let resource: Awaited<ReturnType<UploadProvider["mount"]>> | undefined;
      try {
        signal.throwIfAborted();
        if (!file.size || file.size > UPLOAD_FILE_BYTES) throw new UploadError(file.size ? "size" : "invalid", file.size ? 413 : 415);
        const state = await deps.loadState(scope);
        if (!state?.agentSessionId || state.runtimeStatus === "closed") throw new UploadError("failed", 409);
        if (state.activeRequestId || ["starting", "active", "stopping"].includes(state.runtimeStatus ?? "")) throw new UploadError("busy", 409);
        sessionId = state.agentSessionId;
        original = new Uint8Array(await file.arrayBuffer());
        signal.throwIfAborted();
        let type;
        try { type = await fileTypeFromBuffer(original); } catch { throw new UploadError("invalid", 415); }
        if (!type || !(type.mime in UPLOAD_ACCEPT)) throw new UploadError("invalid", 415);
        const mimeType = type.mime === "application/pdf" ? type.mime : "image/webp";
        try { transmitted = type.mime === "application/pdf" ? original : await deps.normalise(original); }
        catch { throw new UploadError("invalid", 415); }
        signal.throwIfAborted();
        if (transmitted.byteLength > UPLOAD_FILE_BYTES) throw new UploadError("size", 413);
        try {
          row = await deps.writes.createUploadRecord({ conversationId: scope.conversationId, bytes: original,
            originalFilename: attachmentName(mimeType), mimeType, sizeBytes: transmitted.byteLength, purpose: "OTHER" });
        } catch (error) {
          if (error instanceof Error && error.message === UPLOAD_ERRORS.duplicate) throw new UploadError("duplicate", 409);
          throw error;
        }
        if (expired(row)) { await cleanup(row, sessionId, signal); throw new UploadError("expired", 410); }
        if (row.status === "mounted" && !row.deletedFromAnthropicAt) return summary(row);
        if (row.fileId || row.deletedFromAnthropicAt) {
          await cleanup(row, sessionId, signal);
          throw new UploadError("expired", 410);
        }
        signal.throwIfAborted();
        fileId = await deps.provider.upload(transmitted, attachmentName(mimeType), mimeType, signal);
        row = await deps.writes.attachUploadResource({ conversationId: scope.conversationId, uploadId: row.id, fileId });
        signal.throwIfAborted();
        // Docs root this path beneath /mnt/session/uploads. Never use a filename
        // supplied by the browser as a path or provider-visible label.
        mountAttempted = true;
        resource = await deps.provider.mount(sessionId, fileId, `/${row.id}.${mimeType === "application/pdf" ? "pdf" : "webp"}`, signal);
        row = await deps.writes.attachUploadResource({ conversationId: scope.conversationId, uploadId: row.id, fileId,
          mountedFileId: resource.file_id, sessionResourceId: resource.id, mountPath: resource.mount_path });
        signal.throwIfAborted();
        if (row.processedAt) await deps.writes.markUploadProcessed({ conversationId: scope.conversationId, uploadId: row.id, extractionResult: { uploadOutcome: "mounted" } });
        return summary(row);
      } catch (error) {
        if (row && fileId && sessionId) {
          // An independent, bounded cleanup lifetime survives a disconnected guest.
          await withUploadDeadline(undefined, 30_000, async cleanupSignal => {
            if (mountAttempted && !resource) {
              try {
                resource = await deps.provider.findMount(sessionId!, `/${row!.id}.${row!.mimeType === "application/pdf" ? "pdf" : "webp"}`, cleanupSignal) ?? undefined;
              } catch {
                // Ambiguous provider acceptance: retain the original identity so
                // later cleanup can discover the resource. Never claim deletion.
                deps.diagnostic("discover-mount"); return;
              }
            }
            const identities = { conversationId: scope.conversationId, uploadId: row!.id, fileId: fileId!,
              ...(resource ? { mountedFileId: resource.file_id, sessionResourceId: resource.id, mountPath: resource.mount_path } : {}) };
            try { row = await deps.writes.attachUploadResource(identities); }
            catch { deps.diagnostic("persist-cleanup-identities"); }
            // Compensate even if a DB failure prevented saving the latest IDs.
            await cleanup({ ...row!, ...identities, mountedFileId: resource?.file_id ?? row!.mountedFileId,
              sessionResourceId: resource?.id ?? row!.sessionResourceId }, sessionId!, cleanupSignal);
          });
        }
        if (row && !(error instanceof UploadError && ["expired", "busy"].includes(error.code))) {
          try { await deps.writes.markUploadProcessed({ conversationId: scope.conversationId, uploadId: row.id, extractionResult: { uploadOutcome: "failed" } }); }
          catch { deps.diagnostic("persist-upload-failure"); }
        }
        if (error instanceof UploadError) throw error;
        deps.diagnostic("ingest");
        throw new UploadError("failed", 503);
      } finally {
        // Encoded buffers are ours; Bun's decoded pixels stay inside its awaited
        // terminal. No temp files or decoded pixel buffers are retained by us.
        transmitted?.fill(0); original?.fill(0);
      }
    });
  }

  async function message(scope: reads.ConversationScope, text: string, uploadId?: string) {
    if (!uploadId) return { conversationId: scope.conversationId, text };
    const row = await deps.loadUpload(scope, uploadId);
    if (!row || row.status !== "mounted" || !row.fileId || !row.mountedFileId || !row.sessionResourceId || !row.mountPath || row.deletedFromAnthropicAt) throw new UploadError("failed", 409);
    if (expired(row)) throw new UploadError("expired", 410);
    // Reconstruct the generated path, rather than trusting a client or an opaque
    // provider return path. The stored returned mountPath remains diagnostic.
    const suffix = `\n\n[Attached file: /mnt/session/uploads/${row.id}.${row.mimeType === "application/pdf" ? "pdf" : "webp"}]`;
    if (text.length + suffix.length > 8192) throw new UploadError("invalid");
    return { conversationId: scope.conversationId, text: text + suffix, uploadId };
  }
  return { draft, ingest, cleanup, message };
}

export async function withUploadDeadline<T>(parent: AbortSignal | undefined, ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  const timer = setTimeout(abort, ms);
  try { controller.signal.throwIfAborted(); return await run(controller.signal); }
  finally { clearTimeout(timer); parent?.removeEventListener("abort", abort); controller.abort(); }
}

/** Bound the actual stream BEFORE FormData materializes parts, including chunked
 * bodies and dishonest Content-Length. No Express multipart middleware needed. */
export async function readUploadBody(request: Request, limit = UPLOAD_REQUEST_BYTES) {
  if (!request.body) throw new UploadError("invalid");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    request.signal.throwIfAborted();
    const declared = Number(request.headers.get("Content-Length"));
    if (declared > limit) throw new UploadError("body", 413);
    for (;;) {
      const part = await reader.read();
      request.signal.throwIfAborted();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { part.value.fill(0); throw new UploadError("body", 413); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    request.signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {}); reader.releaseLock();
    for (const chunk of chunks) chunk.fill(0);
  }
}

let service: ReturnType<typeof createUploadService> | undefined;
export function uploadService() {
  return service ??= createUploadService({ writes, provider: createUploadProvider(), loadState: reads.loadConversationChatState,
    loadUpload: reads.loadUpload, normalise: normaliseImage, now: Date.now,
    diagnostic: stage => console.error("Chat upload operation failed", { stage }) });
}
export const prepareAttachmentMessage = (scope: reads.ConversationScope, text: string, uploadId?: string) =>
  uploadId ? uploadService().message(scope, text, uploadId) : Promise.resolve({ conversationId: scope.conversationId, text, uploadId });

/** One bounded cleanup step, used by upload traffic and the owned server
 * maintenance lifecycle. The original Files object also has 24h provider expiry. */
export async function cleanupExpiredUploads(signal: AbortSignal) {
  const row = await withChatReadDatabase(db => db.upload.findFirst({
    where: { uploadedAt: { lte: new Date(Date.now() - UPLOAD_EXPIRY_MS) }, fileId: { not: null }, deletedFromAnthropicAt: null },
    include: { conversation: { select: { agentSessionId: true } } }, orderBy: { uploadedAt: "asc" },
  }));
  if (row?.conversation.agentSessionId) await uploadService().cleanup(row, row.conversation.agentSessionId, signal);
}
