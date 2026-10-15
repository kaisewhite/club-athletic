import { useEffect, useRef, useState } from "react";

export function ScheduleCopyButton({ dayLabel, text }: { dayLabel: string; text: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setStatus("idle"), 2_000);
    } catch {
      setStatus("failed");
    }
  };

  const label = status === "copied" ? `${dayLabel} copied` : status === "failed" ? `Could not copy ${dayLabel}` : `Copy ${dayLabel}`;
  return <>
    <button type="button" className="schedule-copy-button" aria-label={label} title={label} onClick={() => void copy()}>
      {status === "copied" ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
        : status === "failed" ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5m0 3h.01M10.3 3.9 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3l-7.6-13.1a2 2 0 0 0-3.4 0Z" /></svg>
          : <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2" /></svg>}
    </button>
    <span className="sr-only" role="status" aria-live="polite">{status === "copied" ? `${dayLabel} copied to clipboard.` : status === "failed" ? `Could not copy ${dayLabel}.` : ""}</span>
  </>;
}
