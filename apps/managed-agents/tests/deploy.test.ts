import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callAnt, deployMemoryStore, deployResource, main, type Call } from "../scripts/deploy.ts";
import { agentName, environmentName, memoryStoreName, readManifests, readMemorySeeds, validateAgent, validateEnvironment, validateMemoryStore } from "../scripts/validate.ts";

const root = `${import.meta.dir}/..`;
const manifests = await readManifests(root);
const agent = Bun.YAML.parse(manifests.agent);
const environment = Bun.YAML.parse(manifests.environment);
const existing = { id: "agent_fixture", name: agentName, version: 3, archived_at: null };
const store = { id: "memstore_fixture", name: memoryStoreName, archived_at: null };
const sha = (content: string) => new Bun.CryptoHasher("sha256").update(content).digest("hex");

function provider(...responses: unknown[]) {
  const calls: { args: string[]; body?: string }[] = [];
  const saved: string[] = [];
  const call: Call = async (args, body) => {
    calls.push({ args, body });
    if (!responses.length) throw new Error("Unexpected provider call in offline test.");
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  };
  return { call, calls, saved, save: async (id: string) => { saved.push(id); } };
}

describe("persisted configuration", () => {
  test("accepts dedicated baseline and restricted environment", () => {
    expect(() => validateAgent(agent)).not.toThrow();
    expect(() => validateEnvironment(environment)).not.toThrow();
  });
  test("prompt remains byte-identical to the approved web prompt snapshot", () => {
    // Snapshot of TRIP_AGENT_INSTRUCTIONS; no import/runtime dependency on apps/web. The web
    // side pins the same digest, so the two copies cannot drift apart unnoticed.
    expect(new Bun.CryptoHasher("sha256").update((agent as { system: string }).system).digest("hex"))
      .toBe("e0c866029516662370abdd33429d55487cf7f0038824ce01d864f8d4385f6ee3");
  });
  test("the prompt makes answering the reflex and the fallback the last resort", () => {
    const system = (agent as { system: string }).system;
    expect(system).toContain("The fallback line is the last resort, not the reflex.");
    expect(system).toContain("Reaching for that line when a tool could have answered it is a failure.");
    // Social turns must stay conversational and must not fake a citation.
    expect(system).toContain("must not carry a Source: line");
    expect(system).toContain("Live facts are never answered from memory.");
    expect(system).toContain("If a tool result disagrees with memory, the tool wins");
  });
  test("rejects coordinator, generic toolset, copied custom tools and skills", () => {
    for (const addition of [
      "multiagent: { type: coordinator, agents: [someone] }",
      "tools: [{ type: agent_toolset_20260401 }]",
      "tools: [{ type: custom, name: recordFlight }]",
      "skills: [{ type: custom, skill_id: fixture }]",
      "mcp_servers: [{ type: url, name: sql, url: https://example.invalid }]",
    ]) {
      const base = JSON.parse(JSON.stringify(agent));
      Object.assign(base, Bun.YAML.parse(addition));
      expect(() => validateAgent(base)).toThrow();
    }
  });
  test("rejects unrestricted environment and incorrectly nested allow flags", () => {
    expect(() => validateEnvironment({ name: environmentName, config: { type: "cloud", networking: { type: "unrestricted" } } })).toThrow();
    expect(() => validateEnvironment({ name: environmentName, config: { type: "cloud", allow_package_managers: false, networking: { type: "limited" } } })).toThrow();
  });
  test("refuses loss of the exact fallback and intake safeguards", () => {
    for (const phrase of ["That's not in the trip notes yet — ask the organizer.", "not a token limit", "Never guess a name or timezone", "exact read-back version"]) {
      expect(() => validateAgent(Bun.YAML.parse(manifests.agent.replace(phrase, "removed")))).toThrow();
    }
  });
  test("refuses loss of the new answer-first and live-data rules", () => {
    for (const phrase of [
      "The fallback line is the last resort, not the reflex",
      "Reaching for that line when a tool could have answered it is a failure",
      "Live facts are never answered from memory",
      "If a tool result disagrees with memory, the tool wins",
      "must not carry a Source: line",
      "No markdown",
    ]) {
      expect(() => validateAgent(Bun.YAML.parse(manifests.agent.replace(phrase, "removed")))).toThrow();
    }
  });
  test("memory store manifest names the store and warns the model off stale live data", () => {
    const body = JSON.parse(manifests.memoryStore);
    expect(() => validateMemoryStore(body)).not.toThrow();
    expect(body.name).toBe(memoryStoreName);
    for (const phrase of ["never a substitute for live data", "getOpenSpots", "getFlightTable", "the tool wins", "deliberately absent"]) {
      expect(() => validateMemoryStore({ ...body, description: body.description.replace(phrase, "removed") })).toThrow();
    }
    expect(() => validateMemoryStore({ ...body, name: "something-else" })).toThrow();
    expect(() => validateMemoryStore({ ...body, metadata: {} })).toThrow();
    expect(() => validateMemoryStore({ ...body, description: `${body.description} api_key: sk-ant-fixture` })).toThrow();
  });
  test("memory seeds are small stable-fact files with no secrets and a live-data index", () => {
    expect(manifests.memorySeeds.length).toBeGreaterThan(1);
    for (const seed of manifests.memorySeeds) {
      expect(seed.path.startsWith("/")).toBe(true);
      expect(Buffer.byteLength(seed.content, "utf8")).toBeLessThanOrEqual(102_400);
    }
    const readme = manifests.memorySeeds.find(seed => seed.path === "/README.txt");
    expect(readme?.content).toContain("deliberately NOT here");
    // No seed may state a live count or an occupancy; those come from the read tools. The
    // README is exempt because naming the excluded data is exactly its job.
    for (const seed of manifests.memorySeeds) {
      expect(seed.content).not.toMatch(/\d+\s*(spots?|beds?|rooms?)\s*(are\s+)?(still\s+)?(open|available|left|free|remaining)/i);
      expect(seed.content).not.toMatch(/\d+\s+confirmed\b/i);
      if (seed.path !== "/README.txt") expect(seed.content).not.toMatch(/\bconfirmed guests?\b/i);
    }
  });
  test("a seed tree with a secret, an address book entry, or no index is refused", async () => {
    for (const [file, content] of [
      ["leak.txt", "password: hunter2\n"],
      ["leak.txt", "Reach the driver at driver@example.com\n"],
      ["leak.txt", "Call +41 22 555 0000 for the bus\n"],
    ] as const) {
      const fixture = await mkdtemp(join(tmpdir(), "club-memory-"));
      try {
        await mkdir(`${fixture}/memory`);
        await writeFile(`${fixture}/memory/README.txt`, manifests.memorySeeds.find(s2 => s2.path === "/README.txt")!.content);
        await writeFile(`${fixture}/memory/${file}`, content);
        await expect(readMemorySeeds(fixture)).rejects.toThrow();
      } finally { await rm(fixture, { recursive: true, force: true }); }
    }
    const noIndex = await mkdtemp(join(tmpdir(), "club-memory-"));
    try {
      await mkdir(`${noIndex}/memory`);
      await writeFile(`${noIndex}/memory/facts.txt`, "The trip runs 30 Jan to 6 Feb 2027.\n");
      await expect(readMemorySeeds(noIndex)).rejects.toThrow("live-only");
    } finally { await rm(noIndex, { recursive: true, force: true }); }
  });
});

