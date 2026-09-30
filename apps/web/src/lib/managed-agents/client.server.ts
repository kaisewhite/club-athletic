import { tripToolDefinitions } from "../chat/tools/registry.server";
/** SDK seams ported from edge managed-agents/client.ts. No skill-stripping retry.
 * Q2: 0.122.0 exposes system/model overrides, not max_tokens/history trimming. */
import Anthropic from "@anthropic-ai/sdk";
import type { BetaManagedAgentsAgentToolset20260401Params } from "@anthropic-ai/sdk/resources/beta/agents/agents";
import { parseManagedAgentsConfig, TRIP_AGENT_INSTRUCTIONS, type ManagedAgentsConfig } from "./config.server";
export const MANAGED_AGENTS_BETA = "managed-agents-2026-04-01";
/** The provider refuses a session file resource unless the built-in read tool is usable:
 * POST /v1/sessions/:id/resources answers 400 "Missing required tool: file resources require
 * the read tool to be usable (enabled and not always_deny) on the session's `agent_toolset`".
 * That is the whole reason the screenshot mount used to fail, so the toolset belongs on every
 * session that mounts a file — see shared/managed-agents-tools.md § Agent Toolset for the
 * opt-in shape and shared/managed-agents-environments.md § File Uploads for the requirement.
 *
 * Minimum grant. default_config.enabled is false, so bash, write, edit, glob, grep, web_search
 * and web_fetch are all off; read alone is opted back in. read is also how the agent actually sees
 * the screenshot: both Files API copies report downloadable: false, so nothing can fetch the bytes
 * back out, and the mounted path plus this tool is the only reading path — which is what D3 meant
 * by "CMA's read tool handles images natively". always_allow rather than always_ask: always_ask
 * also satisfies the mount precondition, but it parks the session idle awaiting a
 * user.tool_confirmation event this app never sends, which would strand the guest's turn. The only
 * things this sandbox holds are that guest's own upload and the read-only trip memory, so an
 * allowed read cannot reach the database, our source, or another conversation. */
export const TRIP_AGENT_TOOLSET: BetaManagedAgentsAgentToolset20260401Params = {
  type: "agent_toolset_20260401",
  default_config: { enabled: false, permission_policy: { type: "always_allow" } },
  configs: [{ type: "read", name: "read", enabled: true, permission_policy: { type: "always_allow" } }],
};
/** agent_with_overrides.tools is a FULL replacement, never a merge, so a toolset left only on
 * the deployed agent YAML would be discarded by every session this app creates. Both factories
 * send this one array: a toolset that differed between the chat session and the upload session
 * would only surface during a real ingestion. */
export const tripSessionTools = [TRIP_AGENT_TOOLSET, ...tripToolDefinitions];
/** Written for the model, not for us: it is rendered into the session's system prompt.
 * Memory holds the stable trip facts so simple questions need no query; everything that
 * can change stays on the live read tools, and a tool result always beats a memory file. */
export const TRIP_MEMORY_INSTRUCTIONS =
  "Stable background facts about the Méribel 2027 trip are mounted here: the dates, the chalet, " +
  "the bedroom and bed-type layout, both shuttle windows, the flight timing rules, the chef meal " +
  "counts, the eight-day schedule, the price range and the trip links. Read /README.txt first, " +
  "then answer stable questions straight from these files instead of calling a tool. They are " +
  "accurate background, never live state. Anything that can change since seeding is deliberately " +
  "absent: how many beds are still available, who is in which bed, the flight table, anyone's " +
  "booking or payment status, and guest task status. Call getOpenSpots, getRoomsByFloor, " +
  "getFlightTable or getGuestTasks for those every time, and if a tool result disagrees with a " +
  "file here, the tool wins and you answer with what the tool said. This store is reference " +
  "material maintained by the organizer's deploy script: do not write to it, and never copy a " +
  "secret, credential or booking reference into it.";
/** Identical resource list for the text-first and upload-first session factories. Memory
 * stores attach at session-create time only; sessions.resources.add() rejects them. */
