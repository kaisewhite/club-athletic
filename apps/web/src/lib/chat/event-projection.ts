// Ported from edge/apps/web-platform/src/lib/execution/event-projection.ts; trip adaptations are local.
// Browser-only transcript projection. The single reducer both the initial run
// load and every live SSE arrival derive through — render = f(rows). Extracted
// from the former mixed src/lib/api/activity.ts so the thin web client owns the
// transcript logic while the server keeps its response/SSE serializers.
import type { ActivityBullet, ActivityEvent, ActivityGroupItem, ActivityMetadata, AgentActivityEvent, AgentActivityKind, ConversationActivitySummary, ConversationPresentation, ConversationWarning, SessionEventRow, StreamDelta } from "./contracts";
import { classifyTool, describeToolGroup, toolRowLabel, type ToolKind } from "./tool-classify";
import { userFacingError } from "./state-copy";
import { hasProperty, isBoolean, isNonNullObject, isNumber, isString, type SharedInput } from "./type-guards";
import { parseAnswerSources } from "./sources";
import { summarizeToolCall, summarizeToolResult } from "./tool-presentation";

function asString(value: SharedInput): string | null {
  return isString(value) && value.trim() !== "" ? value.trim() : null;
}

function summarizeValue(value: SharedInput): string {
  /* v8 ignore start -- defensive: the only caller passes object payloads, so the null/string/number/boolean narrowing arms are unreachable */
  if (value === null || value === undefined) return "";
  if (isString(value)) return value;
  if (isNumber(value) || isBoolean(value)) return String(value);
  /* v8 ignore stop */
  return JSON.stringify(value);
}

function formatArgs(value: SharedInput): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (isString(value)) return value.trim() ? value : undefined;
  try {
    const json = JSON.stringify(value);
    return json && json !== "{}" && json !== "[]" ? json : undefined;
  } catch {
    return undefined;
  }
}

function formatResult(value: SharedInput): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (isString(value)) return value.trim() ? value : undefined;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatCostUsd(value: SharedInput): string | null {
  if (!isNumber(value) || Number.isNaN(value)) {
    return null;
  }

  return value.toLocaleString("en-US", {
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
    style: "currency",
  });
}

/** Pull the exact executed command line out of a shell tool's input payload. */
function extractCommand(input: SharedInput): string | undefined {
  if (isString(input)) return input.trim() || undefined;
  if (isNonNullObject(input)) {
    for (const key of ["command", "cmd", "script", "run", "shell"] as const) {
      if (hasProperty(input, key) && isString(input[key])) {
        const value = input[key].trim();
        if (value) return value;
      }
    }
    return formatArgs(input);
  }
  return undefined;
}

/** A non-tool activity row (notification, state write, etc.) rendered as a tool-kind item. */
function auxiliaryItem(tool: string, label: string, detail: string): ActivityGroupItem {
  return { tool, kind: "tool", label, connector: null, status: "ok", detail };
}

function payloadToolName(payload: SessionEventRow["payload"]): string {
  return asString(payload.toolName) ?? asString(payload.tool) ?? "tool";
}

function payloadInvocationId(payload: SessionEventRow["payload"]): string | null {
  return asString(payload.invocationId) ?? asString(payload.callId);
}

