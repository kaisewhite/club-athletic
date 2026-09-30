import { vi } from "vitest";
import { createChatWrites } from "../../../src/lib/db/chat-writes.server";
import type { ChatDatabase } from "../../../src/lib/db/chat-client.server";
import { createUploadService, type UploadDeps } from "../../../src/lib/chat/upload.server";

export const NOW = new Date("2026-09-26T12:00:00Z");
export const scope = { tripId: "trip", conversationId: "conversation" };
type Row = Record<string, unknown>;
export function uploadHarness() {
  const uploads: Row[] = [];
  const conversations: Row[] = [
    { id: "conversation", tripId: "trip", agentSessionId: "session", runtimeStatus: "waiting", activeRequestId: null },
    { id: "other", tripId: "trip", agentSessionId: "other-session", runtimeStatus: "waiting", activeRequestId: null },
  ];
  const match = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => row[key] === value);
  function table(rows: Row[], defaults: Row = {}) {
    return {
      findFirst: vi.fn(async ({ where }: { where: Row }) => rows.find(row => match(row, where)) ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => { const row = { ...defaults, ...data }; rows.push(row); return { ...row }; }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = rows.find(row => match(row, where)); if (!row) throw new Error("missing fixture"); Object.assign(row, data); return { ...row };
      }),
    };
  }
  const tx = {
    conversation: table(conversations, { agentSessionId: null }),
    upload: table(uploads, { uploadedAt: NOW, fileId: null, mountedFileId: null, sessionResourceId: null, mountPath: null,
      originalFileDeletedAt: null, mountedFileDeletedAt: null, sessionResourceDeletedAt: null, deletedFromAnthropicAt: null,
      processedAt: null, extractionResult: null }),
    $queryRaw: vi.fn(async () => []),
  };
  const database = { ...tx, $transaction: async <T>(run: (value: typeof tx) => Promise<T>) => {
    const before = structuredClone({ uploads, conversations });
    try { return await run(tx); } catch (error) {
      uploads.splice(0, uploads.length, ...before.uploads); conversations.splice(0, conversations.length, ...before.conversations); throw error;
    }
  } };
  // Structural fake only at the database capability seam; all bookkeeping is real.
  const writes = createChatWrites(database as unknown as ChatDatabase, () => NOW);
  const provider = {
    draft: vi.fn(async () => "new-session"),
    upload: vi.fn(async (_bytes: Uint8Array, _filename: string, _mime: string, _signal: AbortSignal) => "original-file"),
    mount: vi.fn(async (_session: string, _file: string, path: string, _signal: AbortSignal) => ({ id: "resource-id", file_id: "mounted-file", mount_path: path })),
    findMount: vi.fn(async (_session: string, _path: string, _signal: AbortSignal): Promise<{ id: string; file_id: string; mount_path: string } | null> => null),
    deleteFile: vi.fn(async (_id: string, _signal: AbortSignal) => {}),
    deleteResource: vi.fn(async (_session: string, _id: string, _signal: AbortSignal) => {}),
  };
  const deps: UploadDeps = { writes, provider,
    loadState: async s => conversations.find(row => row.id === s.conversationId && row.tripId === s.tripId) as Awaited<ReturnType<UploadDeps["loadState"]>>,
    loadUpload: async (s, id) => uploads.find(row => row.id === id && row.conversationId === s.conversationId) as Awaited<ReturnType<UploadDeps["loadUpload"]>>,
    normalise: vi.fn(async () => new Uint8Array([1, 2, 3])), now: () => NOW.getTime(), diagnostic: vi.fn() };
  const service = createUploadService(deps);
  return { service, deps, provider, uploads, conversations, tx, writes };
}
export const pdfBytes = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
export const pdf = (name = "secret-PNR-ABC123.pdf", type = "application/pdf") => new File([pdfBytes], name, { type });
