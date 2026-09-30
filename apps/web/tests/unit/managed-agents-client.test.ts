import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ options: null as Record<string, unknown> | null }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class AnthropicMock {
    constructor(options: Record<string, unknown>) { state.options = options; }
  },
}));
vi.mock("../../src/lib/chat/tools/registry.server", () => ({ tripToolDefinitions: [] }));

import { createManagedAgentsClient } from "../../src/lib/managed-agents/client.server";

describe("managed agent provider reliability", () => {
  afterEach(() => { vi.unstubAllEnvs(); state.options = null; });

  it("keeps the SDK's idempotent retries enabled for transient provider errors", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CLAUDE_TRIP_AGENT_ID", "test-agent");
    vi.stubEnv("CLAUDE_MANAGED_ENVIRONMENT_ID", "test-environment");

    createManagedAgentsClient();

    expect(state.options?.maxRetries).toBe(2);
  });
});
