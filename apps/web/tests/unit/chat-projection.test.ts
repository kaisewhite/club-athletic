import { describe, expect, it } from "vitest";
import type { SessionEventRow } from "../../src/lib/chat/contracts";
import { mapSessionEventsToPresentation, upsertSessionEventRow } from "../../src/lib/chat/event-projection";
import { hasFinalAssistantAfterLatestUser } from "../../src/lib/chat/chat-controls";
import { applyStreamDelta, unreconciledStreamingBlocks } from "../../src/lib/chat/stream-blocks";

const row = (seq: number, type: string, payload: SessionEventRow["payload"] = {}): SessionEventRow => ({ id: `row-${seq}`, seq, type, payload });

describe("edge row projection and Q7 regressions", () => {
  it("replaces same-seq delivery edits without advancing the durable cursor", () => {
    const queued = row(4, "user_message", { text: "What about Monday?", delivery: "queued" });
    const rows = upsertSessionEventRow([queued, row(5, "message", { text: "Checking." })], { ...queued, payload: { ...queued.payload, delivery: "sent" } });
    expect(rows).toHaveLength(2);
    expect(Math.max(...rows.map((event) => event.seq))).toBe(5);
    expect(mapSessionEventsToPresentation(rows).transcript[0]).toMatchObject({ kind: "user", queued: false, pending: false, failed: false });
  });

  it("recognizes mapper-supplied activity metadata on a completed final answer", () => {
    const rows = [row(0, "user_message", { text: "When?" }), row(1, "message", { text: "Land by 08:30.\nSource: Flights", canonicalEventId: "answer", activityEventId: "answer", providerEventId: "provider-answer", threadRole: "root", activityKind: "commentary", activityLabel: "Responding" }), row(2, "turn.completed")];
    expect(hasFinalAssistantAfterLatestUser(rows)).toBe(true);
    expect(mapSessionEventsToPresentation(rows).transcript[1]).toMatchObject({ kind: "prose", text: "Land by 08:30.", sourceSections: ["flights"] });
    expect(mapSessionEventsToPresentation(rows).currentActivity).toBeNull();
    expect(hasFinalAssistantAfterLatestUser(rows.slice(0, 2))).toBe(false);
    expect(hasFinalAssistantAfterLatestUser([...rows, row(3, "user_message", { text: "And back?" })])).toBe(false);
  });

  it("pairs invocation identities across narration and preserves live/replay parity", () => {
    const rows = [row(1, "tool_call", { toolName: "getSchedule", invocationId: "call", input: { day: "Monday" } }), row(2, "message", { text: "Checking Monday." }), row(3, "tool_result", { toolName: "getSchedule", invocationId: "call", result: [{ name: "Lunch" }] })];
    const live = [rows[2]!, rows[0]!, rows[1]!, rows[0]!].reduce(upsertSessionEventRow, []);
    expect(live.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(mapSessionEventsToPresentation(live)).toEqual(mapSessionEventsToPresentation(rows));
    expect(mapSessionEventsToPresentation(live).activity).toMatchObject([{ kind: "group", items: [{ status: "ok", outcome: "1 item returned." }] }, { kind: "prose" }]);
  });

  it("replaces cumulative previews and reconciles only canonical matches", () => {
    const first = { blockId: "preview", canonicalEventId: "answer", variant: "message" as const, text: "Land", done: false };
    const blocks = applyStreamDelta(applyStreamDelta([], first), { ...first, text: "Land by 08:30." });
    expect(blocks.map((block) => block.text)).toEqual(["Land by 08:30."]);
    expect(unreconciledStreamingBlocks(blocks, [row(1, "message", { canonicalEventId: "other" })])).toEqual(blocks);
    expect(unreconciledStreamingBlocks(blocks, [row(2, "message", { canonicalEventId: "answer" })])).toEqual([]);
    expect(applyStreamDelta(blocks, { ...first, done: true })).toEqual([]);
  });

  it("keeps the original display identity when provider history is redelivered", () => {
    const original = row(2, "message", { text: "Land by 08:30.", providerEventId: "provider", canonicalEventId: "canonical", threadRole: "root" });
    const replay = { ...row(9, "message", { text: "Land by 08:30.", providerEventId: "provider", canonicalEventId: "canonical", threadRole: "root" }), id: "backfill" };
    expect(upsertSessionEventRow([original], replay)).toEqual([original]);
    expect(mapSessionEventsToPresentation([original, replay]).transcript).toHaveLength(1);
  });

  it("does not mistake child commentary or a failed turn for a completed root answer", () => {
    const child = row(1, "message", { text: "Found it.", threadId: "child", threadRole: "child", activityKind: "commentary" });
    expect(hasFinalAssistantAfterLatestUser([child, row(2, "turn.completed")])).toBe(false);
    expect(hasFinalAssistantAfterLatestUser([row(1, "message", { text: "Checking." }), row(2, "turn.failed")])).toBe(false);
    expect(hasFinalAssistantAfterLatestUser([row(1, "message", { text: "Answer." }), row(2, "turn.completed"), row(3, "turn.started")])).toBe(false);
    expect(hasFinalAssistantAfterLatestUser([row(1, "message", { text: "Checking." }), row(2, "tool_call"), row(3, "tool_result"), row(4, "turn.completed")])).toBe(false);
    expect(mapSessionEventsToPresentation([child]).transcript).toEqual([]);
  });

  it("projects retained attachment metadata and failed delivery honestly", () => {
    const upload = { id: "upload", filename: "booking.pdf", mimeType: "application/pdf", sizeBytes: 100 };
    expect(mapSessionEventsToPresentation([row(1, "user_message", { text: "My booking", delivery: "failed", upload })]).transcript).toEqual([
      { id: "row-1", kind: "user", text: "My booking", failed: true, pending: false, queued: false, upload },
    ]);
  });

  it("honors a mapper tool failure even when no error message was supplied", () => {
    const rows = [row(1, "tool_call", { toolName: "getRooms", invocationId: "call" }), row(2, "tool_result", { toolName: "getRooms", invocationId: "call", ok: false })];
    expect(mapSessionEventsToPresentation(rows).activity).toMatchObject([{ kind: "group", items: [{ status: "error", outcome: "Tool reported an error." }] }]);
  });

  it("uses canonical thread-qualified identity before a reused provider event id", () => {
    const root = row(1, "message", { text: "Root", providerEventId: "same-provider-id", canonicalEventId: "root:event", threadRole: "root" });
    const child = row(2, "message", { text: "Child", providerEventId: "same-provider-id", canonicalEventId: "child:event", threadId: "child", threadRole: "child" });
    expect(upsertSessionEventRow([root], child)).toEqual([root, child]);
    expect(mapSessionEventsToPresentation([root, child]).activity).toHaveLength(2);
  });

  it("does not settle a continued provider boundary before the queued reply", () => {
    const ongoing = [row(0, "user_message", { text: "When?" }), row(1, "message", { text: "Land by 08:30.", threadRole: "root", activityKind: "commentary" }), row(2, "turn.completed", { continuation: true })];
    expect(hasFinalAssistantAfterLatestUser(ongoing)).toBe(false);
    expect(hasFinalAssistantAfterLatestUser([...ongoing, row(3, "turn.started"), row(4, "message", { text: "And leave after 11:00.", threadRole: "root", activityKind: "commentary" }), row(5, "turn.completed")])).toBe(true);
  });
});