function toolItemFor(event: SessionEventRow): ActivityGroupItem {
  const eventTool = asString(event.payload.tool);
  const eventDetail = asString(event.payload.detail);
  if (eventTool && eventDetail) {
    return auxiliaryItem(eventTool, `Used ${eventTool}`, eventDetail);
  }

  if (event.type === "tool_call") {
    const toolName = payloadToolName(event.payload);
    const meta = classifyTool(toolName);
    // A skill load is a single line naming the skill; its body is harness
    // plumbing and is never surfaced (no args, no result, no expansion).
    if (meta.kind === "skill") {
      const input = event.payload.input;
      const skillName =
        isNonNullObject(input) && hasProperty(input, "skill") && isString(input.skill)
          ? input.skill
          : isNonNullObject(input) && hasProperty(input, "name") && isString(input.name)
            ? input.name
            : isNonNullObject(input) && hasProperty(input, "skillName") && isString(input.skillName)
              ? input.skillName
              : null;
      return { tool: toolName, kind: "skill", connector: null, label: toolRowLabel(meta, skillName), status: "ok", detail: "" };
    }
    const args = formatArgs(event.payload.input);
    const command = meta.kind === "command" ? extractCommand(event.payload.input) : undefined;
    const presentation = summarizeToolCall(toolName, meta, event.payload.input);
    // A call starts pending; its paired result later resolves it to ok/error.
    const callItem: ActivityGroupItem = {
      tool: toolName,
      kind: meta.kind,
      connector: meta.connector,
      label: presentation.label,
      status: "pending",
      detail: "",
      params: presentation.params,
      outcome: presentation.outcome ?? "Waiting for result…",
      input: presentation.input,
    };
    if (command) callItem.command = command;
    if (args) callItem.args = args;
    return callItem;
  }

  if (event.type === "tool_result") {
    const toolName = payloadToolName(event.payload);
    const meta = classifyTool(toolName);
    // Never surface the loaded skill body, at any expansion level.
    if (meta.kind === "skill") {
      return { tool: toolName, kind: "skill", connector: null, label: toolRowLabel(meta), status: "ok", detail: "" };
    }
    const error = asString(event.payload.error) ?? (event.payload.ok === false ? "Tool reported an error." : null);
    const rawResult = event.payload.result ?? event.payload.output;
    const result = formatResult(rawResult);
    const presentation = summarizeToolResult(toolName, rawResult, error);
    const resultItem: ActivityGroupItem = {
      tool: toolName,
      kind: meta.kind,
      connector: meta.connector,
      label: toolRowLabel(meta),
      status: presentation.status,
      detail: "",
      outcome: presentation.outcome!,
      output: presentation.output,
    };
    if (result) resultItem.result = result;
    if (presentation.error) resultItem.error = presentation.error;
    return resultItem;
  }

  if (event.type === "notification") {
      const kind = asString(event.payload.kind) ?? "notification";
      const channel = asString(event.payload.channel);
    return auxiliaryItem("notification", "Sent a notification", channel ? `${kind} to ${channel}` : kind);
  }

    if (event.type === "state_write") {
      return auxiliaryItem("state", "Saved state", "Saved conversation state.");
    }

    if (event.type === "check") {
      const checkNumber = event.payload.checkNumber ?? null;
      return auxiliaryItem(checkNumber ? `check ${checkNumber}` : "check", "Ran a check", asString(event.payload.text) ?? "Check completed.");
    }

    if (event.type === "send-check-metrics") {
      const latencyMs = event.payload.latencyMs !== undefined ? `${event.payload.latencyMs}ms` : null;
      const costUsd = formatCostUsd(event.payload.costUsd);
    return auxiliaryItem(
      "check metrics",
      "Recorded metrics",
      [latencyMs, costUsd].filter((part): part is string => Boolean(part)).join(" · ") || "Metrics recorded.",
    );
  }

    if (event.type === "lifecycle") {
    // The full sentence IS the row label so the transcript line is readable
    // (e.g. "Closed by reconciliation (success)") — a detail-only row would
    // never surface its text.
      const name = asString(event.payload.name) ?? "lifecycle";
      const trigger = asString(event.payload.trigger);
    return auxiliaryItem("lifecycle", trigger ? `${name} (${trigger})` : name, "");
  }

  /* v8 ignore start -- defensive: event.payload always summarizes to a non-empty string, so the "Event recorded." fallback is unreachable */
  return auxiliaryItem(event.type, `Used ${event.type}`, summarizeValue(event.payload) || "Event recorded.");
  /* v8 ignore stop */
}

function summaryBullets(value: SharedInput): ActivityBullet[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isNonNullObject(entry)) return [];
    const label = "label" in entry && isString(entry.label) ? entry.label : null;
    const text = "text" in entry && isString(entry.text) ? entry.text : null;
    return label && text ? [{ label, text }] : [];
  });
}

