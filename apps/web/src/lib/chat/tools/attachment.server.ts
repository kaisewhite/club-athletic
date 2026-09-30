import type { BetaToolResultContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ConversationScope } from "../repository.server";
import { withChatReadDatabase } from "../../db/chat-client.server";
import { UPLOAD_FILE_BYTES } from "../upload-policy";
export type AttachmentDependencies = {
  find(
    scope: ConversationScope,
    path: string,
  ): Promise<{
    mountedFileId: string;
    mimeType: string;
    sizeBytes: number;
  } | null>;
  download(fileId: string, signal: AbortSignal): Promise<Response>;
};
export async function findSubmittedAttachment(
  scope: ConversationScope,
  path: string,
) {
  // Match stored identity, not a caller-supplied provider ID. Neither traversal
  // nor arbitrary filesystem access is possible through this read-only query.
  if (!path.startsWith("/mnt/session/uploads/") || path.includes(".."))
    return null;
  return withChatReadDatabase(async (db) => {
    const row = await db.upload.findFirst({
      where: {
        conversationId: scope.conversationId,
        conversation: { tripId: scope.tripId },
        mountPath: { in: [path, path.slice("/mnt/session/uploads".length)] },
        status: "mounted",
        deletedFromAnthropicAt: null,
      },
    });
    if (
      !row?.mountedFileId ||
      row.uploadedAt.getTime() + 86400000 <= Date.now()
    )
      return null;
    const message = await db.message.findFirst({
      where: {
        conversationId: scope.conversationId,
        uploadId: row.id,
        role: "user",
      },
      select: { id: true },
    });
    return message
      ? {
          mountedFileId: row.mountedFileId,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
        }
      : null;
  });
}
export async function readTripAttachment(
  scope: ConversationScope,
  path: string,
  signal: AbortSignal,
  deps: AttachmentDependencies,
): Promise<BetaToolResultContentBlockParam[]> {
  signal.throwIfAborted();
  const row = await deps.find(scope, path);
  signal.throwIfAborted();
  if (
    !row ||
    row.sizeBytes > UPLOAD_FILE_BYTES ||
    !["image/webp", "application/pdf"].includes(row.mimeType)
  )
    throw new Error("Trip attachment unavailable.");
  const response = await deps.download(row.mountedFileId, signal);
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Trip attachment unavailable.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      length += part.value.length;
      if (length > UPLOAD_FILE_BYTES) {
        part.value.fill(0);
        throw new Error("Trip attachment unavailable.");
      }
      chunks.push(part.value);
    }
    const bytes = Buffer.concat(chunks);
    const data = bytes.toString("base64");
    bytes.fill(0);
    return row.mimeType === "application/pdf"
      ? [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data },
          },
        ]
      : [
          {
            type: "image",
            source: { type: "base64", media_type: "image/webp", data },
          },
        ];
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    for (const chunk of chunks) chunk.fill(0);
  }
}
