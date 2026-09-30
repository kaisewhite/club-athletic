import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { agentName, environmentName, memoryStoreName, readManifests, type MemorySeed } from "./validate.ts";

type Resource = "agents" | "environments";
export type Call = (args: string[], body?: string) => Promise<unknown>;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid provider response.");
  if ("error" in value || ("type" in value && value.type === "error")) throw new Error("Provider returned an error response.");
  // The object boundary is checked above; fields remain unknown and are checked before use.
  return value as Record<string, unknown>;
}

function resourceId(resource: Resource, value: unknown): string {
  const prefix = resource === "agents" ? "agent_" : "env_";
  if (typeof value !== "string" || !value.startsWith(prefix) || value.length <= prefix.length || !/^[a-zA-Z0-9_]+$/.test(value)) {
    throw new Error("Invalid resource identifier; refusing to apply.");
  }
  return value;
}

function checkExisting(resource: Resource, value: unknown, id: string) {
  const row = object(value);
  if (row.id !== id || row.name !== (resource === "agents" ? agentName : environmentName) || row.archived_at) {
    throw new Error("Resource is archived or does not match this app; refusing to apply.");
  }
  if (resource === "agents" && row.multiagent != null) throw new Error("Coordinator agents are forbidden.");
  if (resource === "agents" && (!Number.isSafeInteger(row.version) || Number(row.version) < 1)) {
    throw new Error("Agent version is missing; refusing an unconditional update.");
  }
  return row;
}

// Exported for offline tests. No provider calls, env loading, or state writes on import.
export async function deployResource(
  resource: Resource, body: string, savedId: string | undefined, allowCreate: boolean,
  call: Call, save: (id: string) => Promise<void>,
): Promise<void> {
  const idFlag = resource === "agents" ? "--agent-id" : "--environment-id";
  let id = savedId ? resourceId(resource, savedId) : undefined;
  if (!id) {
    // A failed or truncated lookup is never interpreted as absence.
    const listing = await call([`beta:${resource}`, "list", "--format", "jsonl", "--max-items", "1001"]);
    if (!Array.isArray(listing) || listing.length > 1000) throw new Error("Resource lookup incomplete; configure an explicit ID.");
    const name = resource === "agents" ? agentName : environmentName;
    const rows = listing.map(object);
    for (const row of rows) {
      resourceId(resource, row.id);
      if (typeof row.name !== "string") throw new Error("Incomplete resource listing; refusing to create.");
    }
    const matches = rows.filter(row => row.name === name && !row.archived_at);
    if (matches.length > 1) throw new Error("Multiple resources have this name; configure the canonical ID.");
    if (matches[0]) id = resourceId(resource, matches[0].id);
    else {
      if (!allowCreate) throw new Error("No existing resource found. Initial creation requires --apply --create.");
      const created = object(await call([`beta:${resource}`, "create", "--format", "json"], body));
      const createdId = resourceId(resource, created.id);
      // Preserve the identifier even if the remaining response is unexpected.
      await save(createdId);
      checkExisting(resource, created, createdId);
      return;
    }
  }
  const current = checkExisting(resource,
    await call([`beta:${resource}`, "retrieve", idFlag, id, "--format", "json"]), id);
  const args = [`beta:${resource}`, "update", idFlag, id, "--format", "json"];
  if (resource === "agents") args.push("--version", String(current.version));
  const updated = checkExisting(resource, await call(args, body), id);
  // A byte-identical body is a no-op: the provider returns the SAME version and
  // mints no new one, which is what makes re-deploying safe. Only a version that
  // moved BACKWARDS is suspect, because that is not the resource we just read.
  if (resource === "agents" && Number(updated.version) < Number(current.version)) {
    throw new Error("Agent update returned an older version; refusing to treat it as applied.");
  }
  await save(id);
}

function memoryStoreId(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("memstore_") || value.length <= "memstore_".length ||
      !/^[a-zA-Z0-9_]+$/.test(value)) {
    throw new Error("Invalid memory store identifier; refusing to apply.");
  }
  return value;
}

function checkStore(value: unknown, id: string) {
  const row = object(value);
  if (row.id !== id || row.name !== memoryStoreName || row.archived_at) {
    throw new Error("Memory store is archived or does not match this app; refusing to apply.");
  }
  return row;
}

const sha256 = (content: string) => new Bun.CryptoHasher("sha256").update(content).digest("hex");

