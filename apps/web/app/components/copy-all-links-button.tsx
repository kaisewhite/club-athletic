import { useEffect, useRef, useState } from "react";

export function CopyAllLinksButton({ links }: { links: string[] }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(links.join("\n"));
      setStatus("copied");
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setStatus("idle"), 2_000);
    } catch {
      setStatus("failed");
    }
  };

  const label = status === "copied" ? "Instagram links copied" : status === "failed" ? "Could not copy Instagram links" : "Copy all Instagram links";
  return <>
    <button type="button" className="guest-copy-all" onClick={() => void copy()}>{label}</button>
    <span className="sr-only" role="status" aria-live="polite">{status === "copied" ? "All Instagram links copied to the clipboard." : status === "failed" ? "Could not copy the Instagram links." : ""}</span>
  </>;
}
