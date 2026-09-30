// Ported from edge/apps/web-platform/src/lib/ui/stream-blocks.ts; trip adaptations are local.
// Stream-block helpers accumulate live token deltas into transient activity
// events. Deltas carry cumulative text, so applying one is a replace, not an
// append; `done` finalizes a block (its durable row then carries the text).
import type { ActivityEvent, SessionEventRow, StreamDelta } from "./contracts";

function streamBlockIdentity(block: StreamDelta): string {
  return block.canonicalEventId ?? block.blockId;
}

function durableRowIdentity(row: SessionEventRow): string | null {
  return row.payload.canonicalEventId ?? row.payload.activityEventId ?? null;
}

/** Upsert or remove one in-flight streaming block, preserving arrival order. */
export function applyStreamDelta(blocks: StreamDelta[], delta: StreamDelta): StreamDelta[] {
  const index = blocks.findIndex((block) => block.blockId === delta.blockId);
  if (delta.done) {
    return index === -1 ? blocks : blocks.filter((_, blockIndex) => blockIndex !== index);
  }
  if (index === -1) return [...blocks, delta];

  const next = [...blocks];
  next[index] = delta;
  return next;
}

/** Drop transient blocks once their durable row is present; durable rows own final rendering. */
export function unreconciledStreamingBlocks(blocks: StreamDelta[], rows: SessionEventRow[]): StreamDelta[] {
  if (blocks.length === 0 || rows.length === 0) return blocks;
  const durableIds = new Set(rows.map(durableRowIdentity).filter((id): id is string => id !== null));
  return blocks.filter((block) => !durableIds.has(streamBlockIdentity(block)));
}

/** Project an in-flight streaming block into its transient activity event. */
export function streamingBlockToEvent(block: StreamDelta): ActivityEvent {
  const metadata = Object.fromEntries(
    [
      ["threadId", block.threadId],
      ["parentThreadId", block.parentThreadId],
      ["threadRole", block.threadRole],
      ["agentName", block.agentName],
      ["activityKind", block.activityKind],
      ["activityLabel", block.activityLabel],
      ["toolName", block.toolName],
      ["canonicalEventId", block.canonicalEventId],
      ["providerEventId", block.providerEventId],
    ].filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => entry[1] !== undefined),
  );
  return block.variant === "reasoning"
    ? { id: block.blockId, kind: "reasoning", text: block.text, ...metadata }
    : { id: block.blockId, kind: "prose", text: block.text, ...metadata };
}
