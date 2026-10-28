import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useFetcher, useInRouterContext } from "react-router";

type CocktailResponse = { ok: boolean; favoriteCocktails?: string | null; error?: string };
type CocktailCellProps = { guestId: string; guestName: string; favoriteCocktails: string | null };

export function FavoriteCocktailsCell(props: CocktailCellProps) {
  return useInRouterContext() ? <InteractiveFavoriteCocktailsCell {...props} />
    : props.favoriteCocktails ?? <span className="dietary-cell-empty">Add favorite cocktails</span>;
}

function InteractiveFavoriteCocktailsCell({ guestId, guestName, favoriteCocktails }: CocktailCellProps) {
  const fetcher = useFetcher<CocktailResponse>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(favoriteCocktails ?? "");
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
    } else setError(fetcher.data?.error ?? "Could not save. Try again.");
  }, [fetcher.state, fetcher.data]);

  const begin = () => {
    if (saving) return;
    setDraft(favoriteCocktails ?? "");
    setError(null);
    setEditing(true);
  };
  const submit = () => {
    if (submitted.current || saving) return;
    submitted.current = true;
    setError(null);
    fetcher.submit({ guestId, favoriteCocktails: draft }, { method: "post", action: "/api/guests/cocktails", encType: "application/json" });
  };
  const cancel = () => {
    if (saving) return;
    setDraft(favoriteCocktails ?? "");
    setError(null);
    setEditing(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") { event.preventDefault(); cancel(); }
    else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
  };

  if (!editing) return <button type="button" className={`dietary-cell-button${favoriteCocktails ? "" : " is-empty"}`} aria-label={`Edit favorite cocktails for ${guestName}`} onClick={begin}>
    {favoriteCocktails ?? <span className="dietary-cell-empty">Add favorite cocktails</span>}
    <span className="dietary-cell-edit" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 20h9" /><path d="m16.5 3.5 4 4L8 20l-5 1 1-5Z" /></svg></span>
  </button>;

  return <div className="dietary-cell-editor">
    <textarea ref={textarea} className="dietary-cell-textarea" rows={1} maxLength={300} value={draft} disabled={saving} aria-label={`Favorite cocktails for ${guestName}`}
      onChange={(event) => { const input = event.currentTarget; setDraft(input.value); setError(null); input.style.height = "auto"; input.style.height = `${input.scrollHeight}px`; }}
      onKeyDown={onKeyDown} onBlur={() => { if (!saving) submit(); }} />
    {saving && <span className="dietary-cell-hint" role="status">Saving…</span>}
    {error && <span className="dietary-cell-error" role="alert">{error}</span>}
  </div>;
}
