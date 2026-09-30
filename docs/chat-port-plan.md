# §2.13 Chat Port Plan

> For the implementation task: follow this file in dependency order, using `superpowers:executing-plans`. This deliverable is a source-reading and port plan, not authorization to implement it. No implementation code accompanies it.

**Goal:** Port edge's Managed Agents → durable events → SSE → React chat into the existing standalone `apps/web`, then add the attachment and flight-intake adaptations required by §2.13a–c.

**Architecture:** Keep edge's event identities, durable-before-fan-out ingestion, cumulative transient blocks, subscribe/buffer/replay recovery, and row-derived React presentation. Collapse its API into React Router v7 framework resource routes behind the existing Express entry. Use the existing trip read helpers and separate write modules; do not introduce a workspace, separate API app, AI SDK chat loop, markdown renderer, or query cache.

**Tech stack:** Bun 1.4, React 19, React Router v7 framework mode, Express, Prisma/Neon, Anthropic Managed Agents SDK, Zod. Dependencies to add later are listed below; nothing was installed for this plan.

## 1. Governing constraint and observed baseline

The following is TODO.md §1's chat rule, verbatim:

> ### STRICT RULE — the chat is ported from `edge`, not invented
>
> **Do not guess at, design, or hand-roll the chat functionality.** `edge` already runs this exact path in production: a Managed Agent streams through `edge/apps/api`, which relays over SSE to a React client in `edge/apps/web-platform` that renders the streaming thread, tool activity, and the composer. It works. Port it.
>
> This means, without exception:
> - Read the `edge` files in §1.3 **before** writing any chat code. Not after, not "if stuck".
> - The transport, the event shape, the relay, the reconnect handling, and the React consumer come from `edge`. Change names and payload fields; do not redesign the mechanism.
> - No inventing an event protocol, no bespoke SSE parser, no custom `useState` streaming reducer, no guessing at how tool calls render mid-stream. All four already exist there.
> - If something in `edge` looks wrong or missing for our case, raise it as a decision — do not quietly substitute your own design.
> - Anything genuinely absent from `edge` (the file-attachment leg of the composer) is the **only** part where a package choice applies, and it still gets verified against docs before implementation.
>
> Applies equally to: the streaming endpoint, the message thread, the composer, tool-call display, error and abort handling, and the mobile chat layout.

Read on 2026-09-26: TODO §0, §1/§1.3/§1.5, §2.13a–c, §3.3 and Decisions, the decoded design, existing route/server/database files, and the edge sources inventoried below. Paths beginning `edge/` resolve beneath `/Volumes/Sandisk/repositories/kaisewhite/`; destination paths resolve beneath `/Volumes/Sandisk/repositories/kaisewhite/club-athletic/`. Counts are physical lines (`wc -l`) at inspection time, not estimates. This repository is on `main`, with no commits and a legitimate untracked baseline.

The accepted build/test/Neon state is supplied by the task: build exit 0, 81 tests across 8 files, all ten pages serving real data. Those checks were deliberately **not rerun** for this document-only task. No server, Prisma client, deploy script, or persistent process was started. No secret values from any `.env` were recorded or exposed; only the requested edge API key names were extracted. No `.env` was sourced.

Actual schema observations, not implementation changes: `Conversation` currently has `id`, `tripId`, `agentSessionId`, timestamps and relations; `Message` has role/content/sourceSections/uploadId but no event sequence, payload, or provider/request identity. `Upload.fileId` exists, but a second mounted file ID and resource ID/path do not. Eighteen existing tables are a sound baseline, not yet a literal equivalent of edge's execution event store. Additive schema work is therefore a later task, explicitly called out below.

## 2. Corrections to the reading list: the code wins

Where TODO's description and the real edge code disagree, **THE CODE WINS as the description of the port source**. Settled club-athletic Decisions still govern intentional adaptations; a discrepancy is not permission to replace the mechanism.

1. **Wrong client function for chat.** `edge/apps/web-platform/src/lib/api/index.ts:122` exports `streamImproveInstructions`, a POST to `/api/automations/improve-instructions`. Its `getReader()`/`TextDecoder` loop consumes **newline-delimited JSON** with `type: snapshot | complete | error`; it is not the execution SSE protocol. Its server counterpart, `edge/apps/api/src/lib/runtime/improve-instructions.ts`, uses AI SDK `streamText` for ephemeral instruction authoring. The correct chat functions in the same client file are `createExecutionStreamCursor` and `subscribeToExecutionStream` (starting around lines 568/586); they already parse SSE frames, use `AbortController`, and dispatch `activity`, `delta`, `state`, `done`, `error`. Port those, not the instruction editor and not a newly written parser.
2. **Wrong composer concurrency description.** TODO §1.3 calls the composer “disabled-while-streaming.” The actual `execution-chat-input.tsx`, `lib/execution/execution-chat-state.ts`, `send-execution-message.ts`, and provider pump implement sending while a turn runs: only an outstanding send POST gates a second send; acknowledged messages queue, and an optional **Interrupt & send now** submits `deliveryMode: interrupt_replace`. Drafts survive failures; the server persists the user row before provider delivery. The decoded trip design does disable send while loading. Keep edge's mechanism; decide the trip-facing queue/interrupt affordance explicitly (Q1), rather than pretending edge already matches the design.

Additional differences matter to the file map:

- The actual React route imports `lib/execution/event-projection.ts`, `lib/ui/stream-blocks.ts`, and `lib/execution/execution-chat-state.ts`. Merely copying `execution-stream.tsx` misses the consumer state machine. Its existing `useState` holds rows and ephemeral blocks; the prohibition is against inventing a replacement reducer, not against porting this code.
- Server `modules/executions/projections.ts` and browser `lib/execution/event-projection.ts` are **not identical**. The browser version has richer tool summaries/current activity and flattens activity differently. Use the browser projection for rendering, server serializers/bounding/capability helpers for HTTP; do not accidentally substitute the older server presentation.
- `edge/apps/api/src/contracts.ts`'s send-response interface omits `delivery`, but `executions.routes.ts` actually emits it and `edge/apps/web-platform/src/types.ts` includes it. The port contract includes optional `delivery: sent | queued`. Server presentation has `agentActivity`; browser presentation has `currentActivity` and `currentActivityIndicatorOnly`. Do not expose both as competing UI sources.
- D5 explicitly removes edge's markdown render/coalescing layer. D22 removes its route cache as the initial loading mechanism. D2/D21 replace Express route handlers with resource-route `loader`/`action` exports, not a second API deployment.
- The client wrapper's session resources currently accept **memory stores only**. The installed SDK also supports file resources and adding a resource to an existing session. Widening the wrapper is required; discovering the SDK facility is not a missing-infrastructure blocker.

## 3. Edge inventory

### 3.1 Required server files

| Real source path | Lines | Responsibility and relevant exports |
|---|---:|---|
| `edge/apps/api/src/lib/managed-agents/client.ts` | 218 | SDK wrapper; `MANAGED_AGENTS_BETA`, `ManagedAgentsClient`, `ManagedAgentSkillRef`, `CreateManagedAgentSessionOptions`, `createManagedAgentsClient`, `createManagedAgentSession`, `sendManagedAgentMessage`, `sendManagedAgentInterrupt`, `listManagedAgentSessionEvents`, `listManagedAgentThreads`, `listManagedAgentThreadEvents`, `streamManagedAgentThreadEvents`. Missing-skill retry currently strips skills. |
| `edge/apps/api/src/lib/managed-agents/config.ts` | 103 | Environment validation/agent-key resolution; `AGENT_KEYS`, `AgentKey`, `ManagedAgentsConfig`, `isAgentKey`, `parseManagedAgentsConfig`, `resolveAgentId`. Three edge agents; trading is required. |
| `edge/apps/api/src/lib/managed-agents/event-identity.ts` | 71 | `ManagedAgentThreadContext`, `threadRoleFromMetadata`, `canonicalEventIdFor`, `contextFromManagedAgentThread`, `contextFromManagedAgentEvent`, `contextForManagedAgentEvent`. Child identities are thread-qualified; sole root can supply missing thread context. |
| `edge/apps/api/src/lib/managed-agents/map-managed-agent-event.ts` | 281 | `MappedManagedAgentEvent`, `textFromContent`, `mapManagedAgentEvent`. Provider events → display/lifecycle/terminal/approval/ignore. This is the solved translation layer. |
| `edge/apps/api/src/lib/runtime/event-relay.ts` | 150 | `ExecutionEventRelay`, listener types, `createExecutionEventRelay`, singleton `executionEventRelay`. Three subscriber channels; latest cumulative block snapshots, no durable token writes. |
| `edge/apps/api/src/http/routes/executions.routes.ts` | 521 | `ExecutionRoutesDeps`, `createExecutionRoutes`. Detail/status/message/cancel plus SSE HTTP adapters; headers, cursor, heartbeat, recovery and serializers. Automation lists/reruns are out of trip scope. |
| `edge/apps/api/src/contracts.ts` | 413 | `SessionEventRow`, `StreamDelta`, metadata/activity types, `ExecutionSessionStateFrame`, `ExecutionChatCapability`, `ExecutionStatusSnapshot`, `SendExecutionMessageResponse`, execution details/presentation. Contains unrelated automation contracts to omit. |
| `edge/apps/api/src/modules/executions/projections.ts` | 1100 | `SessionEventRecord`, `ExecutionEventReplayPage`, `boundExecutionEvents`, `computeExecutionChatCapability`, `parseExecutionStatus`, `mapExecutionDetails`, activity/presentation projections, `upsertSessionEventRow`, all five `serializeExecutionStream*` functions. |
| `edge/apps/api/src/modules/executions/repository.server.ts` | 214 | `EXECUTION_DETAILS_EVENT_LIMIT = 200`, `EXECUTION_EVENT_REPLAY_PAGE_SIZE = 200`, `loadExecutionDetails`, `loadExecutionEventsAfter`, `loadExecutionSessionState`, `loadExecutionStatus`, `loadExecutionStatusSnapshot`; unrelated recent/activity/summary loaders. This file reads; it is not the event writer. |
| `edge/apps/api/src/lib/runtime/event-ingest.ts` | 62 | `IngestDeps`, `ingestSessionEvent`, re-exported `RawEveEvent`. Persist → update provider cursor → skip duplicate effects → lifecycle → relay. |
| `edge/apps/api/src/lib/runtime/close-execution.ts` | 225 | `isTerminalLifecycleEvent`, `applyLifecycleEvent`. Distinguishes turn completion from session termination; parks resumable sessions, fails queued sends on session end. Scheduler/notification coupling must be removed deliberately. |
| `edge/apps/api/src/lib/runtime/execution-state-frames.ts` | 60 | `setApprovalPending`, `isApprovalPending`, `buildExecutionStateFrame`, `publishExecutionState`. Transient approval flag; browser-safe state contains presence flags, never tokens. |

