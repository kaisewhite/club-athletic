import { describe, expect, it, vi } from "vitest";
import {
  runWithTripTools,
  classifyToolWaits,
} from "../../src/lib/chat/runtime/tool-runner.server";
import { mapManagedAgentEvent } from "../../src/lib/managed-agents/map-managed-agent-event";
import { createPumpRegistry } from "../../src/lib/chat/runtime/active-pumps.server";
import type {
  ManagedAgentsProvider,
  ProviderEvent,
} from "../../src/lib/managed-agents/client.server";
import { readTripAttachment } from "../../src/lib/chat/tools/attachment.server";

const provider = (events: ProviderEvent[]): ManagedAgentsProvider => ({
  create: async () => "s",
  send: async () => {},
  interrupt: async () => {},
  history: async () => events,
  threads: async () => [],
  threadHistory: async () => [],
  async *stream() {
    yield* events;
  },
});
function gate(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
it("cancelled pump aborts and drains its SDK runner, releasing parent listeners", async () => {
  const pumps = createPumpRegistry();
  let running = 0;
  let pumpStopped = false;
  let runnerSignal: AbortSignal | undefined;
  let remove: ReturnType<typeof vi.spyOn> | undefined;
  pumps.start("c", async (signal) => {
    remove = vi.spyOn(signal, "removeEventListener");
    await runWithTripTools(
      {
        scope: { tripId: "t", conversationId: "c" },
        sessionId: "s",
        signal,
        provider: provider([]),
      },
      async ({ signal }) => {
        try {
          await gate(signal);
        } finally {
          pumpStopped = true;
        }
      },
      (signal) => {
        runnerSignal = signal;
        return {
          abort: vi.fn(),
          async *[Symbol.asyncIterator]() {
            running++;
            try {
              await gate(signal);
            } finally {
              running--;
            }
          },
        };
      },
    );
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(running).toBe(1);
  await pumps.stop();
  expect(runnerSignal?.aborted).toBe(true);
  expect(running).toBe(0);
  expect(pumpStopped).toBe(true);
  expect(pumps.count()).toBe(0);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
});
it("natural pump completion drains the runner without its 60s SDK idle timer", async () => {
  let running = 0;
  await runWithTripTools(
    {
      scope: { tripId: "t", conversationId: "c" },
      sessionId: "s",
      signal: new AbortController().signal,
      provider: provider([]),
    },
    async () => {},
    (signal) => ({
      abort: () => {},
      async *[Symbol.asyncIterator]() {
        running++;
        try {
          await gate(signal);
        } finally {
          running--;
        }
      },
    }),
  );
  expect(running).toBe(0);
});
it("runner failure aborts and awaits the pump", async () => {
  let cleaned = false;
  await expect(
    runWithTripTools(
      {
        scope: { tripId: "t", conversationId: "c" },
        sessionId: "s",
        signal: new AbortController().signal,
        provider: provider([]),
      },
      async ({ signal }) => {
        try {
          await gate(signal);
        } finally {
          cleaned = true;
        }
      },
      () => ({
        abort: () => {},
        async *[Symbol.asyncIterator]() {
          throw new Error("fixture runner failed");
        },
      }),
    ),
  ).rejects.toThrow("fixture runner failed");
  expect(cleaned).toBe(true);
});
it("an already cancelled lifetime never starts the runner", async () => {
  const c = new AbortController();
  c.abort();
  const start = vi.fn();
  await expect(
    runWithTripTools(
      {
        scope: { tripId: "t", conversationId: "c" },
        sessionId: "s",
        signal: c.signal,
        provider: provider([]),
      },
      async () => {},
      start,
    ),
  ).rejects.toBeDefined();
  expect(start).not.toHaveBeenCalled();
});
describe("SDK event IDs distinguish custom service waits and genuine approval waits", () => {
  it("custom recordFlight wait leaves the composer available, including on history replay", async () => {
    const wrapped = classifyToolWaits(
      provider([
        {
          id: "tool",
          type: "agent.custom_tool_use",
          name: "recordFlight",
          input: {},
        },
        {
          id: "wait",
          type: "session.status_idle",
          stop_reason: { type: "requires_action", event_ids: ["tool"] },
        },
      ]),
    );
    const events = await wrapped.history("s", new AbortController().signal);
    expect(mapManagedAgentEvent(events[1]!)).toEqual({
      kind: "approval",
      pending: false,
    });
  });
  it("unknown and permission-gated calls remain approval-pending", async () => {
    const wrapped = classifyToolWaits(
      provider([
        {
          id: "tool",
          type: "agent.tool_use",
          name: "recordFlight",
          evaluated_permission: "ask",
        },
        {
          id: "wait",
          type: "session.status_idle",
          stop_reason: { type: "requires_action", event_ids: ["tool"] },
        },
      ]),
    );
    const events = await wrapped.history("s", new AbortController().signal);
    expect(mapManagedAgentEvent(events[1]!)).toEqual({
      kind: "approval",
      pending: true,
    });
    expect(
      mapManagedAgentEvent({
        type: "session.status_idle",
        stop_reason: { type: "requires_action", event_ids: ["unknown"] },
      }),
    ).toEqual({ kind: "approval", pending: true });
  });
  it("guest name requests and read-backs end a turn rather than requesting tool approval", () => {
    expect(
      mapManagedAgentEvent({
        type: "session.status_idle",
        stop_reason: { type: "end_turn" },
      }),
    ).toMatchObject({ kind: "lifecycle", type: "turn.completed" });
  });
});
it("attachment reader rejects an unowned path without downloading anything", async () => {
  const download = vi.fn();
  await expect(
    readTripAttachment(
      { tripId: "t", conversationId: "c" },
      "/mnt/session/uploads/other.webp",
      new AbortController().signal,
      { find: async () => null, download },
    ),
  ).rejects.toThrow("unavailable");
  expect(download).not.toHaveBeenCalled();
});
it("attachment reader returns the scoped image and cancels its byte reader", async () => {
  const cancel = vi.fn();
  const content = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array([1, 2, 3]));
      c.close();
    },
    cancel,
  });
  const download = vi.fn(async () => new Response(content));
  const result = await readTripAttachment(
    { tripId: "t", conversationId: "c" },
    "/mnt/session/uploads/u.webp",
    new AbortController().signal,
    {
      find: async () => ({
        mountedFileId: "mounted",
        mimeType: "image/webp",
        sizeBytes: 3,
      }),
      download,
    },
  );
  expect(result).toEqual([
    {
      type: "image",
      source: { type: "base64", media_type: "image/webp", data: "AQID" },
    },
  ]);
  expect(download).toHaveBeenCalledWith("mounted", expect.any(AbortSignal));
  expect(content.locked).toBe(false);
});
it("an unrecognized permission value cannot be classified as a safe service wait", async () => {
  const wrapped = classifyToolWaits(
    provider([
      {
        id: "call",
        type: "agent.custom_tool_use",
        name: "recordFlight",
        evaluated_permission: "future-permission",
      },
      {
        id: "wait",
        type: "session.status_idle",
        stop_reason: { type: "requires_action", event_ids: ["call"] },
      },
    ]),
  );
  const events = await wrapped.history("s", new AbortController().signal);
  expect(mapManagedAgentEvent(events[1]!)).toEqual({
    kind: "approval",
    pending: true,
  });
});
it("attachment HTTP failure cancels the response body", async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream({ cancel });
  await expect(
    readTripAttachment(
      { tripId: "t", conversationId: "c" },
      "/mnt/session/uploads/u.webp",
      new AbortController().signal,
      {
        find: async () => ({
          mountedFileId: "m",
          mimeType: "image/webp",
          sizeBytes: 1,
        }),
        download: async () => new Response(stream, { status: 503 }),
      },
    ),
  ).rejects.toThrow("unavailable");
  expect(cancel).toHaveBeenCalledTimes(1);
});
