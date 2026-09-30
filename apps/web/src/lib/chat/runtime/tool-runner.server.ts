import Anthropic from "@anthropic-ai/sdk";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import type {
  ManagedAgentsProvider,
  ProviderEvent,
} from "../../managed-agents/client.server";
import { parseManagedAgentsConfig } from "../../managed-agents/config.server";
import type { ConversationScope } from "../repository.server";
import {
  tripToolDefinitions,
  tripToolSchemas,
  attachmentSchema,
} from "../tools/registry.server";
import {
  createReadTools,
  lookupTripGuest,
  guestNameSchema,
  boundTripData,
  TRIP_INVALID_REQUEST,
  TRIP_UNAVAILABLE,
} from "../tools/read-tools.server";
import { createRecordFlightTool } from "../tools/record-flight.server";
import {
  findSubmittedAttachment,
  readTripAttachment,
} from "../tools/attachment.server";
import { logChatFailure } from "./chat-debug.server";

const ownedNames = new Set(tripToolDefinitions.map((t) => t.name));
/** Enrich ONLY the service-wait classification from observed SDK event identity.
 * Missing IDs/unknown tools/gated builtin calls fail closed as approval waits.
 * The event pump remains the sole writer/projector of provider event rows. */
export function classifyToolWaits(
  provider: ManagedAgentsProvider,
): ManagedAgentsProvider {
  const calls = new Map<string, boolean>();
  const annotate = (event: ProviderEvent): ProviderEvent => {
    if (
      typeof event.id === "string" &&
      [
        "agent.custom_tool_use",
        "agent.tool_use",
        "agent.mcp_tool_use",
      ].includes(String(event.type))
    ) {
      calls.set(
        event.id,
        event.type === "agent.custom_tool_use" &&
          typeof event.name === "string" &&
          ownedNames.has(event.name) &&
          (event.evaluated_permission === undefined ||
            event.evaluated_permission === "allow"),
      );
    }
    if (event.type !== "session.status_idle") return event;
    const reason = event.stop_reason as
      { type?: string; event_ids?: unknown } | undefined;
    if (reason?.type !== "requires_action") return event;
    const ids = reason.event_ids;
    return {
      ...event,
      tripServiceToolWait:
        Array.isArray(ids) &&
        ids.length > 0 &&
        ids.every((id) => typeof id === "string" && calls.get(id) === true),
    };
  };
  return {
    ...provider,
    history: async (session, signal) =>
      (await provider.history(session, signal)).map(annotate),
    threadHistory: async (session, thread, signal) =>
      (await provider.threadHistory(session, thread, signal)).map(annotate),
    async *stream(session, signal, thread) {
      try {
        for await (const event of provider.stream(session, signal, thread))
          yield annotate(event);
      } finally {
        if (!thread) calls.clear();
      }
    },
  };
}
export interface OwnedToolRunner extends AsyncIterable<unknown> {
  abort(): void;
}
export type RunnerFactory = (signal: AbortSignal) => OwnedToolRunner;
export function createTripRunnableTools(
  scope: ConversationScope,
  client: Anthropic,
): BetaRunnableTool<unknown>[] {
  const sectionTools = new Map(createReadTools().map((t) => [t.name, t]));
  return tripToolSchemas.map(({ name, description, schema }) => {
    if (name === "recordFlight") return createRecordFlightTool(scope);
    return {
      name,
      description,
      input_schema: {
        ...tripToolDefinitions.find((t) => t.name === name)!.input_schema,
        type: "object" as const,
      },
      parse: (raw: unknown) => {
        const result = schema.safeParse(raw);
        if (!result.success) throw new Error(TRIP_INVALID_REQUEST);
        return result.data;
      },
      async run(input: unknown, context) {
        try {
          context?.signal?.throwIfAborted();
          const section = sectionTools.get(name);
          if (section) return await section.run(input);
          if (name === "findGuestByName") {
            const parsed = guestNameSchema.safeParse(input);
            if (!parsed.success)
              return JSON.stringify({ ok: false, message: TRIP_INVALID_REQUEST });
            return JSON.stringify({
              ok: true,
              sourceSection: "Guests",
              data: boundTripData(await lookupTripGuest(parsed.data)),
            });
          }
          if (name === "readTripAttachment" && context?.signal) {
            const parsed = attachmentSchema.safeParse(input);
            if (!parsed.success)
              return JSON.stringify({ ok: false, message: TRIP_INVALID_REQUEST });
            return await readTripAttachment(
              scope,
              parsed.data.mountPath,
              context.signal,
              {
                find: findSubmittedAttachment,
                download: (id, signal) => client.files.download(id, { signal }),
              },
            );
          }
          return JSON.stringify({ ok: false, message: TRIP_UNAVAILABLE });
        } catch (error) {
          // Tool execution failure is not evidence that a fact is missing.
          if (!context?.signal?.aborted)
            logChatFailure("tool.run", error, { tool: name, conversationId: scope.conversationId });
          return JSON.stringify({ ok: false, message: TRIP_UNAVAILABLE });
        }
      },
    } satisfies BetaRunnableTool<unknown>;
  });
}
function sdkRunner(
  scope: ConversationScope,
  sessionId: string,
  signal: AbortSignal,
): OwnedToolRunner {
  const config = parseManagedAgentsConfig();
  const client = new Anthropic({
    apiKey: config.anthropicApiKey,
    maxRetries: 0,
    timeout: 30000,
  });
  // Installed 0.122.0 owns dispatch, result posting, dedupe and reconnect.
  // Zero disables its independent idle timer; the pump owns this lifetime.
  return client.beta.sessions.events.toolRunner(sessionId, {
    tools: createTripRunnableTools(scope, client),
    signal,
    maxIdleMs: 0,
  });
}
/** One owner, one cancellation path, and no fire-and-forget runner. */
export async function runWithTripTools(
  input: {
    scope: ConversationScope;
    sessionId: string;
    signal: AbortSignal;
    provider: ManagedAgentsProvider;
  },
  pump: (context: {
    signal: AbortSignal;
    provider: ManagedAgentsProvider;
  }) => Promise<void>,
  start: RunnerFactory = (signal) =>
    sdkRunner(input.scope, input.sessionId, signal),
): Promise<void> {
  input.signal.throwIfAborted();
  const owner = new AbortController();
  const abort = () => owner.abort(input.signal.reason);
  input.signal.addEventListener("abort", abort, { once: true });
  let runner: OwnedToolRunner | undefined;
  let pumpTask: Promise<void> | undefined;
  let runnerTask: Promise<void> | undefined;
  try {
    if (input.signal.aborted) abort();
    owner.signal.throwIfAborted();
    runner = start(owner.signal);
    runnerTask = (async () => {
      for await (const _call of runner!) {
        owner.signal.throwIfAborted();
      }
    })();
    pumpTask = Promise.resolve().then(() =>
      pump({
        signal: owner.signal,
        provider: classifyToolWaits(input.provider),
      }),
    );
    await Promise.race([pumpTask, runnerTask]);
  } finally {
    owner.abort();
    runner?.abort();
    await Promise.allSettled(
      [pumpTask, runnerTask].filter((task): task is Promise<void> => !!task),
    );
    input.signal.removeEventListener("abort", abort);
  }
}