### 3.2 Required client files and actual route assembly

| Real source path | Lines | Responsibility and relevant exports |
|---|---:|---|
| `edge/apps/web-platform/src/lib/api/index.ts` | 1008 | `streamImproveInstructions` (comparison only); actual chat `createExecutionStreamCursor`, `subscribeToExecutionStream`, `fetchExecutionDetails`, `fetchExecutionStatus`, `fetchExecutionDetailsAfterStatus`, `sendExecutionChatMessage`, `cancelExecution`, `ApiError`. Same file also contains unrelated APIs/auth. |
| `edge/apps/web-platform/src/components/execution-stream.tsx` | 299 | `ExecutionStream`; internal event rendering, ordered tool groups, user delivery states/actions, auto-scroll. Imports markdown rendering/coalescing to remove under D5. |
| `edge/apps/web-platform/src/components/execution-chat-input.tsx` | 174 | `ExecutionChatInput`; controlled growing textarea, Enter/Shift+Enter, failure toast, queue/interrupt affordances, preserves drafts. No attachment control. |
| `edge/apps/web-platform/src/components/execution-tool-group.tsx` | 112 | `ToolGroup`, `ExecutionToolGroup`; pending/ok/error accordion with readable fields/raw details; suspends auto-scroll on expansion. |
| `edge/apps/web-platform/src/components/agent-activity-stream.tsx` | 16 | `AgentActivityStream`; current activity or indicator-only accessible status. It is a small live indicator, not a second transcript store. |
| `edge/apps/web-platform/src/components/error-boundary.tsx` | 45 | Class `ErrorBoundary`; render-failure containment and retry. Copy/coupling to edge Button must change. |
| `edge/apps/web-platform/src/components/loading-skeletons.tsx` | 89 | `TranscriptSkeleton`, `RouteListSkeleton`, `FormSkeleton`, `AdvisorSkeleton`, `DashboardActivitySkeleton`. Only transcript loading belongs in this port. |
| `edge/apps/web-platform/src/routes/Execution/execution-details.tsx` | 1099 | `ExecutionDetailsRoute`. Composes thread, composer, activity, row projection and blocks; owns acknowledged cursor, retry/reconnect, send acknowledgement validation, cleanup and state frames. Strip automation header/export/rerun/revision/cache integration. |
| `edge/apps/web-platform/src/routes/Execution/executions.tsx` | 104 | `ExecutionsRoute`; automation execution history/filter list. Read for context; no destination, because §2.13 does not request an organizer history UI. |
| `edge/apps/web-platform/src/types.ts` | 499 | Browser contract variant, including `ExecutionMessageDeliveryMode`, `SendExecutionMessageResponse.delivery`, current-activity presentation. Reconcile with server contracts as described above. |

### 3.3 Additional sources found by following imports

These are present, not blockers. They close holes in a port based only on the short TODO reading list.

| Real source path | Lines | Relevant exports/behavior |
|---|---:|---|
| `edge/apps/api/src/lib/runtime/execution-managed-agent-session.ts` | 788 | `executeManagedAgentSession`, `recoverRunningManagedAgentExecutions`, `recoverManagedAgentPumpForExecution`, input/dependency types. Opens provider event stream, aggregates preview fragments, discovers child threads, ingests full events, drains queued sends, parks at real boundaries, reconnects with capped backoff. On resume, lists durable history before opening the live stream. |
| `edge/apps/api/src/lib/runtime/session-events.ts` | 557 | `insertSessionEvent`, `insertSessionEventAllocating`, `appendUserMessageEvent`, `updateExecutionCursor`, `updateExecutionSessionState`, `loadResumableManagedAgentExecutions`, queue helpers, close helpers, row/session types. Allocates `nextEventSeq` in the insert transaction and dedupes provider/request IDs; unique-conflict recovery occurs outside the rolled-back transaction. |
| `edge/apps/api/src/lib/runtime/send-execution-message.ts` | 452 | `MAX_CHAT_MESSAGE_CHARS = 8192`, `sendExecutionMessage`, `loadExecutionChatState`, `findUserMessageByRequestId`, `markUserMessageDelivery`, delivery types. Durable user row before send, queue ownership, interrupt/replace, retention and session recovery. |
| `edge/apps/api/src/lib/runtime/recover-execution-stream.ts` | 268 | `RecoverExecutionStreamDeps`, `recoverExecutionStream`. Subscribe first, buffer concurrent rows, page replay, sorted flush, delta snapshots/current state, close only when appropriate. |
| `edge/apps/api/src/lib/runtime/managed-agent-transcript.ts` | 203 | `BackfillTranscriptDeps`, `backfillManagedAgentTranscript`, `ensureManagedAgentTranscript`. Lists session/thread events, sorts, dedupes, maps and ingests on cache miss. |
| `edge/apps/api/src/lib/runtime/start-chat.ts` | 66 | `MAX_CHAT_OPENING_MESSAGE_CHARS = 8192`, `findChatHost`, `startChat`, result/dependency types. Starts chats through hidden host automations; replace that domain indirection with `Conversation`. |
| `edge/apps/api/src/lib/runtime/active-pumps.ts` | 33 | `claimActivePump`, `registerActivePump`, `releaseActivePump`, `isPumpActive`, `activePumpCount`. In-process ownership registry. |
| `edge/apps/api/src/lib/runtime/cancel-execution.ts` | 120 | `requestExecutionCancel`, result/dependency types; sends provider interrupt, returns `stopping`, awaits provider evidence rather than declaring success. |
| `edge/apps/api/src/lib/runtime/stop-confirmation-timeout.ts` | 45 | `scheduleStopConfirmationTimeout`, input/type; after 30 seconds changes still-stopping state to `stop_failed`. |
| `edge/apps/api/src/lib/runtime/chat-config.ts` | 4 | `CHAT_RETENTION_DAYS = 30`. Product retention policy, not provider expiration. |
| `edge/apps/web-platform/src/lib/execution/event-projection.ts` | 829 | `mapSessionEventsToExecutionActivity`, `mapSessionEventsToPresentation`, `mapSessionEventsToActivity`, `upsertSessionEventRow`, `summarizeExecutionActivity`, `deriveExecutionWarnings`, current-activity functions. Browser's actual row reducer; pairs tools by invocation identity across intervening narration. |
| `edge/apps/web-platform/src/lib/execution/execution-chat-state.ts` | 95 | `initialChatUiState`, `chatUiReducer`, `canSubmitChat`, `chatDisabledReason`, state/event types, `CHAT_SEND_ACK_TIMEOUT_MS = 15000`. |
| `edge/apps/web-platform/src/lib/ui/stream-blocks.ts` | 52 | `applyStreamDelta`, `unreconciledStreamingBlocks`, `streamingBlockToEvent`. Replace cumulative text; remove done/reconciled blocks. |
| `edge/apps/web-platform/src/lib/execution/execution-controls.ts` | 72 | Disconnect sentinel, `shouldShowReconnectingChip`, `waitForTerminalExecutionStatus`, activity/control predicates. Run/rerun controls are not required. |
| `edge/apps/web-platform/src/lib/execution/execution-details-loader.ts` | 98 | `loadKnownCreatedExecutionDetails`, `loadExecutionDetailsAfterStatusWithRetry`, `executionLookupRetryPolicy`, `isExecutionNotFound`; bounded initial lookup retries. Framework loaders replace its initial SPA fetch ownership. |
| `edge/apps/web-platform/src/lib/execution/execution-live-activity.ts` | 26 | `resolveExecutionLiveActivity`; selects startup/current activity versus indicator-only. |
| `edge/apps/web-platform/src/lib/execution/tool-presentation.ts` | 287 | `summarizeToolCall`, `summarizeToolResult`; readable params/outcomes. Replace trading registry entries with trip tool metadata. |
| `edge/apps/web-platform/src/lib/hooks/use-auto-scroll.ts` | 92 | `useAutoScroll`, `isPinnedToBottom`, `suspendAutoScrollFollow`, `isAutoScrollFollowSuspended`; 80px pin threshold and 300ms layout-change grace. |
| `edge/apps/web-platform/src/lib/shared/tool-classify.ts` | 136 | `classifyTool`, `toolRowLabel`, `describeToolGroup`, `ToolKind`, `ToolMeta`; preserve grouping, change named-tool registry. |
| `edge/apps/web-platform/src/lib/shared/state-copy.ts` | 94 | `userFacingError`, `describeErrorForUser`, execution load/failure copy. Trip wording and server-side sanitization are adaptations. |
| `edge/apps/web-platform/src/lib/shared/type-guards.ts` | 25 | `isString`, `isNumber`, `isBoolean`, `isNonNullObject`, `hasProperty`, shared value types; imported by browser projection/presentation. |

### 3.4 Managed-agent control plane and configuration

| Real source path | Lines | Shape / relevant symbols |
|---|---:|---|
| `edge/apps/managed-agents/README.md` | 161 | Layout and control-plane/data-plane distinction. Its destructive-full-deploy paragraph is stale relative to scripts below. |
| `edge/apps/managed-agents/agents/trading-agent.agent.yaml` | 168 | `name`, object `model` with `id`/`effort`, `description`, block `system`, `tools`, logical-name `skills`, coordinator `multiagent.agents`. Shape only; never copy trading/operator-authority instructions into a public trip agent. |
| `edge/apps/managed-agents/agents/advisor.agent.yaml` | 103 | Read-only top-level agent; same configuration structure, `metadata`; no coordinator required. |
| `edge/apps/managed-agents/agents/automation-builder.agent.yaml` | 96 | Standalone top-level agent, string `model`, native agent toolset, API-calling skills. Most relevant domain-tool access example. |
| `edge/apps/managed-agents/sub-agents/discovery.agent.yaml` | 123 | Read-only child shape; toolset/skills and bounded role. No reason to add trip delegation merely because this exists. |
| `edge/apps/managed-agents/environments/default.environment.yaml` | 12 | `name`, `description`, `config.type: cloud`, package/MCP allowances, networking, metadata. Review access scope for the trip; do not copy trading names. |
| `edge/apps/managed-agents/skills/system/manage-automations/SKILL.md` | 91 | Frontmatter `name`/`description`/`nickname`, mechanics delegated to a script. Demonstrates CMA-native tool → skill script → server API rather than an AI SDK loop. |
| `edge/apps/managed-agents/skills/system/manage-automations/scripts/manage-automations.ts` | 290 | `runAutomationAction`, input/dependency/result types; bounded fetch, vault credential, server-owned validation, readable result envelope. Precedent for server-backed tools, not a flight tool implementation. |
| `edge/apps/managed-agents/tools/oxlint/anti-slop/index.ts` | 41 | Default lint-plugin export. Recursive `tools/` inventory contains lint tooling, **not** an undiscovered custom flight-tool registry. |
| `edge/apps/managed-agents/scripts/deploy.sh` | 714 | `resolve_agent_yaml`, `deploy_environment`, `deploy_agent_stdin`, `deploy_skill`, `deploy_all`, `deploy_agents_only`, `deploy_skills_only`. Uses ant for environment/agents, curl multipart for skills, Ruby YAML resolution, jq, state ID cache. |
| `edge/apps/managed-agents/scripts/deploy-agents.sh` | 20 | Sources deploy.sh and calls `deploy_agents_only`. |
| `edge/apps/managed-agents/scripts/deploy-skills.sh` | 20 | Sources deploy.sh and calls `deploy_skills_only`. |
| `edge/apps/managed-agents/scripts/test-deploy.sh` | 68 | Shell regression functions for clearing omitted MCP servers and detecting ant HTTP error output despite exit 0. Read, never executed: sourcing deploy.sh creates state directories and sources env. |
| `edge/apps/api/.env` | Not counted/read as content | Key names only: `CLAUDE_TRADING_AGENT_ID`, `CLAUDE_AUTOMATION_BUILDER_AGENT_ID`, `CLAUDE_ADVISOR_AGENT_ID`, `CLAUDE_MANAGED_ENVIRONMENT_ID`, `CLAUDE_MANAGED_VAULT_ID`. No values belong in this document. |

