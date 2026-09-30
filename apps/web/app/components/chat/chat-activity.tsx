// Port of edge's AgentActivityStream; decoded design's blink replaces its spinner.
export function ChatActivity({ currentActivity, indicatorOnly = false }: {
  currentActivity: string | null; indicatorOnly?: boolean;
}) {
  if (!currentActivity && !indicatorOnly) return null;
  return <div className="chat-activity" role="status" aria-live="polite" aria-label="Thinking">
    <span className="chat-dots" aria-hidden="true">{[0, 1, 2].map(i => <span key={i} style={{ animationDelay: `${i * .2}s` }} />)}</span>
    {currentActivity && <span>{currentActivity}</span>}
  </div>;
}
