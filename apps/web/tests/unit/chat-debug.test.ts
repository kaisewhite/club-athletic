import { afterEach, expect, it, vi } from "vitest";
import { logChatFailure } from "../../src/lib/chat/runtime/chat-debug.server";

afterEach(() => vi.restoreAllMocks());

it("normalizes unrecognized failure stages and error names before logging", () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const error = new Error("internal detail");
  error.name = "user:sk-secret@db.invalid";

  logChatFailure("route\nsk-secret@db.invalid", error);

  expect(logged).toHaveBeenCalledTimes(1);
  const output = JSON.stringify(logged.mock.calls);
  expect(output).not.toMatch(/sk-secret|db\.invalid|internal detail/);
  expect(logged.mock.calls[0]?.[0]).toBe("[chat] unknown failed");
  expect(logged.mock.calls[0]?.[1]).toMatchObject({ name: "Error" });
});