Actual application flow: environment create/update → recursively discovered skill roots uploaded/versioned → sub-agents resolved/applied → top-level agents resolved/applied. Logical skill names become `{type: custom, skill_id, version: latest}`; roster names become agent IDs. Agent update retrieves its current version and checks returned identity. Missing cache adopts exactly one active same-name agent; ambiguous names fail. **Code wins over README:** in-place skill versioning is the default; replacement/pruning require `MANAGED_AGENTS_REPLACE_SKILLS=1` / `MANAGED_AGENTS_PRUNE=1`. Do not run those scripts or copy their embedded IDs for this task. Later control-plane work belongs in `apps/managed-agents`, not `apps/web`, and is separately authorized.

### 3.5 Installed SDK evidence, distinct from application code

`edge/apps/api/package.json` declares `@anthropic-ai/sdk: ^0.122.0`; the inspected installed package is **0.122.0**. Relevant declarations were read at these real paths. They prove available primitives, not that edge already wires them into chat.

| Path | Lines | Evidence |
|---|---:|---|
| `edge/apps/api/node_modules/@anthropic-ai/sdk/resources/files.d.ts` | 104 | `Files.upload`, `delete`, metadata and `FileUploadParams`; upload accepts `file` and optional `expires_in_seconds`, **no typed `purpose`**. |
| `edge/apps/api/node_modules/@anthropic-ai/sdk/resources/beta/sessions/sessions.d.ts` | 866 | `SessionCreateParams`, `BetaManagedAgentsFileResourceParams`: `{type: file, file_id, mount_path?}`; initial user events, environment/vaults, budget. No max_tokens/history-window field. |
| `edge/apps/api/node_modules/@anthropic-ai/sdk/resources/beta/sessions/resources.d.ts` | 227 | `Resources.add/list/retrieve/delete`; file resource returns distinct resource `id`, `file_id`, `mount_path`. Existing-session attachment is available. |
| `edge/apps/api/node_modules/@anthropic-ai/sdk/resources/beta/sessions/events.d.ts` | 1513 | `Events.toolRunner`, custom call/result event types. The result is `user.custom_tool_result`, **not** `agent.custom_tool_result`. |
| `edge/apps/api/node_modules/@anthropic-ai/sdk/resources/beta/agents/agents.d.ts` | 1128 | Custom tool `{type: custom, name, description, input_schema}`; model config has id/effort/geo/speed, not max_tokens. Model union includes `claude-opus-5`. |
| `edge/apps/api/node_modules/@anthropic-ai/sdk/lib/tools/SessionToolRunner.d.ts` | 178 | `SessionToolRunner`, options and `DispatchedToolCall`; handles dispatch, result posting, reconnect, abort and cleanup. Defaults to 60s idle after end_turn; unowned calls are left to their owner. |

Do not vendor SDK internals into club-athletic. Use the package API. Current provider documentation must be checked during implementation for the D7 mismatch and exact model settings; this plan does not silently “fix” a settled Decision by type assertion.

## 4. Exact destination map

Legend: **V** = verbatim selected implementation, import paths/type names only; **R** = rename fields/symbols without changing the mechanism; **A** = genuine adaptation with the delta stated. All paths here are **future** changes; this task creates only this document. No files in the destination map were created by this task.

### 4.1 Server and shared contracts

| Edge source | Exact destination in apps/web | Mode and precise delta |
|---|---|---|
| `edge/apps/api/src/contracts.ts` + `edge/apps/web-platform/src/types.ts` | `apps/web/src/lib/chat/contracts.ts` | R/A: select chat types; rename Execution→Conversation and executionId→conversationId, combine actual send response including delivery; keep row/delta/state field names. Browser presentation uses current-activity fields. Exclude automation schedules/revisions. |
| `edge/apps/api/src/lib/managed-agents/client.ts` | `apps/web/src/lib/managed-agents/client.server.ts` | R/A: retain SDK seams, beta header and session/send/interrupt/list methods; one concierge config; widen resources to SDK file-resource union; add named Files/resource wrapper methods. Missing-skill behavior is Q8. |
| `edge/apps/api/src/lib/managed-agents/config.ts` | `apps/web/src/lib/managed-agents/config.server.ts` | A: one fixed concierge agent resolved server-side; proposed new key `CLAUDE_TRIP_CONCIERGE_AGENT_ID`, retain `CLAUDE_MANAGED_ENVIRONMENT_ID`/`CLAUDE_MANAGED_VAULT_ID`/`ANTHROPIC_API_KEY`. This new concierge key is proposed, not found in edge. Never accept arbitrary provider agent IDs from guests. |
| `edge/apps/api/src/lib/managed-agents/event-identity.ts` | `apps/web/src/lib/managed-agents/event-identity.ts` | V: same root/child identity and metadata rules; imports point to local contracts. |
| `edge/apps/api/src/lib/managed-agents/map-managed-agent-event.ts` | `apps/web/src/lib/managed-agents/map-managed-agent-event.ts` | V/A: keep mapping; no scheduler configured. Add mapping of SDK custom-tool results to existing `tool_result` rows with paired invocation ID after Q5. Do not invent a new SSE event. |
| `edge/apps/api/src/lib/runtime/event-relay.ts` | `apps/web/src/lib/chat/runtime/event-relay.server.ts` | R: conversation-keyed maps/listeners/snapshot registry, identical publish/subscribe semantics; structured debug helper below. |
| `edge/apps/api/src/lib/runtime/event-ingest.ts` | `apps/web/src/lib/chat/runtime/event-ingest.server.ts` | R: swap persistence dependency for separate bookkeeping writes; preserve ordering and duplicate handling. |
| `edge/apps/api/src/lib/runtime/close-execution.ts` | `apps/web/src/lib/chat/runtime/close-conversation.server.ts` | A: preserve turn/session distinction and queued-message behavior; remove automation notifications/wake scheduler, use conversation turn state. Lifecycle defects to resolve explicitly under Q7. |
| `edge/apps/api/src/lib/runtime/execution-state-frames.ts` | `apps/web/src/lib/chat/runtime/conversation-state-frames.server.ts` | R/A: read Conversation, keep same six public state fields; pendingWakeupAt always null (no scheduler); database writes remain in bookkeeping module. |
| `edge/apps/api/src/lib/runtime/recover-execution-stream.ts` | `apps/web/src/lib/chat/runtime/recover-conversation-stream.server.ts` | R: retain subscribe→buffer→paged replay→flush→snapshot/state. Handle same-seq updates under Q7, not by changing wire format. |
| `edge/apps/api/src/lib/runtime/execution-managed-agent-session.ts` | `apps/web/src/lib/chat/runtime/conversation-managed-agent-session.server.ts` | R/A: preserve fragment accumulation, canonical IDs, dedupe, provider reconnect and pump ownership; use Conversation state; start/stop SDK tool runner as an owned companion, no custom model loop. |
| `edge/apps/api/src/lib/runtime/active-pumps.ts` | `apps/web/src/lib/chat/runtime/active-pumps.server.ts` | R: conversation keys; include explicit owned abort/cleanup handles for shutdown as Q7 requires. |
| `edge/apps/api/src/lib/runtime/managed-agent-transcript.ts` | `apps/web/src/lib/chat/runtime/managed-agent-transcript.server.ts` | R: read agentSessionId; retain session/thread list, chronological merge, identities and cache-miss repair. Preserve durable user messages, which provider mapper ignores. |
| `edge/apps/api/src/lib/runtime/start-chat.ts` | `apps/web/src/lib/chat/runtime/start-conversation.server.ts` | A: replace hidden automation host with trip-scoped Conversation/opening Message transaction; keep opening validation/idempotency and launch existing provider pump. No automation/task-definition tables or memory store prerequisite. |
| `edge/apps/api/src/lib/runtime/send-execution-message.ts` | `apps/web/src/lib/chat/runtime/send-conversation-message.server.ts` | R/A: retain durable-before-send, request-key dedupe, queue and interrupt/replace; replace execution lookups and historical memory-store branch with explicit bounded conversation recovery policy Q2. Validate optional uploadId belongs to conversation and has mounted resource. |
| `edge/apps/api/src/lib/runtime/cancel-execution.ts` | `apps/web/src/lib/chat/runtime/cancel-conversation.server.ts` | R: same interrupt-confirmation behavior; disconnecting the browser alone does not cancel the provider turn. |
| `edge/apps/api/src/lib/runtime/stop-confirmation-timeout.ts` | `apps/web/src/lib/chat/runtime/stop-confirmation-timeout.server.ts` | R/A: conversation state; retain 30s failure timeout, register timer for lifecycle cleanup. |
| `edge/apps/api/src/lib/runtime/chat-config.ts`, `edge/apps/api/src/config.ts` | `apps/web/src/lib/chat/config.ts` | A: retain 15s SSE heartbeat, 8192-character message limits, 15s send acknowledgement; name retention/upload/limiter policies explicitly (Q9). |
| `edge/apps/api/src/modules/executions/projections.ts` | `apps/web/src/lib/chat/projections.ts` | R: selected bounding, capability/status and five serializers. Do not port automation definition comparison or its duplicate rendering reducer. |
| `edge/apps/api/src/modules/executions/repository.server.ts` | `apps/web/src/lib/chat/repository.server.ts` | R: Conversation/Message reads, detail/status and 200-row replay pages, immutable trip scope; no writes. Uses a chat-read database capability, never widens existing trip ReadDatabase. |
| `edge/apps/api/src/lib/runtime/session-events.ts` + delivery writers in `send-execution-message.ts` | `apps/web/src/lib/db/chat-writes.server.ts` | A: Message as durable event store, transactional Conversation sequence allocator, unique identities, queue/cursor/lifecycle bookkeeping; explicit helpers below. No writes in `db/repository.server.ts`. |
| Provider/runtime debug calls in edge files above | `apps/web/src/lib/chat/runtime/chat-debug.server.ts` | A: length/status/identity-only diagnostics; never log full message, file bytes, vault values or raw tool arguments. This small adapter replaces edge-specific logging dependency. |