function payloadThreadId(event: SessionEventRow): string | null {
  if (asString(event.payload.threadRole) === "root") return null;
  return asString(event.payload.threadId);
}

function eventKey(event: SessionEventRow): string {
  return asString(event.payload.activityEventId) ?? event.id;
}

function projectionIdentity(event: SessionEventRow): string | null {
  // Canonical identities already include child-thread scope. Raw provider IDs
  // may be reused in another thread and must not collapse those durable rows.
  const canonicalEventId = asString(event.payload.canonicalEventId);
  if (canonicalEventId) return `${event.type}:canonical:${canonicalEventId}`;
  const providerEventId = asString(event.payload.providerEventId);
  if (providerEventId) return `${event.type}:provider:${payloadThreadId(event) ?? "__root__"}:${providerEventId}`;
  return null;
}

function dedupeProjectionEvents(events: SessionEventRow[]): SessionEventRow[] {
  const projected: SessionEventRow[] = [];
  const indexes = new Map<string, number>();
  for (const event of events) {
    const identity = projectionIdentity(event);
    if (!identity) {
      projected.push(event);
      continue;
    }
    const existingIndex = indexes.get(identity);
    if (existingIndex === undefined) {
      indexes.set(identity, projected.length);
      projected.push(event);
      continue;
    }
    const existing = projected[existingIndex]!;
    projected[existingIndex] = {
      ...event,
      id: existing.id,
      seq: existing.seq,
      payload: { ...existing.payload, ...event.payload },
    };
  }
  return projected;
}

function isCanonicalAgentMessage(event: SessionEventRow): boolean {
  const role = asString(event.payload.threadRole);
  return event.type === "message" && (role === "root" || role === "child");
}

function messageScope(event: SessionEventRow): string {
  return payloadThreadId(event) ?? "__root__";
}

function finalActivityMessageKeys(events: SessionEventRow[]): Set<string> {
  const terminalScopes = new Set<string>();
  if (events.some((event) => event.type === "turn.completed" || event.type === "session.completed")) {
    terminalScopes.add("__root__");
  }
  for (const event of events) {
    if (event.type === "thread_status" && asString(event.payload.threadStatus) === "idle") {
      const threadId = payloadThreadId(event);
      if (threadId) terminalScopes.add(threadId);
    }
  }

  const latestByScope = new Map<string, SessionEventRow>();
  for (const event of events) {
    const isMessage = event.type === "message" || event.type === "thread_message" || event.type === "summary";
    if (!isMessage || !asString(event.payload.text)) continue;
    if (asAgentActivityKind(event.payload.activityKind) === null && asString(event.payload.activityLabel) === null) continue;
    const scope = messageScope(event);
    if (!terminalScopes.has(scope)) continue;
    latestByScope.set(scope, event);
  }

  return new Set([...latestByScope.values()].map(eventKey));
}

function isProgressOnlyEvent(event: SessionEventRow, finalMessageKeys: ReadonlySet<string> = new Set()): boolean {
  if (isCanonicalAgentMessage(event)) {
    return false;
  }
  if (finalMessageKeys.has(eventKey(event))) {
    return false;
  }
  if ((event.type === "message" || event.type === "thread_message" || event.type === "reasoning" || event.type === "summary") && asString(event.payload.text)) {
    return false;
  }
  if (event.type === "agent_activity" || event.type === "thread_status" || event.type === "thinking" || event.type === "agent.thinking") {
    return true;
  }
  return (event.type === "message" || event.type === "reasoning" || event.type === "summary")
    && (asAgentActivityKind(event.payload.activityKind) !== null || asString(event.payload.activityLabel) !== null);
}

