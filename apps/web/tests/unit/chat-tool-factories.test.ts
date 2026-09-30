import { afterEach, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: "session" })),
  agent: vi.fn(async () => ({ version: "v", multiagent: null })),
  runner: vi.fn(),
}));
const readTools = vi.hoisted(() => ({
  lookupTripGuest: vi.fn(),
  createReadTools: vi.fn(() => []),
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    files = {};
    beta = {
      agents: { retrieve: sdk.agent },
      sessions: { create: sdk.create, events: { toolRunner: sdk.runner } },
    };
  },
}));
vi.mock("../../src/lib/managed-agents/config.server", () => ({
  parseManagedAgentsConfig: () => ({
    anthropicApiKey: "fixture",
    agentId: "a",
    environmentId: "e",
    memoryStoreId: "memstore_fixture",
  }),
  TRIP_AGENT_INSTRUCTIONS: "fixture",
}));
vi.mock("../../src/lib/chat/tools/read-tools.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/chat/tools/read-tools.server")>();
  return { ...original, ...readTools };
});
import {
  TRIP_AGENT_TOOLSET,
  TRIP_MEMORY_INSTRUCTIONS,
  createManagedAgentsClient,
  tripSessionResources,
  tripSessionTools,
} from "../../src/lib/managed-agents/client.server";
import { createUploadProvider } from "../../src/lib/managed-agents/upload-client.server";
import { tripToolDefinitions } from "../../src/lib/chat/tools/registry.server";
import { createTripRunnableTools, runWithTripTools } from "../../src/lib/chat/runtime/tool-runner.server";
afterEach(() => {
  vi.clearAllMocks();
  readTools.lookupTripGuest.mockReset();
  readTools.createReadTools.mockReset().mockReturnValue([]);
});
it("both real session factories register the identical full trip tool set", async () => {
  const signal = new AbortController().signal;
  await createManagedAgentsClient().create("hello", "c", signal);
  await createUploadProvider().draft("c", signal);
  const calls = sdk.create.mock.calls as unknown as [
    {
      agent: { tools: unknown; skills: unknown; mcp_servers: unknown };
      resources: unknown;
    },
  ][];
  expect(calls).toHaveLength(2);
  expect(calls[0]![0].agent.tools).toEqual(tripSessionTools);
  // The custom definitions are still all there, alongside the built-in toolset entry.
  expect(
    (calls[0]![0].agent.tools as { type: string }[]).filter((tool) => tool.type === "custom"),
  ).toEqual(tripToolDefinitions);
  expect(calls[1]![0].agent.tools).toEqual(calls[0]![0].agent.tools);
  for (const [input] of calls)
    expect(input.agent).toMatchObject({ skills: [], mcp_servers: [] });
  // Chat sessions and upload sessions must behave identically, memory included.
  expect(calls[0]![0].resources).toEqual(tripSessionResources({ memoryStoreId: "memstore_fixture" }));
  expect(calls[1]![0].resources).toEqual(calls[0]![0].resources);
  expect(calls[0]![0].resources).toEqual([
    {
      type: "memory_store",
      memory_store_id: "memstore_fixture",
      access: "read_only",
      instructions: TRIP_MEMORY_INSTRUCTIONS,
    },
  ]);
});
// Regression: POST /v1/sessions/:id/resources answers 400 "Missing required tool: file
// resources require the read tool to be usable (enabled and not always_deny) on the session's
// `agent_toolset`". Both factories mount booking screenshots, so a session created without a
// usable read tool is the flight upload path dead again — this test fails before the route does.
const builtInTools = [
  "bash",
  "read",
  "write",
  "edit",
  "glob",
  "grep",
  "web_fetch",
  "web_search",
] as const;
type ToolsetEntry = {
  type: string;
  default_config?: { enabled?: boolean | null } | null;
  configs?: { name: string; enabled?: boolean | null; permission_policy?: { type: string } | null }[];
};
function readIsUsable(tools: unknown) {
  const toolsets = (tools as ToolsetEntry[]).filter(
    (tool) => tool.type === "agent_toolset_20260401",
  );
  // One toolset only: a second entry makes "which config wins" a guess.
  if (toolsets.length !== 1) return false;
  const entry = toolsets[0]!.configs?.find((config) => config.name === "read");
  const enabled = entry?.enabled ?? toolsets[0]!.default_config?.enabled ?? true;
  return enabled === true && entry?.permission_policy?.type !== "always_deny";
}
it("makes the built-in read tool usable on every session that mounts a file", async () => {
  const signal = new AbortController().signal;
  await createManagedAgentsClient().create("hello", "c", signal);
  await createUploadProvider().draft("c", signal);
  const calls = sdk.create.mock.calls as unknown as [{ agent: { tools: unknown } }][];
  expect(calls).toHaveLength(2);
  for (const [input] of calls) expect(readIsUsable(input.agent.tools)).toBe(true);
  // Identical toolset on both: one that differed would only surface during a real ingestion.
  expect(calls[1]![0].agent.tools).toEqual(calls[0]![0].agent.tools);
  expect(readIsUsable(tripSessionTools)).toBe(true);
});
it("grants read and nothing else from the built-in toolset", () => {
  // An unlisted public page: read exists to satisfy the mount precondition, so bash, code
  // execution, web search and web fetch must all stay off rather than ride along with it.
  expect(TRIP_AGENT_TOOLSET.default_config?.enabled).toBe(false);
  expect(TRIP_AGENT_TOOLSET.configs?.map((config) => config.name)).toEqual(["read"]);
  for (const name of builtInTools) {
    const config = TRIP_AGENT_TOOLSET.configs?.find((entry) => entry.name === name);
    expect(config?.enabled ?? TRIP_AGENT_TOOLSET.default_config?.enabled).toBe(name === "read");
  }
  // always_ask also satisfies the mount precondition, but it parks the session idle awaiting a
  // user.tool_confirmation this app never sends, which would strand the guest's turn.
  expect(TRIP_AGENT_TOOLSET.configs?.[0]?.permission_policy).toEqual({ type: "always_allow" });
  // Exactly one toolset entry, and the custom definitions are otherwise untouched.
  expect(tripSessionTools.filter((tool) => tool.type === "agent_toolset_20260401")).toEqual([
    TRIP_AGENT_TOOLSET,
  ]);
  expect(tripSessionTools).toEqual([TRIP_AGENT_TOOLSET, ...tripToolDefinitions]);
});
it("uses sessions.events.toolRunner with all registered schemas and an owned lifetime", async () => {
  let runnerSignal: AbortSignal | undefined;
  const abort = vi.fn();
  sdk.runner.mockImplementation((_id, options) => ({
    abort,
    async *[Symbol.asyncIterator]() {
      runnerSignal = options.signal;
      yield undefined;
      await new Promise<void>((resolve) => {
        if (options.signal.aborted) resolve();
        else
          options.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
      });
    },
  }));
  await runWithTripTools(
    {
      scope: { tripId: "trip", conversationId: "c" },
      sessionId: "session",
      provider: createManagedAgentsClient(),
      signal: new AbortController().signal,
    },
    async () => {},
  );
  expect(sdk.runner).toHaveBeenCalledTimes(1);
  const [id, options] = sdk.runner.mock.calls[0]!;
  expect(id).toBe("session");
  expect(options.maxIdleMs).toBe(0);
  expect(options.tools.map((tool: { name: string }) => tool.name)).toEqual(
    tripToolDefinitions.map((tool) => tool.name),
  );
  for (const tool of options.tools)
    expect(tool.input_schema).toEqual(
      tripToolDefinitions.find((t) => t.name === tool.name)!.input_schema,
    );
  expect(runnerSignal?.aborted).toBe(true);
  expect(abort).toHaveBeenCalledTimes(1);
});
it("reports registered guest lookup infrastructure failures as unavailable", async () => {
  readTools.lookupTripGuest.mockRejectedValue(new Error("postgres://user:secret@db.invalid/trip"));
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const tool = createTripRunnableTools(
      { tripId: "trip", conversationId: "conversation" },
      {} as import("@anthropic-ai/sdk").default,
    ).find((candidate) => candidate.name === "findGuestByName")!;
    const output = await tool.run({ firstName: "Kaise", lastName: null });
    expect(typeof output).toBe("string");
    const result = JSON.parse(output as string);
    expect(result).toEqual({ ok: false, message: "Trip data is temporarily unavailable. Please try again." });
    expect(JSON.stringify(logged.mock.calls)).not.toMatch(/secret|db\.invalid|postgres/);
  } finally {
    logged.mockRestore();
  }
});
it("attaches the trip memory read-only, and omits it entirely when no store is configured", () => {
  // Memory stores attach at session-create time only, so an absent id must simply mean
  // no resource rather than a thrown request: tool-only answers still work.
  expect(tripSessionResources({ memoryStoreId: undefined })).toEqual([]);
  const attached = tripSessionResources({ memoryStoreId: "memstore_x" });
  expect(attached).toEqual([
    {
      type: "memory_store",
      memory_store_id: "memstore_x",
      access: "read_only",
      instructions: TRIP_MEMORY_INSTRUCTIONS,
    },
  ]);
  // Guests must never be able to rewrite the shared trip facts.
  expect(attached[0]!.access).toBe("read_only");
});
it("tells the model memory is background and the volatile rows come from tools", () => {
  expect(TRIP_MEMORY_INSTRUCTIONS).toContain("deliberately");
  expect(TRIP_MEMORY_INSTRUCTIONS).toContain("how many beds are still available");
  expect(TRIP_MEMORY_INSTRUCTIONS).toContain("who is in which bed");
  expect(TRIP_MEMORY_INSTRUCTIONS).toContain("the flight table");
  for (const tool of ["getOpenSpots", "getRoomsByFloor", "getFlightTable", "getGuestTasks"])
    expect(TRIP_MEMORY_INSTRUCTIONS).toContain(tool);
  expect(TRIP_MEMORY_INSTRUCTIONS).toContain("the tool wins");
  expect(TRIP_MEMORY_INSTRUCTIONS).toContain("do not write to it");
  // The API caps per-attachment instructions at 4096 characters.
  expect(TRIP_MEMORY_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
  // Memories are replayed verbatim into every later session; nothing secret may be named.
  expect(TRIP_MEMORY_INSTRUCTIONS).not.toMatch(/sk-ant|Bearer /);
});
