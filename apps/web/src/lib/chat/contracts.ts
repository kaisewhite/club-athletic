// Ported chat contracts from edge/apps/api/src/contracts.ts and edge/apps/web-platform/src/types.ts.
import type { SharedInput } from "./type-guards";
import type { SourceSection } from "./sources";

export type ConversationStatus = "running" | "completed" | "failed" | "stopped";

export interface SessionEventBullet {
  label: string;
  text: string;
}

export interface SessionEventUsage {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface SessionEventPayload extends Record<string, unknown> {
  upload?: ChatUploadDisplay;
  sourceSections?: SourceSection[];
  activityEventId?: string;
  canonicalEventId?: string;
  providerEventId?: string;
  bullets?: SessionEventBullet[];
  callId?: string;
  channel?: string;
  checkNumber?: number;
  costUsd?: number;
  data?: string | number | boolean | object | null | undefined;
  delivery?: string;
  detail?: string;
  error?: string;
  formatUsed?: string;
  input?: string | number | boolean | object | null | undefined;
  invocationId?: string;
  kind?: string;
  label?: string;
  latencyMs?: number;
  message?: string;
  name?: string;
  ok?: boolean;
  output?: string | number | boolean | object | null | undefined;
  payload?: string | number | boolean | object | null | undefined;
  response?: string | number | boolean | object | null | undefined;
  result?: string | number | boolean | object | null | undefined;
  requestId?: string;
  runtimeStatus?: string | null;
  status?: string;
  text?: string;
  tool?: string;
  toolName?: string;
  threadId?: string;
  parentThreadId?: string | null;
  threadRole?: ThreadRole;
  agentName?: string;
  threadStatus?: string;
  activityKind?: AgentActivityKind;
  activityLabel?: string;
  activeRequestIdPresent?: boolean;
  activeTurnId?: string | null;
  pendingWakeupAt?: string | null;
  waitingOnApproval?: boolean;
  trigger?: string;
  usage?: SessionEventUsage;
  webhookStatus?: number;
}


export interface ActivityGroupItem {
  tool: string;
  detail: string;
  /** Classified kind driving the row label + group header (never string-matched in JSX). */
  kind: "command" | "skill" | "lookup" | "tool";
  /** Per-row label, e.g. "Ran a command", "Used Trip: Get rooms", "Found tools". */
  label: string;
  /** Owning connector for a named tool, when known. */
  connector?: string | null;
  /** Pairing outcome: a call with no result is "pending"; a failed result is "error". */
  status: "ok" | "error" | "pending";
  /** Human-readable identifying inputs shown before any raw JSON. */
  params?: Array<{ label: string; value: string }>;
  /** One-line outcome summary derived from the tool result or error. */
  outcome?: string;
  /** The exact command line executed (command kind only). */
  command?: string;
  args?: string;
  error?: string;
  input?: SharedInput;
  output?: SharedInput;
  result?: string;
}

export interface ActivityBullet {
  label: string;
  text: string;
}

export type AgentActivityKind =
  | "commentary"
  | "reasoning_summary"
  | "tool_started"
  | "tool_completed"
  | "model_request"
  | "status"
  | "approval";

export type ThreadRole = "root" | "child";

export interface CanonicalEventMetadata {
  canonicalEventId?: string;
  providerEventId?: string;
}

export interface ThreadMetadata {
  threadId?: string;
  parentThreadId?: string | null;
  threadRole?: ThreadRole;
  agentName?: string;
  threadStatus?: "created" | "running" | "idle" | "terminated" | "rescheduled" | string;
}

export interface ActivityMetadata extends ThreadMetadata, CanonicalEventMetadata {
  activityKind?: AgentActivityKind;
  activityLabel?: string;
  toolName?: string;
}

export interface AgentActivityEvent extends ActivityMetadata {
  id: string;
  activityKind: AgentActivityKind;
  activityLabel: string;
  text?: string;
}

export type ActivityEvent =
  | ({ id: string; kind: "instructions"; text: string } & ActivityMetadata)
  | ({ id: string; kind: "prose"; text: string; sourceSections?: SourceSection[] } & ActivityMetadata)
  | ({ id: string; kind: "reasoning"; text: string } & ActivityMetadata)
  | { id: string; kind: "group"; label: string; items: ActivityGroupItem[] }
  | {
      id: string;
      kind: "subagent";
      threadId: string;
      agentName: string;
      status?: "created" | "running" | "idle" | "terminated" | "rescheduled" | string;
      events: ActivityEvent[];
    }
  | { id: string; kind: "summary"; text: string; bullets: ActivityBullet[] }
  | { id: string; kind: "error"; label: string; text: string }
  // A persisted user chat message. `failed` marks a delivery that never reached
  // the agent (rendered distinctly, never as a delivered message); `queued` was
  // accepted behind a running turn and reaches the agent at the next turn
  // boundary; `pending`
  // marks one still on its way, which the composer shows as "Sending…".
  | { id: string; kind: "user"; text: string; failed: boolean; pending: boolean; queued: boolean; upload?: ChatUploadDisplay };

export interface ConversationActivitySummary {
  totalToolCalls: number;
  runningToolCalls: number;
  failedToolCalls: number;
  commandCalls: number;
  skillCalls: number;
  lookupCalls: number;
}

export interface ConversationWarning {
  code: "tool_error" | "missing_final_result" | "unexpected_tool" | "duplicate_tool";
  message: string;
  eventIds: string[];
}

export interface ConversationPresentation {
  transcript: ActivityEvent[];
  activity: ActivityEvent[];
  currentActivity: string | null;
  currentActivityIndicatorOnly: boolean;
  activitySummary: ConversationActivitySummary;
  warnings: ConversationWarning[];
}

/**
 * One persisted session-event row as it crosses the wire. The transcript is
 * always DERIVED from ordered rows through one projection
 * (mapSessionEventsToActivity) — on initial load and on every live arrival —
 * so the browser holds no transcript state the database doesn't.
 */
export interface SessionEventRow {
  id: string;
  seq: number;
  type: string;
  payload: SessionEventPayload;
}

/**
 * One live token-stream frame for an in-flight assistant message or reasoning
 * block. `text` is the cumulative text so far (the relay sends cumulative, not
 * incremental); `done` marks the finalizing edge so viewers drop the transient
 * block once its durable row lands. Never persisted.
 */
export interface StreamDelta {
  blockId: string;
  variant: "message" | "reasoning";
  text: string;
  done: boolean;
  canonicalEventId?: string;
  providerEventId?: string;
  threadId?: string;
  parentThreadId?: string | null;
  threadRole?: ThreadRole;
  agentName?: string;
  activityKind?: AgentActivityKind;
  activityLabel?: string;
  toolName?: string;
}


export interface ConversationSessionStateFrame {
  /** Canonical session lifecycle: starting | active | waiting | closed. */
  runtimeStatus: string | null;
  /** Conversation turn status, so state frames can flip the pill without a refetch. */
  status: string;
  /** True while a send's Idempotency-Key claim is held (a turn is in flight). */
  activeRequestIdPresent: boolean;
  /** The provider turn id once turn.started arrived; null between turns. */
  activeTurnId: string | null;
  /** Scheduled wakeup time (always null without a scheduler). */
  pendingWakeupAt: string | null;
  /** True while the session waits on a human approval (HITL). */
  waitingOnApproval: boolean;
}

/** Browser-facing chat capability computed server-side from conversation + retention. */
export interface ConversationChatCapability {
  /** Whether the composer may send right now. True during a running turn: the message queues. */
  canSend: boolean;
  /** Why the input is disabled ("expired" drives the tooltip copy). */
  reason: "expired" | "closed" | "no_session" | null;
  /** Canonical session lifecycle value for the chat state machine. */
  runtimeStatus: string | null;
  /** Scheduled wakeup time (always null without a scheduler). */
  pendingWakeupAt: string | null;
  /** True while a turn is in flight, i.e. the session is live (the clients render Working…). */
  activeTurn: boolean;
  /** True while the session waits on a human approval. */
  waitingOnApproval: boolean;
}

/** Result of POST /api/chat/conversations/:conversationId/messages. */
export type ConversationMessageDeliveryMode = "queue" | "interrupt_replace";

export type SendConversationMessageResponse = {
  ok: true;
  seq: number;
  requestId?: string;
  conversationId?: string;
  sessionId?: string | null;
  threadId?: string | null;
  delivery?: "sent" | "queued";
} | { ok: false; error: string; status?: number };

/** Lightweight persisted state used to recover an interrupted live stream. */
export interface ConversationStatusSnapshot {
  status: ConversationStatus;
  lastEventSeq: number;
  finishedAt: string | null;
  error: string | null;
}

export interface CreateConversationResponse {
  conversationId: string;
  status: "running";
  runtimeStatus: "starting";
  lastEventSeq: number;
  firstEvent?: Omit<SessionEventRow, "id"> & { id?: string };
}


/** Safe retained attachment label; provider file/resource identities stay server-side. */
export interface ChatUploadDisplay {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ConversationDetails {
  id: string;
  tripId: string;
  status: ConversationStatus;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  events: SessionEventRow[];
  eventsTruncated: boolean;
  eventsCursor: number | null;
  lastEventSeq: number;
  agentSessionId: string | null;
  pendingWakeupAt: string | null;
  chat: ConversationChatCapability;
  presentation?: ConversationPresentation;
}
