// Ported from edge/apps/web-platform/src/lib/execution/execution-live-activity.ts; trip adaptations are local.
export type ConversationLiveActivityInput = {
  isLive: boolean;
  projectedActivity: string | null;
  runtimeStatus: string | null;
  lastEventSeq: number;
  optimisticLastEventSeq: number | null;
};

export type ConversationLiveActivity = {
  text: string | null;
  indicatorOnly: boolean;
};

export function resolveConversationLiveActivity(input: ConversationLiveActivityInput): ConversationLiveActivity {
  if (!input.isLive) return { text: null, indicatorOnly: false };
  if (input.projectedActivity) return { text: input.projectedActivity, indicatorOnly: false };

  const isOptimisticStartup =
    input.runtimeStatus === "starting" &&
    input.optimisticLastEventSeq !== null &&
    input.lastEventSeq <= input.optimisticLastEventSeq;

  return isOptimisticStartup
    ? { text: "Starting the conversation", indicatorOnly: false }
    : { text: null, indicatorOnly: true };
}
