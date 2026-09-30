// Project one Claude Managed Agents session event into the Edge activity-row
// vocabulary the transcript UI already renders (the same `type` + payload shapes
// this app's transcript projection consumes). Keeping this translation isolated means the client
// SSE contract does not change: message/thinking/tool_call/tool_result display
// rows, turn.* lifecycle boundaries, and session.* terminals.
//
// Business completion is decided by the lifecycle layer downstream, never by
// inventing a terminal: a natural turn end maps to `turn.completed` (which parks
// the still-resumable session), and only a real session error/termination maps to
// a session-level terminal that ends the stream.

import type { AgentActivityKind, ThreadMetadata } from "../chat/contracts";
import { canonicalEventIdFor, threadRoleFromMetadata } from "./event-identity";

export type MappedManagedAgentEvent =
  // Durable rows persisted once per event, reload-safe.
  | { kind: "display"; type: "message" | "thinking" | "tool_call" | "tool_result" | "thread_status" | "thread_message" | "agent_activity"; payload: Record<string, unknown> }
  // Turn boundaries: settle the business execution but leave the session resumable.
  | { kind: "lifecycle"; type: "turn.started" | "turn.completed" | "turn.cancelled" | "turn.failed"; payload: Record<string, unknown> }
  // Session-level endings: the session is gone and live tails should stop.
  | { kind: "terminal"; type: "session.completed" | "session.failed"; payload: Record<string, unknown> }
  // The agent is blocked awaiting user input (tool confirmation); surfaced as an
  // approval-pending state frame, not a durable row.
  | { kind: "approval"; pending: boolean }
  | { kind: "ignore" };

interface ClaudeSessionEvent {
  id?: string;
  type?: string;
  [key: string]: unknown;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function definedPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

function threadPayload(event: ClaudeSessionEvent, thread?: ThreadMetadata): Record<string, unknown> {
  const providerEventId = str(event.id);
  const threadRole = threadRoleFromMetadata(thread);
  return definedPayload({
    canonicalEventId: canonicalEventIdFor(providerEventId, thread),
    providerEventId,
    threadId: thread?.threadId ?? str(event.session_thread_id),
    parentThreadId: thread?.parentThreadId,
    threadRole,
    agentName: thread?.agentName ?? str(event.agent_name),
    threadStatus: thread?.threadStatus,
  });
}

function threadStatusFromEvent(type: string | undefined): string | undefined {
  switch (type) {
    case "session.thread_created":
      return "created";
    case "session.thread_status_running":
      return "running";
    case "session.thread_status_idle":
      return "idle";
    case "session.thread_status_terminated":
      return "terminated";
    case "session.thread_status_rescheduled":
      return "rescheduled";
    default:
      return undefined;
  }
}

function readableToolLabel(prefix: "Running" | "Completed", name?: string): string {
  return name ? `${prefix} ${name}` : `${prefix} tool`;
}

function activityPayload(input: {
  kind: AgentActivityKind;
  label: string;
  text?: string;
  toolName?: string;
  thread?: ThreadMetadata;
}): Record<string, unknown> {
  return definedPayload({
    activityKind: input.kind,
    activityLabel: input.label,
    text: input.text,
    toolName: input.toolName,
    ...input.thread,
  });
}

/** Join the text blocks of a Claude content array into a single string. */
export function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: string; text: string } =>
        !!block &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("");
}

function toolCall(event: ClaudeSessionEvent, thread?: ThreadMetadata, extra?: Record<string, unknown>): MappedManagedAgentEvent {
  const toolName = str(event.name) ?? "tool";
  return {
    kind: "display",
    type: "tool_call",
    payload: definedPayload({
      toolName,
      input: event.input ?? {},
      invocationId: str(event.id),
      ...activityPayload({ kind: "tool_started", label: readableToolLabel("Running", toolName), toolName, thread }),
      ...threadPayload(event, thread),
      ...extra,
    }),
  };
}

function toolResult(event: ClaudeSessionEvent, invocationId: string | undefined, thread?: ThreadMetadata): MappedManagedAgentEvent {
  const isError = event.is_error === true;
  const text = textFromContent(event.content);
  const toolName = str(event.name);
  return {
    kind: "display",
    type: "tool_result",
    payload: definedPayload({
      invocationId,
      ok: !isError,
      toolName,
      ...activityPayload({ kind: "tool_completed", label: readableToolLabel("Completed", toolName), toolName, thread }),
      ...(text ? { result: text } : {}),
      ...(isError ? { error: text || "The tool reported an error." } : {}),
      ...threadPayload(event, thread),
    }),
  };
}

