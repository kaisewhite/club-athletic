import { afterEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({
  upload: vi.fn(), mount: vi.fn(), deleteFile: vi.fn(), deleteResource: vi.fn(),
  agent: vi.fn(), createSession: vi.fn(),
}));
vi.mock("@anthropic-ai/sdk", () => ({ default: class {
  static APIError = class extends Error { status = 404; };
  files = { upload: sdk.upload, delete: sdk.deleteFile };
  beta = { agents: { retrieve: sdk.agent }, sessions: { create: sdk.createSession, resources: { add: sdk.mount, delete: sdk.deleteResource } } };
} }));
vi.mock("../../src/lib/managed-agents/config.server", () => ({ parseManagedAgentsConfig: () => ({ anthropicApiKey: "fixture", agentId: "agent", environmentId: "environment" }), TRIP_AGENT_INSTRUCTIONS: "fixture system" }));
import { tripSessionTools } from "../../src/lib/managed-agents/client.server";
import { createUploadProvider } from "../../src/lib/managed-agents/upload-client.server";
afterEach(() => vi.resetAllMocks());
describe("SDK 0.122.0 upload wrapper", () => {
  it("uses GA Files without unsupported purpose or Files beta headers, with 24h expiry", async () => {
    sdk.upload.mockResolvedValue({ id: "original" }); const signal = new AbortController().signal;
    expect(await createUploadProvider().upload(new Uint8Array([1]), "attachment.pdf", "application/pdf", signal)).toBe("original");
    expect(sdk.upload).toHaveBeenCalledWith({ file: expect.any(File), expires_in_seconds: 86_400 }, { signal });
    expect(sdk.upload.mock.calls[0]![0]).not.toHaveProperty("purpose");
  });
  it("mounts via CMA resources with a path and preserves distinct resource and mounted-file IDs", async () => {
    const resource = { id: "resource", file_id: "mounted", mount_path: "/upload.pdf" }; sdk.mount.mockResolvedValue(resource);
    const signal = new AbortController().signal;
    expect(await createUploadProvider().mount("session", "original", "/upload.pdf", signal)).toEqual(resource);
    expect(sdk.mount).toHaveBeenCalledWith("session", { type: "file", file_id: "original", mount_path: "/upload.pdf", betas: ["managed-agents-2026-04-01"] }, { signal });
  });
  it("creates an empty draft with the trip registry and without initial messages or extraction", async () => {
    sdk.agent.mockResolvedValue({ version: "version", multiagent: null }); sdk.createSession.mockResolvedValue({ id: "session" });
    expect(await createUploadProvider().draft("conversation", new AbortController().signal)).toBe("session");
    const input = sdk.createSession.mock.calls[0]![0];
    expect(input).not.toHaveProperty("initial_events"); expect(input.agent).toMatchObject({ tools: tripSessionTools, skills: [], mcp_servers: [] });
    // Without a usable built-in read tool the provider refuses the screenshot mount with a 400.
    expect(input.agent.tools).toContainEqual(expect.objectContaining({ type: "agent_toolset_20260401" }));
    expect(input.metadata).toEqual({ clubAthleticConversationId: "conversation" });
  });
  it("fails closed when the agent has a coordinator roster", async () => {
    sdk.agent.mockResolvedValue({ multiagent: { roster: [] } });
    await expect(createUploadProvider().draft("conversation", new AbortController().signal)).rejects.toThrow("dedicated"); expect(sdk.createSession).not.toHaveBeenCalled();
  });
});