/** Seeds are the source of truth for the paths they own. Paths this app does not own are
 * reported, never deleted: pruning another writer's memory is not this script's business. */
async function reconcileMemories(id: string, seeds: MemorySeed[], call: Call) {
  const listing = await call(["beta:memory-stores:memories", "list", "--memory-store-id", id, "--format", "jsonl", "--max-items", "1001"]);
  if (!Array.isArray(listing) || listing.length > 1000) throw new Error("Memory listing incomplete; refusing to reconcile.");
  const current = new Map<string, { id: string; sha: string }>();
  for (const entry of listing.map(object)) {
    if (entry.type === "memory_prefix") continue;
    if (typeof entry.path !== "string" || typeof entry.id !== "string" || typeof entry.content_sha256 !== "string") {
      throw new Error("Incomplete memory listing; refusing to reconcile.");
    }
    current.set(entry.path, { id: entry.id, sha: entry.content_sha256 });
  }
  let created = 0, updated = 0, unchanged = 0;
  for (const seed of seeds) {
    const existing = current.get(seed.path);
    if (!existing) {
      object(await call(["beta:memory-stores:memories", "create", "--memory-store-id", id, "--format", "json"],
        JSON.stringify({ path: seed.path, content: seed.content })));
      created += 1;
      continue;
    }
    if (existing.sha === sha256(seed.content)) { unchanged += 1; continue; }
    // Optimistic concurrency: a memory that moved since the listing is not overwritten blindly.
    object(await call(["beta:memory-stores:memories", "update", "--memory-store-id", id, "--memory-id", existing.id, "--format", "json"],
      JSON.stringify({ content: seed.content, precondition: { type: "content_sha256", content_sha256: existing.sha } })));
    updated += 1;
  }
  const owned = new Set(seeds.map(seed => seed.path));
  const extra = [...current.keys()].filter(path => !owned.has(path)).sort();
  return { created, updated, unchanged, extra };
}

// Exported for offline tests. No provider calls, env loading, or state writes on import.
export async function deployMemoryStore(
  body: string, seeds: MemorySeed[], savedId: string | undefined, allowCreate: boolean,
  call: Call, save: (id: string) => Promise<void>,
) {
  let id = savedId ? memoryStoreId(savedId) : undefined;
  if (!id) {
    // A failed or truncated lookup is never interpreted as absence.
    const listing = await call(["beta:memory-stores", "list", "--format", "jsonl", "--max-items", "1001"]);
    if (!Array.isArray(listing) || listing.length > 1000) throw new Error("Memory store lookup incomplete; configure an explicit ID.");
    const rows = listing.map(object);
    for (const row of rows) {
      memoryStoreId(row.id);
      if (typeof row.name !== "string") throw new Error("Incomplete memory store listing; refusing to create.");
    }
    // Names are not unique in a workspace, so an ambiguous name is a stop, never a guess.
    const matches = rows.filter(row => row.name === memoryStoreName && !row.archived_at);
    if (matches.length > 1) throw new Error("Multiple memory stores have this name; configure the canonical ID.");
    if (matches[0]) id = memoryStoreId(matches[0].id);
    else {
      if (!allowCreate) throw new Error("No existing memory store found. Initial creation requires --apply --create.");
      const createdStore = object(await call(["beta:memory-stores", "create", "--format", "json"], body));
      const createdId = memoryStoreId(createdStore.id);
      // Preserve the identifier even if the remaining response is unexpected.
      await save(createdId);
      checkStore(createdStore, createdId);
      return { id: createdId, ...(await reconcileMemories(createdId, seeds, call)) };
    }
  }
  checkStore(await call(["beta:memory-stores", "retrieve", "--memory-store-id", id, "--format", "json"]), id);
  // Name and description are the only mutable store fields; re-sending them is a no-op.
  checkStore(await call(["beta:memory-stores", "update", "--memory-store-id", id, "--format", "json"], body), id);
  await save(id);
  return { id, ...(await reconcileMemories(id, seeds, call)) };
}

export const callAnt: Call = async (args, body) => {
  // Synchronous, bounded child: no detached CLI, stream, retry loop, or orphan timer.
  // Never forward provider stderr or response bodies (they may include sensitive input).
  const result = Bun.spawnSync(["ant", ...args], {
    stdin: body === undefined ? "ignore" : new TextEncoder().encode(body),
    stdout: "pipe", stderr: "pipe", timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
  });
  if (result.exitCode !== 0 || result.signalCode) throw new Error("Anthropic CLI failed or timed out; no replacement attempted.");
  const output = result.stdout.toString().trim();
  try {
    if (args.includes("jsonl")) return output ? output.split("\n").map(line => JSON.parse(line)) : [];
    return JSON.parse(output);
  } catch {
    throw new Error("Anthropic CLI did not return the expected JSON; refusing to continue.");
  }
};