function activityMetadata(event: SessionEventRow): ActivityMetadata {
  const metadata: ActivityMetadata = {};
  const threadId = payloadThreadId(event);
  const parentThreadId = asString(event.payload.parentThreadId);
  const threadRole = asString(event.payload.threadRole);
  const agentName = asString(event.payload.agentName);
  const threadStatus = asString(event.payload.threadStatus);
  const canonicalEventId = asString(event.payload.canonicalEventId);
  const providerEventId = asString(event.payload.providerEventId);
  const activityKind = asAgentActivityKind(event.payload.activityKind);
  const activityLabel = asString(event.payload.activityLabel);
  const toolName = asString(event.payload.toolName) ?? asString(event.payload.tool);
  if (threadId) metadata.threadId = threadId;
  if (parentThreadId) metadata.parentThreadId = parentThreadId;
  if (threadRole === "root" || threadRole === "child") metadata.threadRole = threadRole;
  if (agentName) metadata.agentName = agentName;
  if (threadStatus) metadata.threadStatus = threadStatus;
  if (canonicalEventId) metadata.canonicalEventId = canonicalEventId;
  if (providerEventId) metadata.providerEventId = providerEventId;
  if (activityKind) metadata.activityKind = activityKind;
  if (activityLabel) metadata.activityLabel = activityLabel;
  if (toolName) metadata.toolName = toolName;
  return metadata;
}

function toolGroupScope(event: SessionEventRow): string {
  return [
    payloadThreadId(event) ?? "__root__",
    asString(event.payload.agentName) ?? "__agent__",
  ].join(":");
}

/**
 * THE transcript projection: group ordered SessionEvent rows into the local UI
 * activity format. This is the single reducer both the initial load and every
 * live SSE arrival derive through — render = f(rows). There is deliberately no
 * incremental row-at-a-time variant; two paths is how call/result pairing and
 * lifecycle application drift apart.
 */