/** Map one Claude session event to an Edge activity-row instruction. */
export function mapManagedAgentEvent(event: ClaudeSessionEvent, thread?: ThreadMetadata): MappedManagedAgentEvent {
  switch (event.type) {
    case "agent.message": {
      const text = textFromContent(event.content);
      return text
        ? {
            kind: "display",
            type: "message",
            payload: definedPayload({
              text,
              activityEventId: str(event.id),
              ...activityPayload({ kind: "commentary", label: text, text, thread }),
              ...threadPayload(event, thread),
            }),
          }
        : { kind: "ignore" };
    }
    case "agent.thinking":
      return {
        kind: "display",
        type: "agent_activity",
        payload: definedPayload({
          activityEventId: str(event.id),
          ...activityPayload({
            kind: "reasoning_summary",
            label: "Thinking through the next step...",
            text: "Thinking through the next step...",
            thread,
          }),
          ...threadPayload(event, thread),
        }),
      };
    case "agent.tool_use":
    case "agent.custom_tool_use":
      return toolCall(event, thread);
    case "agent.mcp_tool_use":
      return toolCall(event, thread, str(event.mcp_server_name) ? { mcpServer: event.mcp_server_name } : undefined);
    case "user.custom_tool_result":
      return toolResult(event, str(event.custom_tool_use_id), thread);
    case "agent.tool_result":
      return toolResult(event, str(event.tool_use_id), thread);
    case "agent.mcp_tool_result":
      return toolResult(event, str(event.mcp_tool_use_id), thread);
    case "session.thread_created":
    case "session.thread_status_running":
    case "session.thread_status_idle":
    case "session.thread_status_terminated":
    case "session.thread_status_rescheduled": {
      const threadStatus = threadStatusFromEvent(event.type);
      const payload = definedPayload({
        ...threadPayload(event, { ...thread, threadStatus: thread?.threadStatus ?? threadStatus }),
        threadStatus,
        activityEventId: str(event.id),
        ...activityPayload({
          kind: "status",
          label: threadStatus ? `${threadStatus[0]!.toUpperCase()}${threadStatus.slice(1)} ${str(event.agent_name) ?? thread?.agentName ?? "subagent"}` : "Updated subagent status",
          thread: { ...thread, threadStatus: thread?.threadStatus ?? threadStatus },
        }),
      });
      return payload.threadId ? { kind: "display", type: "thread_status", payload } : { kind: "ignore" };
    }
    case "agent.thread_message_sent":
    case "agent.thread_message_received": {
      const text = textFromContent(event.content);
      const payload = definedPayload({
        ...threadPayload(event, thread),
        text,
        activityEventId: str(event.id),
        ...activityPayload({ kind: "commentary", label: text, text, thread }),
      });
      return text && payload.threadId ? { kind: "display", type: "thread_message", payload } : { kind: "ignore" };
    }
    case "span.model_request_start":
      return {
        kind: "display",
        type: "agent_activity",
        payload: definedPayload({
          activityEventId: str(event.id),
          ...activityPayload({ kind: "model_request", label: "Thinking…", text: "Thinking…", thread }),
          ...threadPayload(event, thread),
        }),
      };
    case "span.model_request_end":
      return {
        kind: "display",
        type: "agent_activity",
        payload: definedPayload({
          activityEventId: str(event.id),
          ...activityPayload({ kind: "model_request", label: "Thinking…", text: "Thinking…", thread }),
          ...threadPayload(event, thread),
        }),
      };
    case "session.status_running":
      return { kind: "lifecycle", type: "turn.started", payload: {} };
    case "session.status_idle": {
      const stopReason = (event.stop_reason as { type?: string } | undefined)?.type;
      // The runtime classifies observed custom-call IDs; a guest question is
      // an end_turn, while unknown or genuinely gated tool waits fail closed.
      if (stopReason === "requires_action") return { kind: "approval", pending: event.tripServiceToolWait !== true };
      if (stopReason === "retries_exhausted") {
        return { kind: "lifecycle", type: "turn.failed", payload: { message: "The agent exhausted its retry budget." } };
      }
      if (stopReason === "budget_reached") {
        return { kind: "lifecycle", type: "turn.failed", payload: { message: "The agent reached its budget limit." } };
      }
      // end_turn (or an unknown future idle reason): the turn ended naturally.
      return { kind: "lifecycle", type: "turn.completed", payload: {} };
    }
    case "session.status_terminated":
      return { kind: "terminal", type: "session.completed", payload: {} };
    case "session.error": {
      const error = event.error as { message?: unknown } | undefined;
      return {
        kind: "terminal",
        type: "session.failed",
        payload: { message: str(error?.message) ?? "The Managed Agents session failed." },
      };
    }
    default:
      return { kind: "ignore" };
  }
}
