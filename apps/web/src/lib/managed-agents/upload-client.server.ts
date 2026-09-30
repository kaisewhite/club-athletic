import Anthropic from "@anthropic-ai/sdk";
import { MANAGED_AGENTS_BETA, tripSessionResources, tripSessionTools } from "./client.server";
import { parseManagedAgentsConfig, TRIP_AGENT_INSTRUCTIONS } from "./config.server";

export interface UploadProvider {
  draft(conversationId: string, signal: AbortSignal): Promise<string>;
  upload(bytes: Uint8Array, filename: string, mimeType: string, signal: AbortSignal): Promise<string>;
  mount(sessionId: string, fileId: string, path: string, signal: AbortSignal): Promise<{ id: string; file_id: string; mount_path: string }>;
  findMount(sessionId: string, path: string, signal: AbortSignal): Promise<{ id: string; file_id: string; mount_path: string } | null>;
  deleteFile(id: string, signal: AbortSignal): Promise<void>;
  deleteResource(sessionId: string, id: string, signal: AbortSignal): Promise<void>;
}
export function createUploadProvider(): UploadProvider {
  const config = parseManagedAgentsConfig();
  const client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 0, timeout: 30_000 });
  const betas = [MANAGED_AGENTS_BETA];
  const deleted = async (run: () => Promise<unknown>) => {
    try { await run(); } catch (error) { if (!(error instanceof Anthropic.APIError && error.status === 404)) throw error; }
  };
  return {
    async draft(conversationId, signal) {
      const agent = await client.beta.agents.retrieve(config.agentId, { betas }, { signal });
      if (agent.multiagent) throw new Error("A dedicated trip concierge agent is required.");
      const session = await client.beta.sessions.create({
        agent: { type: "agent_with_overrides", id: config.agentId, version: agent.version,
          model: { id: "claude-opus-5", effort: "high" }, system: TRIP_AGENT_INSTRUCTIONS,
          // Same array as the chat factory: the built-in read tool must be usable here too,
          // because this is the session the booking screenshot is mounted on.
          tools: tripSessionTools, mcp_servers: [], skills: [] },
        environment_id: config.environmentId, vault_ids: [],
        resources: tripSessionResources(config),
        metadata: { clubAthleticConversationId: conversationId }, betas,
      }, { signal });
      return session.id;
    },
    async upload(bytes, filename, mimeType, signal) {
      // Q3/D7 resolution (verified 2026-09-26): SDK 0.122.0 files.d.ts and
      // https://platform.claude.com/docs/en/api/http/files/upload both expose
      // only file + expires_in_seconds. purpose: agent_resource is unsupported.
      // Use GA Files without a beta header; resource mounting below preserves D7.
      const file = new File([new Uint8Array(bytes)], filename, { type: mimeType });
      return (await client.files.upload({ file, expires_in_seconds: 86_400 }, { signal })).id;
    },
    mount: (sessionId, fileId, mountPath, signal) => client.beta.sessions.resources.add(sessionId,
      { type: "file", file_id: fileId, mount_path: mountPath, betas }, { signal }),
    async findMount(sessionId, path, signal) {
      for await (const resource of client.beta.sessions.resources.list(sessionId, { betas }, { signal })) {
        if (resource.type === "file" && (resource.mount_path === path || resource.mount_path === `/mnt/session/uploads${path}`)) return resource;
      }
      return null;
    },
    deleteFile: (id, signal) => deleted(() => client.files.delete(id, { signal })),
    deleteResource: (sessionId, id, signal) => deleted(() => client.beta.sessions.resources.delete(id, { session_id: sessionId, betas }, { signal })),
  };
}