### 4.2 HTTP resource routes (D2/D21)

Register each path with `route("…", "routes/….ts")` in the existing `apps/web/app/routes.ts`. Resource modules have **no default component export**. JSON methods use `action`; reads/streams use `loader`. These are URLs served by apps/web, not a new `apps/api` package.

| Edge source/precedent | Exact route module | Method and URL; adaptation |
|---|---|---|
| `edge/apps/api/src/lib/runtime/start-chat.ts` (orchestration seam) | `apps/web/app/routes/api.chat.conversations.ts` | `POST /api/chat/conversations`; opening text + optional upload association policy, Idempotency-Key; durable creation then pump. Returns conversationId and initial cursor/details metadata. |
| `edge/apps/api/src/http/routes/executions.routes.ts` detail | `apps/web/app/routes/api.chat.conversation.ts` | `GET /api/chat/conversations/:conversationId`; browser-safe detail including ordered rows, lastEventSeq and chat capability; no provider credentials. |
| Same, status | `apps/web/app/routes/api.chat.status.ts` | `GET /api/chat/conversations/:conversationId/status`; compact snapshot for reconnect, same status fields. |
| Same, SSE | `apps/web/app/routes/api.chat.stream.ts` | `GET /api/chat/conversations/:conversationId/stream?after=<seq>`; same five named frames. Return Response with ReadableStream and edge headers, TextEncoder serialization and 15s heartbeat. |
| Same, messages | `apps/web/app/routes/api.chat.messages.ts` | `POST /api/chat/conversations/:conversationId/messages`; `{text, deliveryMode?, uploadId?}` and Idempotency-Key; same acknowledgement/error statuses, executionId renamed. |
| Same, cancel | `apps/web/app/routes/api.chat.cancel.ts` | `POST /api/chat/conversations/:conversationId/cancel`; provider interrupt, 202 stopping/stopped, 404 missing, 409 idle, 502 rejected, 503 unavailable. Do not port the unused client `/cancel-turn` path in place of the real `/cancel` handler. |
| New attachment boundary; existing SDK file/resources methods | `apps/web/app/routes/api.chat.uploads.ts` | `POST /api/chat/uploads`; bounded multipart file + conversationId (or creates an empty draft conversation for an attachment-first send, Q4). Returns app uploadId/conversationId and safe display metadata. Never accepts browser-supplied provider file IDs. |

The Express handler calls `response.flushHeaders()` before replay. A framework loader cannot call that method; preserve its effect by returning a live Response promptly and beginning the stream with a comment frame, then executing edge recovery inside stream production. `request.signal` abort and stream `cancel()` must clear heartbeat and unsubscribe all channels, including the race where recovery returns its unsubscribe after cancellation. Keep provider pump lifetime independent of one subscriber. Verify first-byte delivery through the actual Express adapter; do not add a second Express SSE route as a workaround.

Future `apps/web/server/app.ts` integration supplies bounded upload-body handling before multipart materialization and runtime ownership. Future `apps/web/index.ts` integration starts recovery through the built server module and awaits shutdown of pumps, tool runners, timers and DB clients before its existing shutdown deadline. Keep all CMA/DB code server-only and off client imports; a shared `.ts` file may contain types and pure projections, never an SDK instance.

### 4.3 React consumer, design and genuinely new domain files

| Edge source / design source | Exact destination | Mode and precise delta |
|---|---|---|
| `edge/apps/web-platform/src/lib/api/index.ts` | `apps/web/app/lib/chat/api.ts` | V/R: extract actual SSE subscriber/cursor and chat HTTP helpers; same parser/abort behavior, change URLs and errors; remove authentication-generation and separate-origin plumbing because this app has no login/CORS split. |
| `edge/apps/web-platform/src/lib/execution/event-projection.ts` | `apps/web/src/lib/chat/event-projection.ts` | V/A: preserve row reducer/call-result pairing and live/historical parity; add safe upload display metadata and parsed source sections, no second transcript reducer. |
| `edge/apps/web-platform/src/lib/ui/stream-blocks.ts` | `apps/web/src/lib/chat/stream-blocks.ts` | V: cumulative replacement, done handling, canonical reconciliation; update imports only. |
| `edge/apps/web-platform/src/lib/execution/execution-chat-state.ts` | `apps/web/src/lib/chat/chat-state.ts` | R/A: same reducer/ack semantics, change nouns; attachment draft validity extends submit predicate, not transcript state. Q1 governs concurrency UI. |
| `edge/apps/web-platform/src/lib/execution/execution-controls.ts` | `apps/web/src/lib/chat/chat-controls.ts` | R: selected reconnect/cancel predicates; exclude automation rerun. |
| `edge/apps/web-platform/src/lib/execution/execution-live-activity.ts` | `apps/web/src/lib/chat/chat-live-activity.ts` | R: activity selection preserved, trip startup wording. |
| `edge/apps/web-platform/src/lib/execution/execution-details-loader.ts` | `apps/web/app/lib/chat/detail-loader.ts` | R/A: keep recovery status/detail/error helper semantics; initial route data comes from framework loader, no route-cache store. |
| `edge/apps/web-platform/src/lib/execution/tool-presentation.ts`, `lib/shared/tool-classify.ts`, `lib/shared/state-copy.ts`, `lib/shared/type-guards.ts` | `apps/web/src/lib/chat/tool-presentation.ts`, `apps/web/src/lib/chat/tool-classify.ts`, `apps/web/src/lib/chat/state-copy.ts`, `apps/web/src/lib/chat/type-guards.ts` | V/A: preserve helpers, replace trading labels/registries and error nouns; redact public tool fields before serialization (Q8). |
| `edge/apps/web-platform/src/lib/hooks/use-auto-scroll.ts` | `apps/web/app/lib/chat/use-auto-scroll.ts` | A: preserve pin/unpin, resize and expansion-grace behavior; adapt `.shell__scroll` element assumption to this app's document scrolling without adding a nested scroller that changes the design. |
| `edge/apps/web-platform/src/routes/Execution/execution-details.tsx` | `apps/web/app/components/chat/chat-panel.tsx` | A: extract its actual rows/blocks/cursor/effect/send controller and component composition; hydrate from overview loader, use framework revalidation for detail refresh; keep reconnect generation guards/ack checks/cleanup; remove automation chrome and markdown-export path. No fresh bespoke streaming hook. |
| `edge/apps/web-platform/src/components/execution-stream.tsx` | `apps/web/app/components/chat/chat-thread.tsx` | A: preserve event dispatch/order/tool groups/user delivery/scroll behavior; plain escaped React text + pre-wrap instead of RenderMarkdown/coalescing; append source links and attachment metadata; trip bubble styles. |
| `edge/apps/web-platform/src/components/execution-chat-input.tsx` | `apps/web/app/components/chat/chat-composer.tsx` | A: preserve controlled textarea, auto-grow cap, Enter/Shift+Enter, pending acknowledgement and failure text; trip pill/arrow styling; attach control and chip below. Replace edge Button dependency with local styled native button. |
| `edge/apps/web-platform/src/components/execution-tool-group.tsx` | `apps/web/app/components/chat/chat-tool-group.tsx` | A: same accordion/pending/error mechanism and scroll suspension; trip tool labels, public-safe display rather than raw booking/credential diagnostics. |
| `edge/apps/web-platform/src/components/agent-activity-stream.tsx` | `apps/web/app/components/chat/chat-activity.tsx` | A: keep accessible status/indicator-only contract; replace spinner with decoded three 7px cyan blink dots, 1.2s cycle, stagger 0/.2/.4s; reduced-motion treatment. |
| `edge/apps/web-platform/src/components/error-boundary.tsx` | `apps/web/app/components/chat/chat-error-boundary.tsx` | A: preserve containment/reset; trip copy, native button; wrap chat only so all ten sections remain navigable. |
| `edge/apps/web-platform/src/components/loading-skeletons.tsx` | `apps/web/app/components/chat/chat-loading.tsx` | A: port TranscriptSkeleton only; local CSS placeholders avoid importing unrelated advisor/dashboard components. |
| `docs/meribel-source-decoded.html:484–520` | `apps/web/src/lib/chat/sources.ts` | V/R: port SRC_MAP/parser, map source section IDs to real URL paths; expose `parseAnswerSources`. This is a design-source port, not an invented citation scheme. |
| Decoded composer/thread and existing overview | `apps/web/app/routes/overview.tsx`, `apps/web/app/components/app-shell.tsx`, `apps/web/src/styles.css` | A: loader accepts selected conversation; active thread replaces hero/tile/week/address region with compact tile chip strip, thread and sticky composer; New question clears selection and returns `/`; suggestions submit through the same controller. Keep all ten existing data loaders/section bodies. |
| New attachment leg, using D6/D7/D17 | `apps/web/app/components/chat/chat-attachment.tsx`, `apps/web/src/lib/chat/upload.server.ts` | New: react-dropzone picker/drop; explicit clipboard paste to same validation pipeline; preview URL lifecycle/remove/error; server sniff/normalize/hash/upload/mount/cleanup with no direct browser→Anthropic call. |
| D15, searched edge patterns | `apps/web/src/lib/chat/rate-limit.server.ts` | New trip policy: in-process token bucket with tighter attachment allowance, bounded/expired keys and 429/Retry-After; no Redis. Q9 supplies proposed limits. |
| Existing trip read helpers + CMA custom-tool SDK | `apps/web/src/lib/chat/tools/read-tools.server.ts`, `apps/web/src/lib/chat/tools/record-flight.server.ts`, `apps/web/src/lib/chat/tools/flight-schema.ts`, `apps/web/src/lib/chat/runtime/tool-runner.server.ts` | New domain adapters, existing SDK runner: Zod schemas; read-only section tools; one confirmed flight write tool; companion SDK tool runner, not an AI SDK loop. |
| §2.13b + existing table | `apps/web/src/lib/chat/flight-intake.server.ts` | New: persisted pending-intake state, confirmed name, disambiguation, missing fields, read-back version, yes/correction and expiration. No separate LLM extraction pass. |
| §3.3 + edge persistence precedent | `apps/web/src/lib/db/chat-client.server.ts`, `apps/web/src/lib/db/flight-write-client.server.ts`, `apps/web/src/lib/db/flight-writes.server.ts`, `apps/web/src/lib/db/guest-lookup.server.ts` | New separate capabilities/helpers; no mutation additions to existing trip read helpers. Guest lookup is read-only. |
| Existing schema + edge execution/session rows | `apps/web/prisma/schema.prisma`, `apps/web/prisma/migrations/20260926010000_chat_port/migration.sql` | Future additive migration, no reseed/replacement of baseline: event/state/resource fields and reviewed Flight constraint/grants adjustment below. Generate existing client output normally only in that implementation task. |
| Dependency usages in the port sources; §8 below | `apps/web/package.json`, `apps/web/bun.lock` | Future dependency declarations and Bun lock resolution only: SDK in Task 2, dropzone/file-type in Task 4, browser test runner in Task 6. No workspace/package restructuring and no edits or installs in this document task. |