export function mapSessionEventsToConversationActivity(
  events: SessionEventRow[],
  inheritedFinalMessageKeys?: ReadonlySet<string>,
): ActivityEvent[] {
  const projectionEvents = dedupeProjectionEvents(events);
  const mapped: ActivityEvent[] = [];
  const finalMessageKeys = inheritedFinalMessageKeys ?? finalActivityMessageKeys(projectionEvents);
  let groupedStartId: string | null = null;
  let groupedScope: string | null = null;
  let groupedItems: ActivityGroupItem[] = [];
  // Pairing is by call id, not adjacency: a tool_result resolves its tool_call
  // wherever that call landed — including a group already flushed by interim
  // narration. Each entry records the item list holding the call (the flushed
  // group keeps the same array reference) and the item's index within it.
  const callSites = new Map<string, { list: ActivityGroupItem[]; index: number }>();

  const flushGroup = () => {
    if (!groupedStartId || groupedItems.length === 0) {
      return;
    }
    // Recompute the header from the items so counts + kinds are always exact,
    // independent of any label persisted on the row payloads.
    mapped.push({
      id: groupedStartId,
      items: groupedItems,
      kind: "group",
      label: groupedItems.length === 1
        ? groupedItems[0]!.label
        : describeToolGroup(
            // SAFETY: grouped activity items only store the four tool kinds tracked by the reducer.
            groupedItems.map((item) => item.kind as ToolKind),
          ),
    });
    groupedStartId = null;
    groupedScope = null;
    groupedItems = [];
  };

  for (const event of projectionEvents) {
    if (event.type === "instructions") {
      flushGroup();
      mapped.push({
        id: asString(event.payload.activityEventId) ?? event.id,
        kind: "instructions",
        text: asString(event.payload.text) ?? "",
        ...activityMetadata(event),
      });
      continue;
    }

    // "message" is finalized assistant text; "reasoning" is the older type name
    // for the same thing (pre-streaming rows and seed data) — both render as prose.
    if ((event.type === "message" || event.type === "reasoning") && !isProgressOnlyEvent(event, finalMessageKeys)) {
      flushGroup();
      const answer = parseAnswerSources(asString(event.payload.text) ?? "");
      mapped.push({
        id: asString(event.payload.activityEventId) ?? event.id,
        kind: "prose",
        text: answer.body,
        sourceSections: answer.sources.map((source) => source.id),
        ...activityMetadata(event),
      });
      continue;
    }

    if (event.type === "thinking") {
      flushGroup();
      continue;
    }

    if (event.type === "summary") {
      flushGroup();
      mapped.push({
        bullets: summaryBullets(event.payload.bullets),
        id: asString(event.payload.activityEventId) ?? event.id,
        kind: "summary",
        text: asString(event.payload.text) ?? "Summary",
      });
      continue;
    }

    if (event.type === "error") {
      flushGroup();
      mapped.push({
        id: asString(event.payload.activityEventId) ?? event.id,
        kind: "error",
        label: asString(event.payload.label) ?? "Conversation error",
        // Every user-visible error string passes through the sanitizer: raw
        // provider/runtime messages never render (the run header already
        // follows this rule via conversationFailureCopy).
        text: userFacingError(asString(event.payload.text) ?? asString(event.payload.message)),
      });
      continue;
    }

    // A persisted user chat message renders as a user bubble in seq order.
    // Only validated persisted text is shown — never optimistic input.
    if (event.type === "user_message") {
      flushGroup();
      mapped.push({
        id: event.id,
        kind: "user",
        text: asString(event.payload.text) ?? "",
        failed: event.payload.delivery === "failed",
        // Still on its way to the agent; the transcript shows "Sending…".
        pending: event.payload.delivery === "pending",
        // Held behind the working turn; the agent reads it at the next boundary.
        queued: event.payload.delivery === "queued",
        ...(event.payload.upload ? { upload: event.payload.upload } : {}),
      });
      continue;
    }

    // Terminal lifecycle rows close the run's state machine and end live SSE
    // tails; a failure surfaces inline, a clean ending adds no visual row.
    if (event.type === "session.failed" || event.type === "turn.failed") {
      flushGroup();
      mapped.push({
        id: event.id,
        kind: "error",
        label: "Conversation error",
        text: userFacingError(asString(event.payload.message)),
      });
      continue;
    }
    if (
      event.type === "session.completed" ||
      event.type === "session.cancelled" ||
      event.type === "turn.completed" ||
      event.type === "turn.cancelled"
    ) {
      continue;
    }

    if (event.type === "provider-usage") {
      flushGroup();
      continue;
    }

    if (event.type === "agent_activity" || isProgressOnlyEvent(event, finalMessageKeys)) {
      flushGroup();
      continue;
    }

    const invocationId = payloadInvocationId(event.payload);
    if (event.type === "tool_result" && invocationId && callSites.has(invocationId)) {
      const site = callSites.get(invocationId)!;
      const call = site.list[site.index]!;
      const resultItem = toolItemFor(event);
      const mergedItem = {
        ...call,
        detail: call.detail || resultItem.detail,
        status: resultItem.status,
        outcome: resultItem.outcome ?? call.outcome,
        output: resultItem.output ?? call.output,
      };
      if (resultItem.result) mergedItem.result = resultItem.result;
      if (resultItem.error) mergedItem.error = resultItem.error;
      site.list[site.index] = mergedItem;
      continue;
    }

    const nextScope = toolGroupScope(event);
    if (!groupedStartId) {
      groupedStartId = asString(event.payload.activityEventId) ?? `${event.id}:group`;
      groupedScope = nextScope;
    } else if (groupedScope !== nextScope) {
      flushGroup();
      groupedStartId = asString(event.payload.activityEventId) ?? `${event.id}:group`;
      groupedScope = nextScope;
    }
    if (event.type === "tool_result" && invocationId) {
      // The matching call is outside this event window (bounded replay page or a
      // genuinely missing call row). Render the result honestly as its own row,
      // but surface the pairing miss — never a silent second row.
      console.warn(`[conversations] unmatched tool_result for invocation ${invocationId} (${asString(event.payload.toolName) ?? "tool"})`);
    }

    const nextIndex = groupedItems.push(toolItemFor(event)) - 1;
    if (event.type === "tool_call" && invocationId) {
      callSites.set(invocationId, { list: groupedItems, index: nextIndex });
    }
  }

  flushGroup();
  return mapped;
}