async function savedResource(root: string, key: string, envKeys: string[]) {
  // The first key that is set wins; extra keys are accepted so a rename of the
  // consuming app's variable does not strand this app on the old name.
  const configured = envKeys.map(envKey => process.env[envKey]?.trim()).find(value => value) || undefined;
  let cached: string | undefined;
  try { cached = (await readFile(`${root}/scripts/.state/${key}.id`, "utf8")).trim(); }
  catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  if (configured && cached && configured !== cached) throw new Error("Configured ID conflicts with saved state; reconcile before applying.");
  return configured ?? cached;
}

export async function main(args: string[], root = `${import.meta.dir}/..`) {
  const [scope = "all", ...flags] = args;
  if (!["all", "agents"].includes(scope) || flags.some(flag => !["--apply", "--create", "--dry-run"].includes(flag)) ||
      (flags.includes("--apply") && flags.includes("--dry-run")) ||
      (flags.includes("--create") && !flags.includes("--apply"))) {
    throw new Error("Usage: deploy.sh [--dry-run | --apply [--create]]");
  }
  const manifests = await readManifests(root);
  if (!flags.includes("--apply")) {
    console.log(`Dry run: validated ${scope === "all" ? "environment, memory store and dedicated trip agent" : "dedicated trip agent"}.`);
    console.log(`Memory seeds ready: ${manifests.memorySeeds.length} stable-fact files; no live counts are seeded.`);
    console.log("No API calls or state writes. Apply explicitly with --apply; first creation also requires --create.");
    return;
  }
  // Authentication is supplied by the operator's environment or ant's profile.
  // This program never sources .env or reads database/vault credentials.
  const saver = (key: string, label: string) => async (id: string) => {
    const state = `${root}/scripts/.state`;
    await mkdir(state, { recursive: true, mode: 0o700 });
    const path = `${state}/${key}.id`;
    try {
      // No trailing newline, matching the reference project's state cache format.
      await writeFile(`${path}.tmp`, id, { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    } finally { await rm(`${path}.tmp`, { force: true }); }
    // Resource identifiers are not secrets; the consuming app needs them.
    console.log(`${label} ID: ${id}`);
  };
  const deploy = async (resource: Resource, body: string, key: string, envKeys: string[]) => {
    const label = resource === "agents" ? "AGENT" : "ENVIRONMENT";
    const saved = await savedResource(root, key, envKeys);
    await deployResource(resource, body, saved, flags.includes("--create"), callAnt, saver(key, label));
    console.log(`  ${label.toLowerCase()} saved to scripts/.state/${key}.id; map it to ${envKeys[0]}.`);
  };
  if (scope === "all") {
    await deploy("environments", manifests.environment, "environment", ["CLAUDE_MANAGED_ENVIRONMENT_ID"]);
    const key = "trip-memory";
    const envKeys = ["CLAUDE_TRIP_MEMORY_STORE_ID"];
    const result = await deployMemoryStore(manifests.memoryStore, manifests.memorySeeds,
      await savedResource(root, key, envKeys), flags.includes("--create"), callAnt, saver(key, "MEMORY STORE"));
    console.log(`  memory store saved to scripts/.state/${key}.id; map it to ${envKeys[0]}.`);
    console.log(`  seeds: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged.`);
    if (result.extra.length) {
      console.log(`  WARNING: ${result.extra.length} memory path(s) this app does not own are still in the store and were NOT deleted:`);
      for (const path of result.extra) console.log(`    ${path}`);
      console.log("  Stale facts mislead the agent. Remove them by hand with ant beta:memory-stores:memories delete.");
    }
  }
  await deploy("agents", manifests.agent, "trip-concierge", ["CLAUDE_TRIP_AGENT_ID", "CLAUDE_ADVISOR_AGENT_ID"]);
}

if (import.meta.main) {
  try { await main(process.argv.slice(2)); }
  catch {
    console.error("Deployment stopped. Check local configuration, authentication, resource identity and version before retrying. No automatic replacement.");
    process.exitCode = 1;
  }
}
