// In-memory relay fanout keeps live SSE subscribers attached to persisted conversation
// activity without polling the database for every connected client. It also
// carries ephemeral token deltas and session-lifecycle `state` frames, which
// are forwarded live but never persisted.
import type { SessionEventRecord } from "../projections";
import type { ConversationSessionStateFrame, StreamDelta } from "../contracts";
import { conversationDebugLog } from "./chat-debug.server";

export type ConversationEventListener = (seq: number, row: SessionEventRecord) => void;
export type ConversationDeltaListener = (delta: StreamDelta) => void;
export type ConversationStateListener = (frame: ConversationSessionStateFrame) => void;

export interface ConversationEventRelay {
  /** Publish one persisted session event to every live subscriber for its conversation. */
  publish(conversationId: string, seq: number, row: SessionEventRecord): void;
  /** Publish one ephemeral token delta to every live subscriber for its conversation. */
  publishDelta(conversationId: string, delta: StreamDelta): void;
  /** Remove one in-flight delta from reconnect snapshots without notifying live listeners. */
  clearDelta(conversationId: string, blockId: string): void;
  /** Snapshot the current in-flight delta blocks for replay/reconnect recovery. */
  snapshotDeltas(conversationId: string): StreamDelta[];
  /** Publish one ephemeral session-state frame to every live subscriber. */
  publishState(conversationId: string, frame: ConversationSessionStateFrame): void;
  /** Subscribe one listener to the live persisted-event feed for a specific conversation. */
  subscribe(conversationId: string, listener: ConversationEventListener): () => void;
  /** Subscribe one listener to the live token-delta feed for a specific conversation. */
  subscribeDeltas(conversationId: string, listener: ConversationDeltaListener): () => void;
  /** Subscribe one listener to the live session-state feed for a specific conversation. */
  subscribeState(conversationId: string, listener: ConversationStateListener): () => void;
}

/** Create one isolated live relay so tests can avoid sharing subscriber state. */
export function createConversationEventRelay(): ConversationEventRelay {
  const listenersByConversation = new Map<string, Set<ConversationEventListener>>();
  const deltaListenersByConversation = new Map<string, Set<ConversationDeltaListener>>();
  const deltaSnapshotsByConversation = new Map<string, Map<string, StreamDelta>>();
  const stateListenersByConversation = new Map<string, Set<ConversationStateListener>>();

  function subscribeTo<L>(map: Map<string, Set<L>>, conversationId: string, listener: L): () => void {
    const listeners = map.get(conversationId) ?? new Set<L>();
    listeners.add(listener);
    map.set(conversationId, listeners);

    return () => {
      const active = map.get(conversationId);
      if (!active) {
        return;
      }
      active.delete(listener);
      if (active.size === 0) {
        map.delete(conversationId);
      }
    };
  }

  return {
    publish(conversationId, seq, row) {
      const listeners = listenersByConversation.get(conversationId);
      conversationDebugLog("relay.publish.activity", {
        conversationId,
        seq,
        rowId: row.id,
        rowType: row.type,
        listenerCount: listeners?.size ?? 0,
      });
      if (!listeners || listeners.size === 0) {
        return;
      }
      for (const listener of [...listeners]) {
        listener(seq, row);
      }
    },
    publishDelta(conversationId, delta) {
      const current = deltaSnapshotsByConversation.get(conversationId) ?? new Map<string, StreamDelta>();
      if (delta.done) {
        current.delete(delta.blockId);
      } else {
        current.set(delta.blockId, delta);
      }
      if (current.size === 0) {
        deltaSnapshotsByConversation.delete(conversationId);
      } else {
        deltaSnapshotsByConversation.set(conversationId, current);
      }

      const listeners = deltaListenersByConversation.get(conversationId);
      conversationDebugLog("relay.publish.delta", {
        conversationId,
        blockId: delta.blockId,
        variant: delta.variant,
        done: delta.done,
        threadId: delta.threadId ?? null,
        agentName: delta.agentName ?? null,
        textLength: delta.text.length,
        listenerCount: listeners?.size ?? 0,
        snapshotCount: current.size,
      });
      if (!listeners || listeners.size === 0) {
        return;
      }
      for (const listener of [...listeners]) {
        listener(delta);
      }
    },
    clearDelta(conversationId, blockId) {
      const current = deltaSnapshotsByConversation.get(conversationId);
      if (!current) return;
      current.delete(blockId);
      if (current.size === 0) {
        deltaSnapshotsByConversation.delete(conversationId);
      }
      conversationDebugLog("relay.clear.delta", { conversationId, blockId, snapshotCount: current.size });
    },
    snapshotDeltas(conversationId) {
      return [...(deltaSnapshotsByConversation.get(conversationId)?.values() ?? [])];
    },
    publishState(conversationId, frame) {
      const listeners = stateListenersByConversation.get(conversationId);
      conversationDebugLog("relay.publish.state", {
        conversationId,
        status: frame.status,
        runtimeStatus: frame.runtimeStatus,
        activeRequestIdPresent: frame.activeRequestIdPresent,
        activeTurnId: frame.activeTurnId,
        waitingOnApproval: frame.waitingOnApproval,
        listenerCount: listeners?.size ?? 0,
      });
      if (!listeners || listeners.size === 0) {
        return;
      }
      for (const listener of [...listeners]) {
        listener(frame);
      }
    },
    subscribe(conversationId, listener) {
      conversationDebugLog("relay.subscribe.activity", { conversationId });
      return subscribeTo(listenersByConversation, conversationId, listener);
    },
    subscribeDeltas(conversationId, listener) {
      conversationDebugLog("relay.subscribe.delta", { conversationId });
      return subscribeTo(deltaListenersByConversation, conversationId, listener);
    },
    subscribeState(conversationId, listener) {
      conversationDebugLog("relay.subscribe.state", { conversationId });
      return subscribeTo(stateListenersByConversation, conversationId, listener);
    },
  };
}

const processRelay = globalThis as typeof globalThis & { __clubAthleticChatRelay?: ConversationEventRelay };
export const conversationEventRelay = processRelay.__clubAthleticChatRelay ??= createConversationEventRelay();