describe("offline deployment guards", () => {
  test("updates same agent with optimistic concurrency and no duplicated tools", async () => {
    const p = provider(existing, { ...existing, version: 4 });
    await deployResource("agents", manifests.agent, existing.id, false, p.call, p.save);
    expect(p.calls.map(c => c.args[1])).toEqual(["retrieve", "update"]);
    expect(p.calls[1]!.args).toEqual(["beta:agents", "update", "--agent-id", existing.id, "--format", "json", "--version", "3"]);
    expect(p.calls[1]!.body).toBe(manifests.agent);
    expect(p.saved).toEqual([existing.id]);
  });
  test("failed retrieve cannot create a replacement even with --create", async () => {
    const p = provider(new Error("lookup failed"));
    await expect(deployResource("agents", manifests.agent, existing.id, true, p.call, p.save)).rejects.toThrow();
    expect(p.calls).toHaveLength(1);
    expect(p.saved).toEqual([]);
  });
  test("failed list cannot create a duplicate", async () => {
    const p = provider(new Error("list failed"));
    await expect(deployResource("agents", manifests.agent, undefined, true, p.call, p.save)).rejects.toThrow();
    expect(p.calls).toHaveLength(1);
  });
  test("an error or malformed row from a zero-exit listing never authorizes creation", async () => {
    for (const listing of [[{ type: "error", error: { message: "fixture" } }], [{}]]) {
      const p = provider(listing);
      await expect(deployResource("agents", manifests.agent, undefined, true, p.call, p.save)).rejects.toThrow();
      expect(p.calls).toHaveLength(1);
      expect(p.saved).toEqual([]);
    }
  });
  test("rejects duplicate names and truncated listings", async () => {
    for (const listing of [[existing, { ...existing, id: "agent_second" }], Array.from({ length: 1001 }, () => existing)]) {
      const p = provider(listing);
      await expect(deployResource("agents", manifests.agent, undefined, true, p.call, p.save)).rejects.toThrow();
      expect(p.calls).toHaveLength(1);
    }
  });
  test("adopts unique existing agent instead of creating another", async () => {
    const p = provider([existing], existing, { ...existing, version: 4 });
    await deployResource("agents", manifests.agent, undefined, true, p.call, p.save);
    expect(p.calls.map(c => c.args[1])).toEqual(["list", "retrieve", "update"]);
    expect(p.saved).toEqual([existing.id]);
  });
  test("creation requires separate opt-in and saves the returned ID", async () => {
    const refused = provider([]);
    await expect(deployResource("agents", manifests.agent, undefined, false, refused.call, refused.save)).rejects.toThrow("--apply --create");
    expect(refused.calls).toHaveLength(1);
    const allowed = provider([], existing);
    await deployResource("agents", manifests.agent, undefined, true, allowed.call, allowed.save);
    expect(allowed.calls.map(c => c.args[1])).toEqual(["list", "create"]);
    expect(allowed.saved).toEqual([existing.id]);
  });
  test("never updates archived, foreign, unversioned, or coordinator agents", async () => {
    for (const bad of [
      { ...existing, archived_at: "2026-01-01" }, { ...existing, name: "foreign" },
      { ...existing, multiagent: { type: "coordinator" } }, { ...existing, version: undefined },
    ]) {
      const p = provider(bad);
      await expect(deployResource("agents", manifests.agent, existing.id, true, p.call, p.save)).rejects.toThrow();
      expect(p.calls).toHaveLength(1);
      expect(p.saved).toEqual([]);
    }
  });
  test("re-applying an unchanged body is a no-op, not a failure", async () => {
    // The provider mints no new version when the body is byte-identical.
    const p = provider(existing, existing);
    await deployResource("agents", manifests.agent, existing.id, false, p.call, p.save);
    expect(p.calls.map(c => c.args[1])).toEqual(["retrieve", "update"]);
    expect(p.saved).toEqual([existing.id]);
  });
  test("HTTP error bodies and rolled-back update versions cannot count as success", async () => {
    for (const bad of [{ type: "error", error: { message: "internal details" } }, { ...existing, version: 2 }]) {
      const p = provider(existing, bad);
      await expect(deployResource("agents", manifests.agent, existing.id, false, p.call, p.save)).rejects.toThrow();
      expect(p.saved).toEqual([]);
    }
  });
  test("environment update preserves ID and sends the restricted YAML", async () => {
    const row = { id: "env_fixture", name: environmentName };
    const p = provider(row, row);
    await deployResource("environments", manifests.environment, row.id, false, p.call, p.save);
    expect(p.calls[1]!.args).toEqual(["beta:environments", "update", "--environment-id", row.id, "--format", "json"]);
    expect(p.calls[1]!.body).toBe(manifests.environment);
    expect(p.saved).toEqual([row.id]);
  });
  test("invalid identifiers fail before calling provider", async () => {
    const p = provider();
    await expect(deployResource("agents", manifests.agent, "env_wrong", true, p.call, p.save)).rejects.toThrow();
    expect(p.calls).toEqual([]);
  });
  test("invalid flags fail before any provider call", async () => {
    await expect(main(["all", "--create"])).rejects.toThrow("Usage:");
    await expect(main(["all", "--apply", "--dry-run"])).rejects.toThrow("Usage:");
    await expect(main(["all", "--unknown"])).rejects.toThrow("Usage:");
  });
  test("dry run needs no credentials, does not source env, call ant, or write state", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "club-deploy-dry-"));
    try {
      await mkdir(`${fixture}/agents`);
      await mkdir(`${fixture}/environments`);
      await mkdir(`${fixture}/memory`);
      await writeFile(`${fixture}/agents/trip-concierge.agent.yaml`, manifests.agent);
      await writeFile(`${fixture}/environments/default.environment.yaml`, manifests.environment);
      await writeFile(`${fixture}/memory-store.yaml`, await Bun.file(`${root}/memory-store.yaml`).text());
      for (const seed of manifests.memorySeeds) {
        const target = `${fixture}/memory${seed.path}`;
        await mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true });
        await writeFile(target, seed.content);
      }
      await writeFile(`${fixture}/.env`, "not executable or valid env; must never be sourced\n");
      const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", `import { main } from ${JSON.stringify(`${root}/scripts/deploy.ts`)}; await main(['all'], ${JSON.stringify(fixture)});`], {
        env: { PATH: "" }, stdout: "pipe", stderr: "pipe", timeout: 10_000,
      });
      expect(result.exitCode).toBe(0);
      expect(result.signalCode).toBeUndefined();
      expect(result.stdout.toString()).toContain("No API calls or state writes");
      expect(await Bun.file(`${fixture}/scripts/.state/environment.id`).exists()).toBe(false);
      expect(await readFile(`${fixture}/.env`, "utf8")).toBe("not executable or valid env; must never be sourced\n");
    } finally { await rm(fixture, { recursive: true, force: true }); }
    expect(await Bun.file(`${fixture}/.env`).exists()).toBe(false);
  });
  test("CLI errors are redacted, including malformed output with exit zero", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "club-fake-cli-"));
    const priorPath = process.env.PATH;
    try {
      const fake = `${fixture}/ant`;
      process.env.PATH = fixture;
      for (const code of [0, 1]) {
        await writeFile(fake, `#!/bin/sh\nprintf '%s\\n' 'sensitive_fixture_payload'\nprintf '%s\\n' 'sensitive_fixture_error' >&2\nexit ${code}\n`, { mode: 0o700 });
        let message = "";
        try { await callAnt(["beta:agents", "retrieve"]); }
        catch (error) { message = error instanceof Error ? error.message : ""; }
        expect(message).not.toBe("");
        expect(message).not.toContain("sensitive_fixture");
      }
    } finally {
      if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath;
      await rm(fixture, { recursive: true, force: true });
    }
    expect(await Bun.file(`${fixture}/ant`).exists()).toBe(false);
  });
});