function isTranscriptEvent(event: ActivityEvent): boolean {
  if (event.kind === "group" || event.kind === "subagent") return false;
  // Child-thread commentary (activityKind set AND threadId set) is progress
  // feedback for the sidebar activity strip — not narrative transcript content.
  if (event.kind === "prose" && event.activityKind && event.threadId) return false;
  return true;
}

function isToolGroup(event: ActivityEvent): event is Extract<ActivityEvent, { kind: "group" }> {
  return event.kind === "group";
}

function mapSessionEventsToTranscript(events: SessionEventRow[]): ActivityEvent[] {
  return mapSessionEventsToConversationActivity(events).filter(isTranscriptEvent);
}

export function summarizeConversationActivity(activity: ActivityEvent[]): ConversationActivitySummary {
  const items = activityGroupItems(activity);
  return {
    totalToolCalls: items.length,
    runningToolCalls: items.filter((item) => item.status === "pending").length,
    failedToolCalls: items.filter((item) => item.status === "error").length,
    commandCalls: items.filter((item) => item.kind === "command").length,
    skillCalls: items.filter((item) => item.kind === "skill").length,
    lookupCalls: items.filter((item) => item.kind === "lookup").length,
  };
}

function activityGroupItems(activity: ActivityEvent[]): ActivityGroupItem[] {
  return activity.flatMap((event) => {
    if (isToolGroup(event)) return event.items;
    if (event.kind === "subagent") return activityGroupItems(event.events);
    return [];
  });
}

function activityToolGroups(activity: ActivityEvent[]): Array<Extract<ActivityEvent, { kind: "group" }>> {
  return activity.flatMap((event) => {
    if (isToolGroup(event)) return [event];
    if (event.kind === "subagent") return activityToolGroups(event.events);
    return [];
  });
}

function warningMessageForToolError(item: ActivityGroupItem): string {
  const label = item.connector ? `${item.connector}: ${item.label}` : item.label;
  return `${label} failed.`;
}

function eventHasTerminalCompletion(event: SessionEventRow): boolean {
  return event.type === "turn.completed" || event.type === "session.completed";
}

function eventIsAssistantResult(event: SessionEventRow): boolean {
  return (event.type === "message" || event.type === "summary") && asString(event.payload.text) !== null;
}

export function deriveConversationWarnings(events: SessionEventRow[], activity: ActivityEvent[]): ConversationWarning[] {
  const warnings: ConversationWarning[] = [];
  const seenErrors = new Set<string>();
  for (const group of activityToolGroups(activity)) {
    for (const item of group.items) {
      if (item.status !== "error") continue;
      const key = `${group.id}:${item.label}:${item.error ?? ""}`;
      if (seenErrors.has(key)) continue;
      seenErrors.add(key);
      warnings.push({
        code: "tool_error",
        message: warningMessageForToolError(item),
        eventIds: [group.id],
      });
    }
  }

  const toolRows = events.filter((event) => event.type === "tool_call" || event.type === "tool_result");
  const terminal = events.find(eventHasTerminalCompletion);
  if (terminal && toolRows.length > 0) {
    const lastToolSeq = Math.max(...toolRows.map((event) => event.seq));
    const hasAssistantAfterTool = events.some((event) => event.seq > lastToolSeq && event.seq < terminal.seq && eventIsAssistantResult(event));
    if (!hasAssistantAfterTool) {
      warnings.push({
        code: "missing_final_result",
        message: "The run ended without a final agent result after tool activity.",
        eventIds: [terminal.id],
      });
    }
  }

  return warnings;
}

function asAgentActivityKind(value: SharedInput): AgentActivityKind | null {
  switch (value) {
    case "commentary":
    case "reasoning_summary":
    case "tool_started":
    case "tool_completed":
    case "model_request":
    case "status":
    case "approval":
      return value;
    default:
      return null;
  }
}