No destination for `executions.tsx`'s history page, trading tool registries, scheduler/wakeup/notification system, markdown renderer, or edge's auth/cache infrastructure. Control-plane counterparts remain `apps/managed-agents/agents/trip-concierge.agent.yaml`, `environments/default.environment.yaml`, `skills/{rooms,logistics,schedule,chef,pricing,general,flight-intake}/SKILL.md`, and adapted deployment scripts in that app, in a later §4 task. The web app owns all database tool execution; do not mount a database write credential in the CMA sandbox.

## 5. Event and wire contract to preserve

### 5.1 Actual frame payloads

These are contract declarations/transcripts for the port, not new implementation code. Keep optionality and field spelling. `Record<string, unknown>` means a typed/validated payload at boundaries, not arbitrary browser mutation authority.

```text
SessionEventRow = {
  id: string, seq: number, type: string, payload: Record<string, unknown>
}
StreamDelta = {
  blockId: string, variant: "message" | "reasoning", text: string, done: boolean,
  canonicalEventId?: string, providerEventId?: string,
  threadId?: string, parentThreadId?: string | null, threadRole?: "root" | "child",
  agentName?: string,
  activityKind?: "commentary" | "reasoning_summary" | "tool_started" |
                 "tool_completed" | "model_request" | "status" | "approval",
  activityLabel?: string, toolName?: string
}
ExecutionSessionStateFrame = {
  runtimeStatus: string | null, status: string,
  activeRequestIdPresent: boolean, activeTurnId: string | null,
  pendingWakeupAt: string | null, waitingOnApproval: boolean
}
ExecutionChatCapability = {
  canSend: boolean, reason: "expired" | "closed" | "no_session" | null,
  runtimeStatus: string | null, pendingWakeupAt: string | null,
  activeTurn: boolean, waitingOnApproval: boolean
}
ExecutionStatusSnapshot = {
  status: "running" | "completed" | "failed" | "stopped",
  lastEventSeq: number, finishedAt: string | null, error: string | null
}
Actual send acknowledgement = {
  ok: true, seq: number, requestId?: string, executionId?: string,
  sessionId?: string | null, threadId?: string | null, delivery?: "sent" | "queued"
}
Send failure = {ok: false, error: string}
ReplayPage (server-internal) = {
  events: SessionEventRecord[], hasMore: boolean, nextAfterSeq: number
}
SessionEventRecord = SessionEventRow & {executionId: string}
```

Actual bytes from the serializers called by `edge/apps/api/src/http/routes/executions.routes.ts` (`\n` below denotes LF; each frame ends with a blank line):

```text
id: <seq>\nevent: activity\ndata: {"id":"<row-id>","seq":<seq>,"type":"<row-type>","payload":{...}}\n\n
event: delta\ndata: <JSON StreamDelta>\n\n
event: state\ndata: <JSON ExecutionSessionStateFrame>\n\n
event: done\ndata: {}\n\n
event: error\ndata: {"error":"<message>"}\n\n
: heartbeat\n\n
```

There is **no named `event` frame**: the durable frame is named **`activity`**. Only it has `id:`; deltas/state/done/error do not move the reconnect cursor. Headers are exactly `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`; heartbeat interval is 15000ms. Cursor is `max(parsed ?after, parsed Last-Event-ID)` with invalid/missing values falling back to -1. Server detail is bounded to newest 200 rows; replay pages are 200 ascending rows plus one lookahead, followed until `hasMore` is false.

Domain changes: executionId→conversationId in URL, internal record and JSON acknowledgement; `runtimeExternalId` database/detail reference→`agentSessionId`; provider metadata key `edgeExecutionId`→`clubAthleticConversationId`; `eveMetaId` storage→`providerEventKey` (holds canonical thread-qualified identity). Symbols named Execution become Conversation. All frame names, `id`, `seq`, `type`, `payload`, `blockId`, `variant`, `text`, `done`, canonical/provider/thread identifiers, state/capability fields, and `after`/Last-Event-ID semantics remain unchanged. No scheduler: keep `pendingWakeupAt: null` for compatibility. Append safe `upload`/`sourceSections` data to relevant durable payloads; do not add `file_token`, AI SDK parts, or a new parallel attachment SSE protocol.

### 5.2 Provider mapping and stream behavior

| Provider event | Actual mapped row/state |
|---|---|
| `agent.message` | `display/message`: text blocks joined, `activityEventId`, commentary label and canonical/provider/thread metadata. A JSON `edge_event: schedule` body is a special lifecycle case in edge; trip has no scheduler. |
| `agent.thinking` | `display/agent_activity` with fixed “Thinking through the next step...” summary, not durable raw reasoning text. |
| `agent.tool_use`, `agent.custom_tool_use`, `agent.mcp_tool_use` | `display/tool_call`: `toolName`, `input`, `invocationId = event.id`, tool-started metadata; MCP adds `mcpServer`. |
| `agent.tool_result`, `agent.mcp_tool_result` | `display/tool_result`: invocation from `tool_use_id` / `mcp_tool_use_id`, `ok`, optional result/error/toolName and tool-completed metadata. |
| thread creation/status and thread messages | `thread_status` / `thread_message` with metadata, or ignore if incomplete. |
| `span.model_request_start/end` | `agent_activity` with fixed contacting/reviewing status text. |
| `session.status_running` | `turn.started`; pump updates runtime to active and emits state rather than persisting this as a normal message. |
| `session.status_idle` / requires_action | Transient approval-pending state. A custom-tool wait needs the SDK runner; it is not automatically the guest's flight confirmation (Q5). |
| idle / retries_exhausted or budget_reached | `turn.failed`, remains a turn boundary. |
| other idle / end_turn | `turn.completed`; parks session. Pump converts completion after observed user.interrupt to turn.cancelled. |
| `session.status_terminated` / `session.error` | `session.completed` / `session.failed`; real session terminal. |
| unrecognized event | Ignore. `user.custom_tool_result` is currently ignored; Q5 requires deliberate adaptation for tool pairing. |

The pump's `event_start` initializes a block; `event_delta` contains incremental `content_delta.content.text`. **The pump appends those fragments; the browser receives cumulative `StreamDelta.text` and replaces its block.** A final buffered provider event is persisted before relay and finalizes/removes the transient block. Preserve canonical IDs across live, backfill and child streams. `streamIndex` is persisted diagnostic/recovery state, not permission to skip that many replayed provider events; the real pump explicitly processes every full event and dedupes by identity.

The current resume path explicitly lists durable session history ascending before opening the live stream. It skips already-persisted boundary effects through `row.duplicate`, and parks when a newly ingested boundary says to stop; if the history read fails, it logs and falls back to streaming. Comments in the same file disagree about whether the live stream always replays history. **Code wins:** preserve explicit durable backfill and identity dedupe; never rely on automatic stream replay. The unresolved case is an **unpersisted historical boundary followed by a later turn in the same history response**: the current loop can break before that later turn. Q7 requires this exact regression fixture and an explicit recovery decision, not a claim that every replayed boundary is broken.

Server reconnect: subscribe before querying → buffer newly persisted rows → drain bounded DB pages → flush sorted buffered rows beyond cursor → restore in-flight delta snapshots → current state → keep open while resumable. Client reconnect: actual SSE parser handles split chunks/UTF-8/CRLF/multi-line data, tracks acknowledged durable sequences, probes status/details after error, reconnects from cursor and uses 2s recovery polling when both transport and status fail. Port effect cleanup and stale-generation guards. Delayed durable-text settlement is 500ms in edge; with D5's plain text, retain initially or explicitly decide removal under Q7, never improvise a second token reducer.

## 6. What is actually absent, and what is not

Search scope: requested source files and imports; recursive `edge/apps/api/src`, `edge/apps/web-platform/src`, `edge/apps/managed-agents`, their scripts/package files and READMEs; broader `edge/apps`, `edge/scripts`, `edge/docs`, and root `edge/CLAUDE.md`, excluding `.env*`, dependency/build output, lockfiles and large bundled HTML. Root `edge/README.md` does not exist; the managed-agents README does. Searches included `agent_resource`, `mount_path`, Files upload calls, `react-dropzone`, `file-type`, `Bun.Image`, `recordFlight`, `PendingExtraction`, `custom_tool_use`, `user.custom_tool_result`, `token.bucket`, `max_tokens`, and `slice(-8)`. Installed SDK declarations were then inspected separately.

- **Present and mandatory to reuse:** streaming parser, reducer, composer, tool grouping, user-send persistence/idempotency, server queue, provider pump, interrupt handling, startup/read-time recovery, stream snapshots, event replay and transcript backfill. Their actual paths are §§3–4. None is a blocker.
- **Absent from the inspected edge application path:** composer attachment selection/drop/paste/preview; server image/PDF ingest, Files upload→session file-resource mounting, two-ID bookkeeping, dedupe and deletion for guest screenshots. Client resources are memory-store-only; no file-upload implementation appeared in the searched paths. The **SDK does have Files and resource APIs**; do not build replacements.
- **Domain-specific additions, not missing transport:** trip read tools; nullable multi-leg `recordFlight` schema, confirmed-name/read-back intake, pending state/expiration, append-and-supersede/audit transaction; source chips supplied by the trip HTML; D15's trip endpoint limiter. No `recordFlight` or `PendingExtraction` implementation was found in the search scope. The generic source protocol does not imply this flight workflow exists.
- **Custom execution is available in the SDK, not wired in edge's app.** The edge mapper recognizes custom calls but does not execute them or map their client-sent results. Installed `Events.toolRunner` is the solution to evaluate and use, not a reason to invent a dispatch loop. `edge/docs/superpowers/completed/2026-09-01-managed-agent-subagent-visibility.md` itself corrects the nonexistent `agent.custom_tool_result` event to `user.custom_tool_result`.
- **No applicable in-process trip token bucket found.** The broader search found an unrelated Go/Redis rate-budget plan in `edge/docs/superpowers/completed/2026-09-15-go-api-latency-improvements.md`, not a ready D15 web-chat implementation. Keep limiter policy small and process-local; do not copy its Redis design.

Thus “the file-attachment leg is the only truly new part” is accurate for the generic chat UI/transport, **not literally for all of §2.13b's trip-domain writes**. The additions above extend that port; they do not justify replacing its transport, event protocol or React consumer.