describe("memory store deployment", () => {
  const seeds = [
    { path: "/README.txt", content: "index\n" },
    { path: "/trip/overview.txt", content: "dates\n" },
  ];
  const listed = (...entries: unknown[]) => entries;

  test("adopts the store by exact name, seeds missing memories, and saves the ID", async () => {
    const p = provider(
      listed({ ...store }, { id: "memstore_edge", name: "edge-chat-fixture" }),
      store, store, listed(), { id: "mem_a" }, { id: "mem_b" },
    );
    const result = await deployMemoryStore("{}", seeds, undefined, true, p.call, p.save);
    expect(result).toMatchObject({ id: store.id, created: 2, updated: 0, unchanged: 0, extra: [] });
    expect(p.calls.map(c => `${c.args[0]} ${c.args[1]}`)).toEqual([
      "beta:memory-stores list", "beta:memory-stores retrieve", "beta:memory-stores update",
      "beta:memory-stores:memories list", "beta:memory-stores:memories create", "beta:memory-stores:memories create",
    ]);
    expect(JSON.parse(p.calls[4]!.body!)).toEqual(seeds[0]);
    expect(p.saved).toEqual([store.id]);
  });

  test("unchanged content is a no-op and changed content updates under a precondition", async () => {
    const remote = [
      { type: "memory", id: "mem_a", path: "/README.txt", content_sha256: sha(seeds[0]!.content) },
      { type: "memory", id: "mem_b", path: "/trip/overview.txt", content_sha256: sha("stale\n") },
    ];
    const p = provider(store, store, listed(...remote), { id: "mem_b" });
    const result = await deployMemoryStore("{}", seeds, store.id, false, p.call, p.save);
    expect(result).toMatchObject({ created: 0, updated: 1, unchanged: 1, extra: [] });
    const update = p.calls.at(-1)!;
    expect(update.args).toEqual(["beta:memory-stores:memories", "update", "--memory-store-id", store.id, "--memory-id", "mem_b", "--format", "json"]);
    expect(JSON.parse(update.body!)).toEqual({
      content: seeds[1]!.content,
      precondition: { type: "content_sha256", content_sha256: sha("stale\n") },
    });
  });

  test("memory paths this app does not own are reported, never deleted", async () => {
    const p = provider(store, store, listed(
      { type: "memory", id: "mem_a", path: "/README.txt", content_sha256: sha(seeds[0]!.content) },
      { type: "memory", id: "mem_old", path: "/trip/renamed-away.txt", content_sha256: sha("old\n") },
      { type: "memory_prefix", path: "/trip" },
    ), { id: "mem_b" });
    const result = await deployMemoryStore("{}", seeds, store.id, false, p.call, p.save);
    expect(result.extra).toEqual(["/trip/renamed-away.txt"]);
    expect(p.calls.map(c => c.args[1])).not.toContain("delete");
  });

  test("creation requires separate opt-in and never follows a failed or ambiguous lookup", async () => {
    const refused = provider(listed());
    await expect(deployMemoryStore("{}", seeds, undefined, false, refused.call, refused.save)).rejects.toThrow("--apply --create");
    expect(refused.saved).toEqual([]);
    for (const listing of [
      new Error("list failed"),
      listed({ ...store }, { ...store, id: "memstore_second" }),
      Array.from({ length: 1001 }, () => ({ ...store })),
      listed({ type: "error", error: { message: "fixture" } }),
    ]) {
      const p = provider(listing);
      await expect(deployMemoryStore("{}", seeds, undefined, true, p.call, p.save)).rejects.toThrow();
      expect(p.calls).toHaveLength(1);
      expect(p.saved).toEqual([]);
    }
  });

  test("never writes to an archived, foreign, or wrongly-prefixed store", async () => {
    for (const bad of [{ ...store, archived_at: "2026-01-01" }, { ...store, name: "edge-chat-fixture" }]) {
      const p = provider(bad);
      await expect(deployMemoryStore("{}", seeds, store.id, true, p.call, p.save)).rejects.toThrow();
      expect(p.calls).toHaveLength(1);
      expect(p.saved).toEqual([]);
    }
    const wrongPrefix = provider();
    await expect(deployMemoryStore("{}", seeds, "agent_fixture", true, wrongPrefix.call, wrongPrefix.save)).rejects.toThrow();
    expect(wrongPrefix.calls).toEqual([]);
  });

  test("a truncated or malformed memory listing stops the reconcile", async () => {
    for (const listing of [Array.from({ length: 1001 }, () => ({ type: "memory", id: "mem_a", path: "/README.txt", content_sha256: "x" })), listed({ type: "memory", id: "mem_a" })]) {
      const p = provider(store, store, listing);
      await expect(deployMemoryStore("{}", seeds, store.id, false, p.call, p.save)).rejects.toThrow();
    }
  });
});