function activityEventFromRow(event: SessionEventRow): AgentActivityEvent | null {
  const activityKind = asAgentActivityKind(event.payload.activityKind);
  const activityLabel = asString(event.payload.activityLabel);
  if (!activityKind || !activityLabel) return null;

  const text = asString(event.payload.text);
  const toolName = asString(event.payload.toolName);
  const threadId = asString(event.payload.threadId);
  const parentThreadId = event.payload.parentThreadId === null ? null : asString(event.payload.parentThreadId);
  const agentName = asString(event.payload.agentName);
  const threadStatus = asString(event.payload.threadStatus);

  const activity: AgentActivityEvent = {
    id: asString(event.payload.activityEventId) ?? event.id,
    activityKind,
    activityLabel,
  };
  if (text) activity.text = text;
  if (toolName) activity.toolName = toolName;
  if (threadId) activity.threadId = threadId;
  if (event.payload.parentThreadId === null || parentThreadId) activity.parentThreadId = parentThreadId;
  if (agentName) activity.agentName = agentName;
  if (threadStatus) activity.threadStatus = threadStatus;
  return activity;
}

function inlineActivityEventFromRow(event: SessionEventRow): AgentActivityEvent | null {
  if (event.type === "message" || event.type === "reasoning" || event.type === "summary" || event.type === "error") return null;
  if (
    event.type === "session.status_idle" ||
    event.type === "turn.started" ||
    event.type === "turn.completed" ||
    event.type === "session.completed" ||
    event.type === "turn.failed" ||
    event.type === "session.failed" ||
    event.type === "session.error" ||
    event.type === "turn.cancelled" ||
    event.type === "session.cancelled"
  ) return null;
  if (event.type === "tool_result") return null;
  if (event.type === "thinking" || event.type === "agent.thinking") {
    return { id: event.id, activityKind: "status", activityLabel: "" };
  }
  if (event.type === "thread_status") {
    const threadStatus = asString(event.payload.threadStatus);
    const agentName = asString(event.payload.agentName);
    if (threadStatus === "running" && agentName) {
      return {
        id: asString(event.payload.activityEventId) ?? event.id,
        activityKind: "commentary",
        activityLabel: `${agentName} is active...`,
      };
    }
    return null;
  }
  const explicit = activityEventFromRow(event);
  if (!explicit) return null;
  if (explicit.activityKind === "status" || explicit.activityKind === "tool_completed") return null;
  return explicit;
}

function activityEventFromToolRow(event: SessionEventRow): AgentActivityEvent | null {
  if (event.type !== "tool_call") return null;
  const explicit = activityEventFromRow(event);
  if (explicit) return explicit;
  const item = toolItemFor(event);
  const activity: AgentActivityEvent = {
    id: asString(event.payload.activityEventId) ?? event.id,
    activityKind: "tool_started",
    activityLabel: item.label,
  };
  const toolName = asString(event.payload.toolName);
  const threadId = asString(event.payload.threadId);
  const agentName = asString(event.payload.agentName);
  if (toolName) activity.toolName = toolName;
  if (threadId) activity.threadId = threadId;
  if (agentName) activity.agentName = agentName;
  return activity;
}

function currentActivityFromDelta(delta: StreamDelta): AgentActivityEvent | null {
  const text = delta.text.trim();
  const activityLabel = delta.activityLabel?.trim() || text;
  if (!activityLabel) return null;
  const activity: AgentActivityEvent = {
    id: `delta-${delta.blockId}`,
    activityKind: asAgentActivityKind(delta.activityKind) ?? "commentary",
    activityLabel,
  };
  if (activity.activityKind === "tool_completed") return null;
  if (text) activity.text = text;
  if (delta.toolName) activity.toolName = delta.toolName;
  if (delta.threadId) activity.threadId = delta.threadId;
  if (delta.parentThreadId !== undefined) activity.parentThreadId = delta.parentThreadId;
  if (delta.agentName) activity.agentName = delta.agentName;
  return activity;
}