## 7. Database wiring and separate write helpers

### 7.1 Mapping and additive schema proposal

Proposed schema changes are recommendations for the later implementation, subject to the decisions in §9. No migration runs in this task. Preserve 18 tables by making `Message` the event-row store rather than creating a nineteenth `SessionEvent` table or hiding events in `AuditLog`.

| Existing club table | Edge source concept | Required wiring |
|---|---|---|
| `Conversation` | Execution's session/runtime envelope, without automation owner | Keep tripId/agentSessionId; add `status` (turn outcome), `runtimeStatus`, `nextEventSeq` default 0, `streamIndex` default 0, `activeRequestId`, `activeTurnId`, `finishedAt`, `error`, nullable unique opening `requestId`. Keep session-scoped IDs on server. No continuation token needed for the actual CMA stream. |
| `Message` | SessionEvent plus transcript bookkeeping | Add `seq`, `type`, JSONB `payload`, nullable `providerEventKey`, nullable `requestId`; unique `(conversationId, seq)`, `(conversationId, providerEventKey)`, `(conversationId, requestId)`. Retain role/content/sourceSections/uploadId. Use `user`, `assistant`, `tool`, `system` as validated role values; empty content is valid for lifecycle rows. Payload is event authority; derive content/sourceSections in the same write transaction, never from browser-supplied assistant text. Backfill any preexisting message rows deterministically by createdAt/id before enforcing seq. |
| `Upload` | No file analogue in edge app | Retain fileId as original uploaded ID; add nullable `mountedFileId`, `sessionResourceId`, `mountPath` and per-copy cleanup state if needed. The resource ID is a third identity, not a file ID. Preserve originalFilename, mimeType, sizeBytes, sha256 unique, conversationId, purpose, processedAt/extractionResult/deletedFromAnthropicAt. Q4 addresses failed-upload staging and global dedupe. |
| `PendingExtraction` | No trip analogue | Extend existing JSON candidates into a versioned nullable leg list; add upload relation/identifier, phase, claimed first/last name, resolved guestId, read-back version and confirmation Message ID (recommended explicit columns plus JSON candidates). Reuse outstandingQuestion/expiresAt; expiration refuses writes. RecordFlight may stage a partial candidate but must not write Flight/Guest until required confirmations hold. |
| `AuditLog` | Edge lifecycle audit is not a substitute | Only domain audit: one entry per inserted Guest/Flight and per superseded Flight mutation, source AGENT, conversationId, claimedGuestName, before/after. Never use this table as a token/event stream. |
| `Flight`, `Guest` | Domain-specific narrow write | Existing provenance columns remain authoritative. New guest = first/last/display name, createdVia AGENT, status INVITED; no existing-guest edit. Flight requires resolved guest, explicit confirmation and complete required fields. |

Message sequence allocation and provider/request dedupe remain transactional as in `edge/apps/api/src/lib/runtime/session-events.ts`. Return `duplicate: true` without re-executing lifecycle or tool side effects. Provider calls can be redelivered after restart: flight writes also require durable tool-call idempotency tied to conversation/pending extraction and returned Flight IDs. An SDK runner's in-memory dedupe is not a database guarantee.

### 7.2 Exact helper surface to add

`apps/web/src/lib/db/chat-writes.server.ts` owns **only bookkeeping**:

| Helper | Mutation and invariant |
|---|---|
| `createConversationWithOpeningMessage` / `createDraftConversation` | Allocate cuid2 IDs, trip scope and opening request dedupe; create first user row before invoking CMA; draft variant supports upload-first policy Q4. |
| `attachAgentSession` / `updateConversationCursor` | Save provider session immediately; persist streamIndex even on duplicate event recovery. |
| `insertConversationEvent` / `insertConversationEventAllocating` | Port synthetic/allocated row branches, unique identities and seq allocation; keep role/content/sourceSections synchronized with payload. |
| `appendUserMessage` / `markUserMessageDelivery` | Store text and optional owned uploadId, delivery pending→queued/sent/failed; reuse request key; never show an unpersisted assistant/user row as delivered. |
| `markQueuedMessageDelivered` / `failQueuedMessages` / `supersedeQueuedMessagesBeforeSeq` | Preserve edge queue ordering, delivery outcomes and interrupt-replace semantics. Read queue helpers live in chat repository. No queued delete/edit endpoints unless explicitly selected in Q1. |
| `updateConversationSessionState` / `parkConversationTurn` / `closeConversation` | Active/starting/stopping/waiting/closed transitions; release claims at appropriate boundary, terminal only closes session; Q7 addresses edge's execution-specific mismatch. |
| `createUploadRecord` / `attachUploadResource` / `markUploadProcessed` / `markUploadCopyDeleted` | Track bytes hash, both file IDs and resource ID/path; declare complete deletion only after all required copies are confirmed gone. Q4 determines pending reservation representation. |
| `savePendingExtraction` / `recordClaimedGuestName` / `recordIntakeReadback` / `confirmPendingExtraction` / `expirePendingExtraction` | Durable phase/version, unresolved question and expiry; confirmation references persisted guest message and exact candidate version; corrections invalidate previous confirmation. No arbitrary trip mutations. |

`apps/web/src/lib/db/flight-writes.server.ts` owns `recordFlight` and `createGuestFromAgent`. Each runs with `flight-write-client.server.ts`'s narrow credential; chat bookkeeping uses `chat-client.server.ts`'s distinct application capability. Existing `withReadDatabase` remains read-only and its per-call disconnect ownership is preserved. Do not route writes through the read-only `DATABASE_URL_POOLED` merely because it is already configured. Credential key names/grants must be supplied for the separate roles, never copied into the browser or agent prompt.

`recordFlight` validates the same Zod contract exposed to CMA: nullable fields for incomplete extraction, list of legs, direction/airline/flightNumber/origin/destination/local dates and times/booking reference/visible passenger name/confidence. Complete validation requires flight number, airports, resolved departure/arrival instants and direction, resolved guest, `confirmedByGuest` and unexpired server-confirmed pending state. Unknown IATA zones and ambiguous dates yield a follow-up, not a guessed timestamp. Convert using the existing airport map and date-fns-tz, read back local airport times with explicit dates/zones, then save UTC.

The transaction locks/serializes the affected guest+direction, verifies tool idempotency, appends new rows, supersedes prior live rows, writes before/after audit entries and consumes the confirmed pending version atomically. For two directions, both legs succeed or neither does. §3's partial unique live-flight index remains the final guard. **Do not naïvely insert-new then update-old:** the current index rejects two live rows; update-old-first currently fails its immediate FK to the not-yet-inserted row. Q6 recommends a deferred supersession FK so a preallocated replacement ID can be set on the old row before inserting its replacement, in one transaction. This is a real schema constraint issue, not something edge's unrelated execution writer solves.

`createGuestFromAgent` needs confirmed first/last name, no matching known guest, and explicit consent to add; it sets INVITED/AGENT and writes its audit entry in the same transaction. Use `guest-lookup.server.ts` for case/space/accent/middle-name tolerant candidates, with exact unique matches preferred and multiple candidates returned rather than auto-selected. The existing mononym is handled deliberately; do not invent a surname. A candidate name read from an image is never identity evidence.

Read tools call existing `getTripOverview`, `getSchedule`, `getFlightTable`, `getShuttles`, `getProperty`, `getRoomsByFloor`, `getOpenSpots`, `getChefSummary`, `getGuestTasks`, `getLinks` and a read-only notes/guest lookup where necessary. Return bounded trip data and source section; no free SQL tool and no new duplicated flight-status computation. Only committed live confirmed flights reach the existing Flights loader on next load/revalidation.

### 7.3 Upload and intake sequence

1. Picker/drop/paste produces one file chip, image thumbnail or PDF name; remove revokes preview URL. `react-dropzone` does not remove the need to wire a clipboard handler. Send failure preserves text and selected attachment.
2. Server enforces body/file cap before unbounded buffering; `file-type` is authoritative for PDF versus accepted PNG/JPEG/WebP/GIF. Images must pass `Bun.Image.metadata()`, orientation normalization, resize and WebP re-encode (EXIF stripped). PDFs pass through, never through image resizing. Hash original bytes consistently before normalization; resulting stored MIME/size describe transmitted bytes.
3. Deduplicate/recover Upload bookkeeping; upload through server `client.files.upload`, resolve D7 purpose typing under Q3; mount `{type: file, file_id, mount_path}` at creation or SDK `sessions.resources.add` for existing session. Persist the returned mounted file ID separately from original ID, and resource ID/path. Guest sees app uploadId, never credential/file transport control.
4. Send ordinary CMA text referencing the generated safe mount path after resource attachment succeeds. Agent uses its native read tool. Do not add AI SDK image parts/data URLs or a second structured-extraction model call.
5. Zod-validated `recordFlight` candidate can be staged; intake then always asks first/last name, resolves or disambiguates, offers INVITED creation if absent, reads back exact legs and waits for yes. A correction overwrites candidate state/version, not a live Flight. Wrong image declines extraction; non-flight images/PDFs support discussion only and direct lasting changes to the organizer. Normal Q&A cites real sections; intake turns need no fabricated Source line.
6. Confirmed complete candidate commits with provenance/audit. Revalidation shows Flights; delete original and mounted provider copies/resource as required, track retries without repeating flight writes, retain Upload metadata. Reload after deletion renders a retained attachment label, not a broken remote thumbnail. Expired/abandoned pending extraction writes no Flight.

## 8. Dependencies — list only

- **Add `@anthropic-ai/sdk`**, using edge's inspected 0.122.0 API as the starting pin: Managed Agents sessions/events, Files/resources, native custom `toolRunner`. Verify actual selected release against Q2/Q3/Q5 before pinning; no install occurred here.
- **Add `react-dropzone`** for picker/drop/type/size affordances; explicit paste adapter uses the same path. No matching dependency found in edge's current chat, so verify version/API in its official docs at implementation time.
- **Add `file-type`** for magic-byte MIME sniffing, especially the PDF branch (D17). Do not replace this with filename/Content-Type trust.
- **Later browser verification dependency:** align with edge's `playwright` and `@vitest/browser-playwright` if using a Vitest browser project. For the standalone acceptance spec below use `@playwright/test` (not currently present) and a small config; list it as dev-only. Do not install two redundant runners just to satisfy this plan.
- **Already available:** zod 4.4.3 (tool schema is extraction contract), cuid2 3.3.0, Prisma/client/adapter 7.8.0, date-fns-tz 3.2.0, React/Router/Express, vitest 4.1.10, happy-dom. No new package for these.
- **Bun 1.4 native, no additional dependency:** `Bun.Image` metadata/orientation/resize/WebP and EXIF removal; crypto hashing; file IO; fetch/ReadableStream/TextEncoder/TextDecoder/AbortController/FormData. `Bun.YAML` is available for later config handling. Current @types/bun is 1.3.14: verify type coverage for the already-accepted runtime, do not replace Bun.Image with sharp because declarations lag.
- **Unnecessary:** `react-textarea-autosize` (edge composer already grows its textarea), SSE parser package (real edge parser exists), multer if bounded native multipart suffices, new UI library solely for edge Button/skeleton, airport dataset, EXIF library, browser compression/canvas path, sharp/jimp.
- **Forbidden in this chat path:** `ai`, `@ai-sdk/anthropic`, `@ai-sdk/react` (D3); `streamdown`, marked, react-markdown **and even native Bun.markdown rendering** (D5); TanStack Query (D22); Redis/ioredis or Bun.redis limiter (D15). `@tanstack/react-table` already used by Flights stays.
- **Keep Prisma (D8):** Bun.sql does not replace the established ORM/schema. Do not add S3 storage for an image whose specified lifecycle is Files→CMA→deletion.

