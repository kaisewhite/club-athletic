import { readManifests, type MemorySeed } from "./validate.ts";

const apiBase = "https://api.anthropic.com/v1";
const memoryBeta = "agent-memory-2026-07-22";

type MemoryRow = { id: string; path: string; content_sha256: string };
type Request = (path: string, method?: string, body?: unknown) => Promise<Record<string, unknown>>;

const sha256 = (content: string) => new Bun.CryptoHasher("sha256").update(content).digest("hex");

function memoryStoreId(value: string): string {
  if (!/^memstore_[A-Za-z0-9_]+$/.test(value)) throw new Error("CLAUDE_TRIP_MEMORY_STORE_ID has an invalid format.");
  return value;
}

function apiRequest(apiKey: string): Request {
  return async (path, method = "GET", body) => {
    const init: RequestInit = {
      method,
      headers: {
        "anthropic-version": "2023-06-01",
        "anthropic-beta": memoryBeta,
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await fetch(`${apiBase}${path}`, init);
    if (!response.ok) throw new Error(`Anthropic memory API request failed (${response.status}) for ${method} ${path}.`);
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Anthropic memory API returned an invalid response.");
    return parsed as Record<string, unknown>;
  };
}

async function listMemories(id: string, request: Request): Promise<MemoryRow[]> {
  const response = await request(`/memory_stores/${id}/memories?limit=1000`);
  const rows = response.data;
  if (!Array.isArray(rows) || rows.length > 1000 || response.has_more === true) {
    throw new Error("Memory listing was incomplete; refusing to reconcile.");
  }
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Memory listing contained an invalid row.");
    const value = row as Record<string, unknown>;
    if (typeof value.id !== "string" || typeof value.path !== "string" || typeof value.content_sha256 !== "string") {
      throw new Error("Memory listing was missing required fields.");
    }
    return { id: value.id, path: value.path, content_sha256: value.content_sha256 };
  });
}

export async function reconcileMemoryStore(id: string, manifest: string, seeds: MemorySeed[], request: Request) {
  const store = await request(`/memory_stores/${id}`);
  if (store.id !== id || store.name !== "club-athletic-meribel-2027-facts" || store.archived_at) {
    throw new Error("Configured trip memory store is not the expected active store.");
  }
  await request(`/memory_stores/${id}`, "POST", JSON.parse(manifest));
  const current = new Map((await listMemories(id, request)).map((row) => [row.path, row]));
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const seed of seeds) {
    const existing = current.get(seed.path);
    if (!existing) {
      await request(`/memory_stores/${id}/memories`, "POST", { path: seed.path, content: seed.content });
      created += 1;
    } else if (existing.content_sha256 === sha256(seed.content)) {
      unchanged += 1;
    } else {
      await request(`/memory_stores/${id}/memories/${existing.id}`, "POST", {
        content: seed.content,
        precondition: { type: "content_sha256", content_sha256: existing.content_sha256 },
      });
      updated += 1;
    }
  }
  const owned = new Set(seeds.map((seed) => seed.path));
  const extra = [...current.keys()].filter((path) => !owned.has(path)).sort();
  return { created, updated, unchanged, extra };
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required for memory sync.");
  const id = memoryStoreId(process.env.CLAUDE_TRIP_MEMORY_STORE_ID?.trim() || "");
  const root = `${import.meta.dir}/..`;
  const manifests = await readManifests(root);
  const result = await reconcileMemoryStore(id, manifests.memoryStore, manifests.memorySeeds, apiRequest(apiKey));
  if (result.extra.length) console.warn(`Memory sync left ${result.extra.length} unowned memory path(s) untouched.`);
  console.log(`Trip memory synced: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged.`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Trip memory sync failed.");
    process.exitCode = 1;
  });
}