export function tripSessionResources(config: Pick<ManagedAgentsConfig, "memoryStoreId">) {
  if (!config.memoryStoreId) return [];
  return [{ type: "memory_store" as const, memory_store_id: config.memoryStoreId,
    // Guests must not be able to rewrite shared trip facts, so the mount is read-only.
    access: "read_only" as const, instructions: TRIP_MEMORY_INSTRUCTIONS }];
}
export type ProviderEvent = Record<string, unknown>;
export interface ManagedAgentsProvider {
  create(text: string, conversationId: string, signal: AbortSignal): Promise<string>;
  send(sessionId: string, text: string, signal: AbortSignal): Promise<void>;
  interrupt(sessionId: string, signal: AbortSignal): Promise<void>;
  history(sessionId: string, signal: AbortSignal): Promise<ProviderEvent[]>;
  threads(sessionId: string, signal: AbortSignal): Promise<ProviderEvent[]>;
  threadHistory(sessionId: string, threadId: string, signal: AbortSignal): Promise<ProviderEvent[]>;
  stream(sessionId: string, signal: AbortSignal, threadId?: string): AsyncIterable<ProviderEvent>;
}
export function createManagedAgentsClient(): ManagedAgentsProvider {
  const config = parseManagedAgentsConfig();
  const client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 0, timeout: 30_000 });
  const betas = [MANAGED_AGENTS_BETA];
  return {
    async create(text, conversationId, signal) {
      const agent = await client.beta.agents.retrieve(config.agentId, { betas }, { signal });
      // A inherited coordinator roster cannot be safely narrowed by this SDK's
      // session override. Refuse it rather than exposing another agent's tools.
      if (agent.multiagent) throw new Error("A dedicated trip concierge agent is required.");
      const session = await client.beta.sessions.create({
        agent: { type: "agent_with_overrides", id: config.agentId, version: agent.version,
          model: { id: "claude-opus-5", effort: "high" }, system: TRIP_AGENT_INSTRUCTIONS,
          tools: tripSessionTools, mcp_servers: [], skills: [] },
        environment_id: config.environmentId, vault_ids: [],
        resources: tripSessionResources(config),
        initial_events: [{ type: "user.message", content: [{ type: "text", text }] }],
        metadata: { clubAthleticConversationId: conversationId }, betas,
      }, { signal });
      return session.id;
    },
    async send(sessionId, text, signal) {
      await client.beta.sessions.events.send(sessionId, { events: [{ type: "user.message", content: [{ type: "text", text }] }], betas }, { signal });
    },
    async interrupt(sessionId, signal) {
      await client.beta.sessions.events.send(sessionId, { events: [{ type: "user.interrupt" }], betas }, { signal });
    },
    async history(sessionId, signal) {
      const rows: ProviderEvent[] = [];
      for await (const event of client.beta.sessions.events.list(sessionId, { order: "asc", betas }, { signal })) rows.push({ ...event });
      return rows;
    },
    async threads(sessionId, signal) {
      const rows: ProviderEvent[] = [];
      for await (const thread of client.beta.sessions.threads.list(sessionId, { betas }, { signal })) rows.push({ ...thread });
      return rows;
    },
    async threadHistory(sessionId, threadId, signal) {
      const rows: ProviderEvent[] = [];
      for await (const event of client.beta.sessions.threads.events.list(threadId, { session_id: sessionId, betas }, { signal })) rows.push({ ...event });
      return rows;
    },
    async *stream(sessionId, signal, threadId) {
      const params: Anthropic.Beta.Sessions.EventStreamParams = { event_deltas: ["agent.message", "agent.thinking"], betas };
      const stream = threadId
        ? await client.beta.sessions.threads.events.stream(threadId, { ...params, session_id: sessionId }, { signal })
        : await client.beta.sessions.events.stream(sessionId, params, { signal });
      try { for await (const event of stream) { signal.throwIfAborted(); yield { ...event }; } }
      finally { stream.controller.abort(); }
    },
  };
}