## 9. Open decisions with recommendations and tradeoffs

These are genuine mismatches or unspecified product policies, not claims that the transport is missing. Resolve before the dependent implementation; the document itself is complete without choosing silently.

| ID | Question and concrete evidence | Recommended answer and tradeoff |
|---|---|---|
| Q1 | Decoded design blocks send while loading; actual edge composer/server supports queue/interrupt. Are those controls wanted in the trip UI? | Preserve edge queue semantics and send acknowledgement behavior; keep interrupt support available in the port, style its affordance deliberately. If strict design requires single-flight UI, gate the affordance through capability while retaining underlying queue/recovery. Tradeoff: visual fidelity versus useful follow-ups; do not implement a different concurrency engine. |
| Q2 | §0 demands last 8 messages and max_tokens 400; edge keeps one persistent CMA session and sends only new text. Its wrapper/installed SessionCreateParams and model config expose neither limit. §2.13b asks claude-opus-5/adaptive thinking; edge agent YAMLs use opus-4-8/effort and session creation does not override model. | Keep D3's one-session-per-conversation and required opus-5; verify documented CMA controls before setting fields. Preserve 1–3 sentences/plain text as instructions, but explicitly do **not** claim they enforce 400 tokens or erase older provider context. If CMA has no controls, coordinator must choose an explicit exception to exact context/token limits or a documented provider-supported solution. Session rotation is not an authorized quiet substitution. |
| Q3 | D7 says Files upload purpose agent_resource; installed `files.d.ts` has only file/expires_in_seconds. | Verify official Files API/SDK docs and applicable request option on the chosen version; preserve D7's intended resource mounting and two file IDs. Do not suppress types, switch to beta Files, or omit purpose without recording the resolution. Resource mounting itself exists in the installed SDK. |
| Q4 | Upload.fileId is required, sha256 globally unique and row belongs to one conversation; upload can fail before ID exists. Same image in another conversation must not reveal the first conversation's booking or bypass confirmation. Attachment-first send has no conversation yet. | Create a draft Conversation before upload; add an explicit pending upload reservation/status with nullable fileId until successful. Keep global hash dedupe internal, never return another conversation's metadata/IDs. Decide whether duplicate cross-conversation uploads are safely rejected with retry guidance or require a reviewed ownership/remount schema change. Prefer conservative rejection for initial port; tradeoff is legitimate repeated screenshots. Hash bytes, not filename. |
| Q5 | Edge mapper only displays custom calls and ignores user.custom_tool_result; SDK already supplies sessions.events.toolRunner. requires_action currently disables the composer as approval-pending. TODO §2.13b calls recordFlight for nullable extraction before identity, while §4 says it must refuse without guest/confirmation. How do tools and multi-turn confirmation fit? | Use SDK toolRunner for the local Zod registry, alongside the ported read-only event pump, with shared lifetime/abort ownership. Handle custom results through existing tool_result projection and distinguish a service tool wait from guest name/read-back questions. Register only trip tools, never local generic shell tools. Recommended interpretation for review: partial recordFlight calls validate/stage PendingExtraction and return a refusal to commit plus a follow-up requirement; only server-confirmed state permits Flight/Guest writes. Do not silently relax §4's write guard. Tradeoff: a new SDK integration seam needs restart/idempotency tests, but no invented model/tool loop or second extraction schema. |
| Q6 | Existing live-flight unique index and immediate self-FK make naïve supersession ordering fail. §4 grants UPDATE only supersededById, but provenance also requires supersededAt. | Add a deferred self-FK for the supersession transaction, preallocate new ID, lock guest/direction, update old supersededById/supersededAt then insert replacement and audit. Grant narrowly both history columns plus required SELECT; no itinerary field updates or DELETE. Use a reviewed migration and real Neon concurrency test. Alternative is a more complex staged insert strategy; never drop the live unique index. |
| Q7 | Edge correctness seams: recovery drops `seq <= cursor` but queue writers republish same-seq delivery edits; lifecycle only exempts continued turn.cancelled, while pump marks queued turn.completed as continuation too; restart loaders require business status running even though follow-up sends on settled executions do not reset it. Client final-answer predicate rejects message rows carrying activity metadata, which mapper supplies. Ingest duplicates skip lifecycle after a possible crash between insert and side effect. | Keep these as targeted port decisions with regression fixtures, not “verbatim safe” claims. Recommended: allow live updates for already-known row identity without advancing cursor, reconcile a fresh detail after reconnect; conversation status represents its current turn and is reactivated on accepted send; continuation avoids parking while queue advances; derive answer completion from provider turn boundary/projection identity. Ensure durable idempotent lifecycle recovery. Preserve the current writer's already-correct unique-conflict recovery outside the aborted transaction. Retain frame protocol and row reducer. Add owned cleanup for pump/thread/tool-runner lifetimes; do not copy fire-and-forget child cleanup as a guarantee. |
| Q8 | `client.ts` retries missing skills with an empty skill list; tool groups/error serializer expose raw values; trip is public and uploads contain PII. | Fail closed for missing flight-intake/write capability; Q&A may proceed only with available trip read tools and honest fallback. Redact secrets/booking refs and internal errors before public frame/detail serialization; keep readable status/tool outcome, no raw diagnostics in guest UI. Tradeoff: less debugging detail in browser; restricted server audit retains necessary provenance. No change to wire frame names. |
| Q9 | Numeric upload cap/resize/limiter/expiry and chat ownership/navigation persistence are unspecified. No login is intended. | Proposed reviewable defaults: one attachment, 10MiB file/11MiB multipart cap, image longest edge 1600px without upscale; text bucket burst 10/refill 1 per 6s, upload bucket burst 3/refill 1 per 60s; 24h pending expiry, 30-day send retention after last settled turn (edge starting point). Store only opaque conversation selection in a browser cookie/local storage; use `/?conversation=<id>` for loader navigation only if URL sharing risk is accepted. No public conversation list. These are proposals, not discovered constants. |
| Q10 | Exact write confirmation cannot rest solely on an agent-supplied confirmedByGuest=true. Multiple connecting segments in one direction also conflict with the one-live-flight-per-direction schema. | Require persisted claimed-name confirmation, current read-back version and linked affirmative guest message; correction invalidates consent. Accept one selected trip-relevant inbound and outbound flight per guest, preserving other segments in rawExtraction; ask for clarification for multiple candidates in a direction. Tradeoff: extra clarification avoids silent overwrite. Do not change the flight table into a segment itinerary without a separate decision. |

Q7 also covers the resume-history case in §5.2: recommend draining the durable history before deciding whether the latest turn is parked, with separate replay-versus-live boundary handling so replay cannot deliver a queued message at an obsolete boundary. This is a proposed correction to the existing pump, requiring a fixture with a missing earlier boundary and later active-turn events; it is not permission to replace the pump.

New-question recommendation: detach/reset the browser thread and create a fresh conversation on next ask, preserving previous transcript for organizer DB review. Do not call edge's delete-chat path or erase Upload/AuditLog. Non-flight uploads stay read/discuss only; their retention/deletion deadline should use the same short upload cleanup policy after discussion, with pending failures retried, rather than indefinite storage.

## 10. Six implementation subtasks, in dependency order

All commands below are **future acceptance checks**, not commands run for this planning task. Tests/files listed here are future implementation artifacts. Start in `/Volumes/Sandisk/repositories/kaisewhite/club-athletic/apps/web`; use the existing unit/dom projects. No task may report successful live integration from mocks. **Coordinator** means a process with permission to bind sockets and reach Neon/Anthropic; the planning sandbox has neither. Capture runtime proof outside the repository, without secrets.

### Task 1 — Contracts, event storage and write boundary

Files: `src/lib/chat/{contracts,projections,event-projection,stream-blocks,chat-state,chat-controls,chat-live-activity,tool-presentation,tool-classify,state-copy,type-guards,sources,config}.ts`; `src/lib/db/{chat-client.server,chat-writes.server}.ts`; `src/lib/chat/repository.server.ts`; schema and additive migration from §4. Resolve Q4/Q6 schema representation first; test Q7 fixtures before preserving suspect behavior.

- [ ] Port contracts/projections and the event writer, keeping raw event identity/seq and exact serializers.
- [ ] Add `tests/unit/chat-contracts.test.ts`, `chat-projection.test.ts`, `chat-persistence.test.ts`, `chat-sources.test.ts`: exact five frame byte shapes, cumulative replacement, out-of-order/replayed rows, invocation pairing with narration, queued edits, strict source suffix/deduplication, and read/write import boundary.
- [ ] Run `bunx vitest run --project unit tests/unit/chat-contracts.test.ts tests/unit/chat-projection.test.ts tests/unit/chat-persistence.test.ts tests/unit/chat-sources.test.ts` and `bun run typecheck`; expected exit 0. Pure/injected persistence seams run without sockets/Neon.
- [ ] **Coordinator:** deploy the reviewed migration to a disposable Neon branch with `bun run db:migrate:deploy`; run planned `bash scripts/with-env.sh bun tests/integration/chat-persistence.ts`. It must allocate unique ordered rows under concurrent sends/replayed provider events, preserve existing seeded trip data, prove unique indexes/grants and disconnect in finally. Do not use production guest data for mutation tests.

### Task 2 — CMA lifecycle and React Router resource routes

Files: all server-managed-agent/runtime files in §4.1, `app/routes/api.chat.{conversations,conversation,status,stream,messages,cancel}.ts`, `app/routes.ts`, `server/app.ts`, `index.ts`; `tests/unit/chat-runtime.test.ts`, `tests/unit/chat-resource-routes.test.ts`. Add SDK only in this later task; resolve Q2 and the lifecycle recommendations of Q7.

