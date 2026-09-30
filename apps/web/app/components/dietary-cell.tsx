import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useFetcher, useInRouterContext } from "react-router";

type DietaryResponse = { ok: boolean; dietaryNotes?: string | null; error?: string };

type DietaryCellProps = { guestId: string; guestName: string; dietaryNotes: string | null };
export type DietaryCopyGuest = { displayName: string; dietaryNotes: string | null };

export function DietaryCopyButton({ guests }: { guests: DietaryCopyGuest[] }) {
  return useInRouterContext() ? <InteractiveDietaryCopyButton guests={guests} /> : null;
}

function InteractiveDietaryCopyButton({ guests }: { guests: DietaryCopyGuest[] }) {
  const [label, setLabel] = useState("Copy");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);
  const copy = async () => {
    const text = guests.map(({ displayName, dietaryNotes }) => `${displayName}: ${dietaryNotes ?? "—"}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setLabel("Copied");
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setLabel("Copy"), 2_000);
    } catch {
      setLabel("Copy failed");
    }
  };
  return <button type="button" className="dietary-copy-button" aria-label="Copy dietary requirements" onClick={() => void copy()}>{label}</button>;
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
    textarea.current?.focus();
    textarea.current?.select();
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
    <span className="dietary-cell-edit" aria-hidden="true">✎</span>
  </button>;

  return <div className="dietary-cell-editor">
    <textarea ref={textarea} className="dietary-cell-textarea" rows={1} maxLength={500} value={draft} disabled={saving} aria-label={`Dietary needs for ${guestName}`} onChange={(event) => { const input = event.currentTarget; setDraft(input.value); setError(null); input.style.height = "auto"; input.style.height = `${input.scrollHeight}px`; }} onKeyDown={onKeyDown} onBlur={() => { if (!saving) submit(); }} />
    {saving && <span className="dietary-cell-hint" role="status">Saving…</span>}
    {error && <span className="dietary-cell-error" role="alert">{error}</span>}
  </div>;
}