function projectCurrentAgentActivity(events: SessionEventRow[], deltas: StreamDelta[] = []): AgentActivityEvent | null {
  let current: AgentActivityEvent | null = null;
  for (const event of dedupeProjectionEvents(events)) {
    if (
      event.type === "turn.completed" ||
      event.type === "turn.cancelled" ||
      event.type === "turn.failed" ||
      (event.type === "state_frame" && event.payload.runtimeStatus === "waiting" && event.payload.activeRequestIdPresent !== true)
    ) {
      current = null;
      continue;
    }
    if ((event.type === "message" || event.type === "summary") && !isProgressOnlyEvent(event)) {
      current = null;
      continue;
    }
    const activity = activityEventFromToolRow(event) ?? inlineActivityEventFromRow(event);
    if (activity) current = activity;
  }
  for (const delta of deltas) {
    if (delta.variant === "message" && !delta.activityKind && !delta.activityLabel) {
      current = null;
      continue;
    }
    const activity = currentActivityFromDelta(delta);
    if (activity) current = activity;
  }
  return current;
}

function formatCurrentActivity(activity: AgentActivityEvent | null): string | null {
  if (!activity) return null;
  const label = activity.activityLabel.trim();
  if (!label) return null;
  if (!activity.agentName || activity.activityKind === "status" || activity.activityKind === "approval") {
    return label;
  }
  return `${activity.agentName} is ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

export function projectCurrentAgentActivityText(events: SessionEventRow[], deltas: StreamDelta[] = []): string | null {
  return formatCurrentActivity(projectCurrentAgentActivity(events, deltas));
}

export function projectCurrentAgentActivityIndicatorOnly(events: SessionEventRow[], deltas: StreamDelta[] = []): boolean {
  const activity = projectCurrentAgentActivity(events, deltas);
  return Boolean(activity && formatCurrentActivity(activity) === null);
}

export function mapSessionEventsToPresentation(events: SessionEventRow[]): ConversationPresentation {
  const projectionEvents = dedupeProjectionEvents(events);
  const activity = mapSessionEventsToConversationActivity(projectionEvents);
  const currentActivity = projectCurrentAgentActivity(projectionEvents);
  const currentActivityText = formatCurrentActivity(currentActivity);
  return {
    transcript: activity.filter(isTranscriptEvent),
    activity,
    currentActivity: currentActivityText,
    currentActivityIndicatorOnly: Boolean(currentActivity && currentActivityText === null),
    activitySummary: summarizeConversationActivity(activity),
    warnings: deriveConversationWarnings(projectionEvents, activity),
  };
}

/** Backward-compatible name for the user-facing transcript projection. */
export function mapSessionEventsToActivity(events: SessionEventRow[]): ActivityEvent[] {
  return mapSessionEventsToTranscript(events);
}

/**
 * Insert one arriving row in seq order, replacing any same-seq duplicate.
 * Replays and reconnect overlaps are therefore idempotent by construction —
 * the derived transcript cannot double-render a redelivered row.
 */
export function upsertSessionEventRow(rows: SessionEventRow[], row: SessionEventRow): SessionEventRow[] {
  const identity = projectionIdentity(row);
  if (identity) {
    const duplicateIndex = rows.findIndex((existing) => projectionIdentity(existing) === identity);
    if (duplicateIndex !== -1) {
      const next = [...rows];
      const existing = next[duplicateIndex]!;
      next[duplicateIndex] = {
        ...row,
        id: existing.id,
        seq: existing.seq,
        payload: { ...existing.payload, ...row.payload },
      };
      return next;
    }
  }
  const index = rows.findIndex((existing) => existing.seq >= row.seq);
  if (index === -1) return [...rows, row];
  if (rows[index]!.seq === row.seq) {
    const next = [...rows];
    next[index] = row;
    return next;
  }
  return [...rows.slice(0, index), row, ...rows.slice(index)];
}