- [ ] Port pump/send/cancel/backfill/recovery, replacing execution storage with Task 1 helper seams; no scheduler or automation host scaffolding.
- [ ] Return Response/ReadableStream from loader; retain exact SSE bytes/headers, 15s heartbeat, subscribe-before-replay and snapshot/state semantics. Wire abort/shutdown and single-pump ownership.
- [ ] Run `bunx vitest run --project unit tests/unit/chat-runtime.test.ts tests/unit/chat-resource-routes.test.ts` and `bun run build`; expected exit 0. Fake provider streams must test preview→durable handoff, duplicate replay, follow-up after completed turn, queue continuation, restart recovery, cancellation during replay, all unsubscribe/timer cleanup and unchanged frame names.
- [ ] **Coordinator:** with production build running only for a bounded check, `curl -N --max-time 20 -D /tmp/chat-port-stream.headers "$CHAT_BASE_URL/api/chat/conversations/$CHAT_CONVERSATION_ID/stream?after=-1" > /tmp/chat-port-stream.txt`. Expected headers, prompt first frame, 15s heartbeat or real frames; curl exit 28 is expected if healthy stream remains open at its bound. Reconnect with `Last-Event-ID` and verify duplicate-free durable rows plus current in-flight snapshot. Actual provider session evidence must show CMA, never Messages/AI SDK.

### Task 3 — Port the React consumer and decoded design

Files: `app/lib/chat/{api,detail-loader,use-auto-scroll}.ts`, every chat component in §4.3 except attachment, overview/app-shell/styles; `tests/components/chat.test.tsx`, `tests/unit/chat-sse-client.test.ts`, `tests/routes/chat-overview.test.tsx`. Resolve Q1 explicitly.

- [ ] Port the real subscriber, row projection, stream blocks, composer reducer and route controller; replace SPA initial fetch/cache with framework loader data. Keep stable conversation selection across section navigation.
- [ ] Enable the five exact source suggestions: “What time do I need to land?”, “How much are the open spots?”, “Which nights is there no chef dinner?”, “What are we doing Monday?”, “Where am I sleeping?”. Asking navigates to `/` and swaps tiles for compact tile chips/thread; New question resets selection. Preserve SRC_MAP in order: shuttle→`/shuttle`, flight→`/flights`, room→`/rooms`, spot/pric→`/spots`, chef→`/chef`, event/schedule→`/schedule`, chalet→`/chalet`, link→`/links`; dedupe sections matched by multiple keywords.
- [ ] Render normal answers as plain text, 1–3 sentences, fallback exactly `That's not in the trip notes yet — ask the organizer.`; trailing Source is parsed into chips, not shown as markdown. Ingestion turns are exempt from a fake source. Show blink loader until first visible token; persistent delivery failures keep draft.
- [ ] Run `bunx vitest run --project unit tests/unit/chat-sse-client.test.ts` and `bunx vitest run --project dom tests/components/chat.test.tsx tests/routes/chat-overview.test.tsx`; expected exit 0. Include UTF-8/chunk/CRLF split SSE fixtures, abort/no late update, tool accordion while streaming, replay parity, draft-on-failure, source navigation and no markdown execution. Existing page tests remain green.
- [ ] **Coordinator:** verify desktop 1280/1920 and mobile 390/859/860 with browser proof; no route-data regressions or horizontal composer overflow. Do not replace all ten section layouts to accommodate chat.

### Task 4 — Attachment transport and bookkeeping

Files: `app/components/chat/chat-attachment.tsx`, composer extension, `app/routes/api.chat.uploads.ts`, `src/lib/chat/{upload.server,rate-limit.server}.ts`, SDK wrapper/upload bookkeeping changes; `tests/unit/chat-upload.test.ts`, `tests/unit/chat-rate-limit.test.ts`, `tests/components/chat-attachment.test.tsx`. Resolve Q3/Q4/Q9 before external upload calls.

- [ ] Add only the listed picker/sniffer dependencies; implement picker/drop/paste through one path, chip/remove, explicit bounded multipart, sniff/resize/orientation/EXIF/hash and original/mounted/resource identity storage.
- [ ] Run `bunx vitest run --project unit tests/unit/chat-upload.test.ts tests/unit/chat-rate-limit.test.ts` and `bunx vitest run --project dom tests/components/chat-attachment.test.tsx`; expected exit 0. Fixtures cover .png-named PDF, invalid magic bytes, oversized/chunked body, corrupt/rotated images, PDF pass-through, duplicate hash, cross-conversation isolation, partial provider failure, cleanup retry and preview URL revocation. Bun.Image checks run with Bun in a planned `bun tests/integration/chat-image.ts` fixture harness, not by pretending node Vitest implements Bun.Image.
- [ ] **Coordinator:** upload an image and PDF via real resource route to the real CMA test session; prove mounted read succeeds and original versus mounted file IDs were stored distinctly. Delete both copies/resource according to verified API and confirm safe attachment label after reload. Capture only nonsecret IDs/statuses in external proof; delete fixture provider files on failure too.

### Task 5 — Trip tools and durable flight-intake conversation

Files: `src/lib/chat/tools/{read-tools.server,record-flight.server,flight-schema}.ts`, `src/lib/chat/runtime/tool-runner.server.ts`, `src/lib/chat/flight-intake.server.ts`, `src/lib/db/{flight-write-client.server,flight-writes.server,guest-lookup.server}.ts`, mapped custom-result handling; `tests/unit/flight-intake.test.ts`, `tests/unit/chat-tools.test.ts`. Separately authorized §4 configuration supplies the concierge/tools/skills before live acceptance; it is not part of this document task. Resolve Q5/Q6/Q8/Q10.

- [ ] Use the Anthropic sessions toolRunner, registered Zod tool schemas and existing read helpers. Agent reads the mounted path, stages nullable multi-leg candidates, asks identity, disambiguates, reads back and waits; no second model call for extraction.
- [ ] Run `bunx vitest run --project unit tests/unit/flight-intake.test.ts tests/unit/chat-tools.test.ts`; expected exit 0. Test unconfirmed/missing-name/missing-flight-number refusal, two Kristys, explicit new guest consent, expiry, corrections invalidate confirmation, wrong/non-flight uploads, prompt injection does not widen tools, and replayed tool ID cannot duplicate writes.
- [ ] **Coordinator:** `bash scripts/with-env.sh bun tests/integration/chat-flight-writes.ts` against disposable Neon. Verify two-direction atomic commit, failed-audit rollback, concurrent rebooking leaves exactly one live row per direction, old rows unchanged except both supersession columns, one audit per mutation, readonly role rejects writes and flight role cannot mutate Payment/Spot/GuestTask/Room/ScheduleDay/Link. Disconnect clients in finally; retain no test guests in the canonical trip.
- [ ] **Coordinator:** execute a real image/name/confirmation conversation through CMA, then reload `/flights`; actual provider custom-tool/result events and persisted rows must support the UI. Do not treat `confirmedByGuest: true` from model output alone as proof.

### Task 6 — Final real-user acceptance validation

Files for future checks: `tests/browser/chat.spec.ts`, `playwright.config.ts`, `scripts/chat-acceptance.sh`, `tests/integration/chat-evals.ts`; proof outside repo at `/tmp/chat-port-acceptance/`. **Coordinator must run all socket/Neon/Anthropic/browser checks.** The future acceptance script owns one production server PID/process group and closes browser contexts in finally; it must trap EXIT/INT/TERM and verify owned PIDs have exited with `kill -0` after wait. No `pgrep`, dev watch process or detached service.

- [ ] Run `bun run typecheck && bun run test && bun run build`; expected exit 0 and all existing plus new tests passing. Record actual counts, do not predict a number.
- [ ] Startup command inside that bounded harness: `NODE_ENV=production PORT=4313 bun index.ts`, with runtime environment loaded using existing `bash scripts/with-env.sh`. The harness records PID before waiting for readiness, imposes a 30s readiness deadline and 10-minute total deadline, and sends TERM/KILL only to its owned group on exit.
- [ ] Run `CHAT_BASE_URL=http://127.0.0.1:4313 bunx playwright test tests/browser/chat.spec.ts --workers=1` and `bash scripts/with-env.sh bun tests/integration/chat-evals.ts`. The spec owns/closes its browser; reports/screenshots/traces go under `/tmp/chat-port-acceptance/`, not repository artifacts.
- [ ] Real-user journey: load each of the ten routes (HTTP 200); submit a suggestion; see user row, blink dots, token text, paired tool status, final 1–3 sentence plain answer and source chip; navigate via chip/back; ask follow-up; interrupt or queue per Q1; disconnect/reconnect mid-answer; reload without duplicate rows; New question returns tile overview without deleting prior transcript.
- [ ] Upload journey: image/PDF; read-back round trip; printed passenger name still prompts confirmation; Kristy asks which; partial image asks missing field; correction replaces pending candidate; explicit yes saves both directions; rebooking supersedes and audits; `/flights` displays current rows; non-flight upload produces discussion and zero Flight writes; abandoned intake expires. Repeat a tool/provider replay and assert no additional Flight/AuditLog mutation.
- [ ] Capture sanitized transcript, screenshots at desktop/mobile widths, exact SSE frame transcript/cursors, provider CMA session/tool evidence, read-only SQL results for Message/Upload/PendingExtraction/Flight/AuditLog, file-deletion confirmation, exit codes and resulting test totals. Include a ninth-message probe and measured output-length/settings evidence for Q2's actual accepted resolution; do not claim hard caps from a short sample.
- [ ] Cleanup: abort provider test turns/tool runners; delete test uploaded/mounted resources; disconnect DB clients; close browser contexts; TERM and await the owned server, then use bounded KILL only if needed; verify `kill -0 <owned-pid>` fails for every recorded owned PID. The harness and model calls need explicit timeouts so failure cleanup runs.
- [ ] On any failure, fix the scoped port, rerun the complete end-to-end journey, and retain the failed and passing proof outside the repo. Completion is blocked on unresolved decisions affecting this acceptance, not on the existence of this plan.

## 11. Document-only verification

This task's entire deliverable is `docs/chat-port-plan.md`. The source HTML, TODO, root files, all apps source/package/schema/public files, and the entire edge repository remain read-only. No dependency installation, git add, commit, branch/worktree change, server start or database call is part of producing this file. A before/after hash manifest of the existing nonignored baseline supplements Git because an unborn repository's `git diff` cannot detect changes inside untracked files.

Run the user's exact acceptance command from the repository root and paste its output in the handoff:

```sh
test -f docs/chat-port-plan.md && wc -l docs/chat-port-plan.md && grep -c 'edge/apps' docs/chat-port-plan.md && git status --short && git diff --stat -- "docs/Meribel Trip 2027.html" docs/meribel-source-decoded.html apps/
```

Expected status remains the six baseline untracked entries (`.gitignore`, `CLAUDE.md`, `README.md`, `TODO.md`, `apps/`, `docs/`); Git collapses the new file beneath the already-untracked docs directory. Verify expanded untracked paths/hashes to distinguish the new plan from that baseline. The final diff-stat command must print nothing. Verify branch is still `main`. No secret values from any `.env` are recorded in this plan.
