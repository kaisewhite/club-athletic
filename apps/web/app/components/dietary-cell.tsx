import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useFetcher, useInRouterContext } from "react-router";

type DietaryResponse = { ok: boolean; dietaryNotes?: string | null; error?: string };

type DietaryCellProps = { guestId: string; guestName: string; dietaryNotes: string | null };
export type DietaryCopyGuest = { displayName: string; dietaryNotes: string | null };

export function DietaryCopyButton({ guests }: { guests: DietaryCopyGuest[] }) {
  return useInRouterContext() ? <InteractiveDietaryCopyButton guests={guests} /> : null;
}

function InteractiveDietaryCopyButton({ guests }: { guests: DietaryCopyGuest[] }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);
  const copy = async () => {
    const text = guests.map(({ displayName, dietaryNotes }) => `${displayName}: ${dietaryNotes ?? "—"}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setStatus("idle"), 2_000);
    } catch {
      setStatus("failed");
    }
  };
  const label = status === "copied" ? "Dietary requirements copied" : status === "failed" ? "Could not copy dietary requirements" : "Copy dietary requirements";
  return <>
    <button type="button" className="dietary-copy-button" aria-label={label} title={label} onClick={() => void copy()}>
      {status === "copied" ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
        : status === "failed" ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5m0 3h.01M10.3 3.9 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3l-7.6-13.1a2 2 0 0 0-3.4 0Z" /></svg>
          : <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2" /></svg>}
    </button>
    <span className="sr-only" role="status" aria-live="polite">{status === "copied" ? "Dietary requirements copied to clipboard." : status === "failed" ? "Could not copy dietary requirements." : ""}</span>
  </>;
}

export function DietaryCell(props: DietaryCellProps) {
  return useInRouterContext() ? <InteractiveDietaryCell {...props} /> : props.dietaryNotes ?? <span className="dietary-cell-empty">Add allergies or dietary needs</span>;
}

function InteractiveDietaryCell({ guestId, guestName, dietaryNotes }: DietaryCellProps) {
  const fetcher = useFetcher<DietaryResponse>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(dietaryNotes ?? "");
  const [error, setError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const submitted = useRef(false);
  const saving = fetcher.state !== "idle";

  useEffect(() => {
    if (!editing || saving) return;

    const input = textarea.current;

    if (!input) return;

    input.style.height = "auto";
    input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`;
    input.focus();
    input.select();
  }, [editing, saving]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !submitted.current) return;
    submitted.current = false;
    if (fetcher.data?.ok) {
      setEditing(false);
      setError(null);
    } else {
      setError(fetcher.data?.error ?? "Could not save. Try again.");
    }
  }, [fetcher.state, fetcher.data]);

  const begin = () => {
    if (saving) return;
    setDraft(dietaryNotes ?? "");
    setError(null);
    setEditing(true);
  };
  const submit = () => {
    if (submitted.current || saving) return;
    submitted.current = true;
    setError(null);
    fetcher.submit({ guestId, dietaryNotes: draft }, { method: "post", action: "/api/guests/dietary", encType: "application/json" });
  };
  const cancel = () => {
    if (saving) return;
    setDraft(dietaryNotes ?? "");
    setError(null);
    setEditing(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") { event.preventDefault(); cancel(); }
    else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
  };

  if (!editing) return <button type="button" className={`dietary-cell-button${dietaryNotes ? "" : " is-empty"}`} aria-label={`Edit dietary needs for ${guestName}`} onClick={begin} onDoubleClick={begin}>
    {dietaryNotes ?? <span className="dietary-cell-empty">Add allergies or dietary needs</span>}
    <span className="dietary-cell-edit" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 20h9" /><path d="m16.5 3.5 4 4L8 20l-5 1 1-5Z" /></svg></span>
  </button>;

  return <div className="dietary-cell-editor">
    <textarea ref={textarea} className="dietary-cell-textarea" rows={1} maxLength={500} value={draft} disabled={saving} aria-label={`Dietary needs for ${guestName}`} onChange={(event) => { const input = event.currentTarget; setDraft(input.value); setError(null); input.style.height = "auto"; input.style.height = `${input.scrollHeight}px`; }} onKeyDown={onKeyDown} onBlur={() => { if (!saving) submit(); }} />
    {saving && <span className="dietary-cell-hint" role="status">Saving…</span>}
    {error && <span className="dietary-cell-error" role="alert">{error}</span>}
  </div>;
}
