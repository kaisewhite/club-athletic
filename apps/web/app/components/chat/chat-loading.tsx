// edge's TranscriptSkeleton, without unrelated dashboard/UI dependencies.
export function ChatLoading({ label = "Loading conversation…" }: { label?: string }) {
  return <div className="chat-loading" role="status" aria-live="polite" aria-label={label}>
    <span className="wide" /><span /><span className="tool" /><span className="short" />
  </div>;
}
