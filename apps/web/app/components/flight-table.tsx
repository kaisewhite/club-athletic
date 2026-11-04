import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { Check, MagnifyingGlass, PencilSimple, X } from "@phosphor-icons/react/ssr";
import { flexRender, tableFeatures, useTable, type ColumnDef, type Row } from "@tanstack/react-table";
import type { FlightTable } from "@/lib/db/repository.server";
import { airportLocalTime, airportTimeZone } from "@/lib/db/airport-timezones";
import { fromZonedTime } from "date-fns-tz";
import { GuestInstagramLink } from "./guest-instagram-link";

type GuestFlight = FlightTable[number];
type Leg = NonNullable<GuestFlight["inbound"]>;
const features = tableFeatures({});
const mobileQuery = "(max-width: 859px)";
function subscribeMobile(onChange: () => void) {
  const media = window.matchMedia(mobileQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const mobileSnapshot = () => window.matchMedia(mobileQuery).matches;
const serverSnapshot = () => false;
function Missing() { return <span style={{ color: "var(--text-faint)" }}>—</span>; }

function FlightName({ leg }: { leg: Leg | null }) {
  if (!leg) return <Missing />;
  const number = [leg.airline, leg.flightNumber].filter(Boolean).join(" ");
  // Route, and the flight number when it is known. Nothing about where the row
  // came from or when it was confirmed (owner, 2026-09-29: "keep this clean").
  return <><span className="flight-route">{leg.origin} to {leg.destination}</span>{number && <> · {number}</>}</>;
}

function FlightTime({ local }: { local: string | undefined }) {
  if (!local) return <Missing />;
  // The query already supplied the airport-local date, time and offset.
  // Format only its calendar date; never convert it to another timezone.
  const date = new Date(`${local.slice(0, 10)}T00:00:00Z`);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(date);
  return <time dateTime={local}>{day} · {local.slice(11, 16)}</time>;
}

function GuestName({ guest }: { guest: GuestFlight }) {
  return <GuestInstagramLink displayName={guest.displayName} instagramUrl={guest.instagramUrl} />;
}

const columns: ColumnDef<typeof features, GuestFlight>[] = [
  { id: "guest", accessorKey: "displayName", header: "Guest", cell: ({ row }) => <GuestName guest={row.original} /> },
  { id: "arriving", header: "Arriving", columns: [
    { id: "inFlight", header: "Flight", cell: ({ row }) => <FlightName leg={row.original.inbound} /> },
    { id: "arrival", header: "Times", cell: ({ row }) => <FlightSchedule leg={row.original.inbound} inbound /> },
  ] },
  { id: "departing", header: "Departing", columns: [
    { id: "outFlight", header: "Flight", cell: ({ row }) => <FlightName leg={row.original.outbound} /> },
    { id: "departure", header: "Times", cell: ({ row }) => <FlightSchedule leg={row.original.outbound} /> },
  ] },
  { id: "actions", header: "Edit", cell: () => null },
];

function FlightSchedule({ leg, inbound = false, edit }: { leg: Leg | null; inbound?: boolean; edit?: FlightRowEditorState }) {
  if (!leg && !edit) return <Missing />;
  const direction = inbound ? "inbound" : "outbound";
  const directionLabel = inbound ? "Arrival" : "Return";
  const draft = edit?.draft[direction];
  const dateTimeField = (dateKey: "departureDate" | "arrivalDate", timeKey: "departureTime" | "arrivalTime", label: string) => {
    const value = draft?.[dateKey] && draft[timeKey] ? `${draft[dateKey]}T${draft[timeKey]}` : "";
    const timeName = inbound ? (label === "Departure" ? "departure" : "landing") : label.toLowerCase();
    return <input className="flight-inline-datetime" form={edit?.formId} type="datetime-local" aria-label={`${directionLabel} ${timeName} date and time`}
      value={value} disabled={edit?.busy} onChange={(event) => {
        const [date = "", time = ""] = event.currentTarget.value.split("T");
        edit?.setLegField(direction, dateKey, date);
        edit?.setLegField(direction, timeKey, time);
      }} />;
  };
  return <dl className="flight-schedule">
    <div><dt>{inbound ? "Departs" : "Departs GVA"}</dt><dd>{edit ? dateTimeField("departureDate", "departureTime", "Departure") : <FlightTime local={leg?.departureLocal} />}</dd></div>
    <div><dt>{inbound ? "Lands GVA" : "Arrives"}</dt><dd>{edit ? dateTimeField("arrivalDate", "arrivalTime", "Arrival") : <FlightTime local={leg?.arrivalLocal} />}</dd></div>
  </dl>;
}

type DraftLeg = {
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureDate: string;
  departureTime: string;
  arrivalDate: string;
  arrivalTime: string;
};
type RowDraft = { displayName: string; inbound: DraftLeg; outbound: DraftLeg };
type SavedEdit = { displayName: string; legs: { direction: "INBOUND" | "OUTBOUND"; flightId: string }[] };
type FlightRowEditorState = {
  draft: RowDraft;
  formId: string;
  busy: boolean;
  error: string;
  message: string;
  lookupBusy: "inbound" | "outbound" | null;
  lookup: (direction: "inbound" | "outbound") => void;
  submit: (event: FormEvent<HTMLFormElement>) => void;
  setDisplayName: (value: string) => void;
  setLegField: (direction: "inbound" | "outbound", field: keyof DraftLeg, value: string) => void;
};

function draftLeg(leg: Leg | null): DraftLeg {
  return {
    airline: leg?.airline ?? "", flightNumber: leg?.flightNumber ?? "", origin: leg?.origin ?? "", destination: leg?.destination ?? "",
    departureDate: leg?.departureLocal.slice(0, 10) ?? "", departureTime: leg?.departureLocal.slice(11, 16) ?? "",
    arrivalDate: leg?.arrivalLocal.slice(0, 10) ?? "", arrivalTime: leg?.arrivalLocal.slice(11, 16) ?? "",
  };
}

function hasDraftValue(value: DraftLeg) { return Object.values(value).some((field) => field.trim() !== ""); }
function legSignature(value: DraftLeg) {
  return JSON.stringify({ ...value, airline: value.airline.trim(), flightNumber: value.flightNumber.trim(), origin: value.origin.trim().toUpperCase(), destination: value.destination.trim().toUpperCase() });
}

function FlightFlightFields({ direction, editor }: { direction: "inbound" | "outbound"; editor: FlightRowEditorState }) {
  const directionLabel = direction === "inbound" ? "Arrival" : "Return";
  const fields: { key: "origin" | "destination" | "airline" | "flightNumber"; label: string; placeholder: string; maxLength: number }[] = [
    { key: "origin", label: "From", placeholder: "e.g. JFK", maxLength: 3 },
    { key: "destination", label: "To", placeholder: "e.g. GVA", maxLength: 3 },
    { key: "airline", label: "Airline", placeholder: "e.g. United", maxLength: 80 },
    { key: "flightNumber", label: "Flight number", placeholder: "e.g. UA956", maxLength: 30 },
  ];
  return <>
  <div className="flight-lookup">
    <label className="flight-inline-field"><span>Flight number</span><input form={editor.formId} type="text" maxLength={30} placeholder="e.g. UA956" value={editor.draft[direction].flightNumber} disabled={editor.busy || editor.lookupBusy !== null}
      aria-label={`${directionLabel} flight number for lookup`} autoCapitalize="characters" onChange={(event) => editor.setLegField(direction, "flightNumber", event.currentTarget.value)} /></label>
    <label className="flight-inline-field"><span>Departure date</span><input form={editor.formId} type="date" value={editor.draft[direction].departureDate} disabled={editor.busy || editor.lookupBusy !== null}
      aria-label={`${directionLabel} flight departure date for lookup`} onChange={(event) => editor.setLegField(direction, "departureDate", event.currentTarget.value)} /></label>
    <button type="button" className="flight-lookup-button" onClick={() => editor.lookup(direction)} disabled={editor.busy || editor.lookupBusy !== null || !editor.draft[direction].flightNumber.trim() || !editor.draft[direction].departureDate}
      aria-label={`Find ${directionLabel.toLowerCase()} flight details`}><MagnifyingGlass aria-hidden="true" size={16} />{editor.lookupBusy === direction ? "Looking up…" : "Find flight"}</button>
  </div>
  <p className="flight-lookup-credit">Flight lookup by <a href="https://aerodatabox.com/" target="_blank">AeroDataBox</a></p>
  <div className="flight-inline-fields">{fields.filter(({ key }) => key !== "flightNumber").map(({ key, label, placeholder, maxLength }) => <label className="flight-inline-field" key={key}>
    <span>{label}</span><input form={editor.formId} type="text" maxLength={maxLength} placeholder={placeholder} value={editor.draft[direction][key]} disabled={editor.busy}
      aria-label={`${directionLabel} flight ${label.toLowerCase()}`} autoCapitalize={key === "origin" || key === "destination" ? "characters" : undefined}
      onChange={(event) => editor.setLegField(direction, key, event.currentTarget.value)} />
  </label>)}</div></>;
}

function FlightEditActions({ guest, editor, onCancel }: { guest: GuestFlight; editor: FlightRowEditorState; onCancel: () => void }) {
  return <form id={editor.formId} className="flight-inline-actions" onSubmit={editor.submit}>
    <div className="flight-inline-action-buttons">
      <button type="submit" className="flight-edit-save" aria-label={`Save flight details for ${guest.displayName}`} title="Save changes" disabled={editor.busy}>
        <Check aria-hidden="true" size={18} weight="bold" />
      </button>
      <button type="button" className="flight-edit-cancel" aria-label={`Cancel editing ${guest.displayName}`} title="Cancel editing" onClick={onCancel} disabled={editor.busy}>
        <X aria-hidden="true" size={18} />
      </button>
    </div>
    {editor.error && <p className="flight-edit-error" role="alert">{editor.error}</p>}
    {editor.message && <p className="flight-edit-status" role="status" aria-live="polite">{editor.message}</p>}
  </form>;
}

function FlightRowEditor({ guest, onSaved, children }: { guest: GuestFlight; onSaved: (draft: RowDraft, result: SavedEdit) => void; children: (editor: FlightRowEditorState) => ReactNode }) {
  const [draft, setDraft] = useState<RowDraft>(() => ({ displayName: guest.displayName, inbound: draftLeg(guest.inbound), outbound: draftLeg(guest.outbound) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [lookupBusy, setLookupBusy] = useState<"inbound" | "outbound" | null>(null);
  const formId = `flight-edit-${useId().replaceAll(":", "")}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setMessage("");
    const changes: Array<{ direction: "INBOUND" | "OUTBOUND"; expectedFlightId: string | null } & DraftLeg> = [];
    for (const direction of ["INBOUND", "OUTBOUND"] as const) {
      const key = direction === "INBOUND" ? "inbound" : "outbound";
      const current = guest[key];
      const value = draft[key];
      if (current && legSignature(value) === legSignature(draftLeg(current))) continue;
      if (!current && !hasDraftValue(value)) continue;
      if (![value.origin, value.destination, value.departureDate, value.departureTime, value.arrivalDate, value.arrivalTime].every((field) => field.trim())) {
        setError(`${direction === "INBOUND" ? "Arrival" : "Return"} flight needs both airports and departure/arrival date and time.`);
        return;
      }
      changes.push({ direction, expectedFlightId: current?.id ?? null, ...value });
    }
    if (draft.displayName.trim() === guest.displayName && changes.length === 0) { setMessage("No changes to save."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/flight-details", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId: guest.id, displayName: draft.displayName, legs: changes.map((leg) => ({
          ...leg, airline: leg.airline.trim() || null, flightNumber: leg.flightNumber.trim() || null,
          origin: leg.origin.trim().toUpperCase(), destination: leg.destination.trim().toUpperCase(),
        })) }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok || typeof result !== "object" || result === null || !("ok" in result) || result.ok !== true || !("displayName" in result) || typeof result.displayName !== "string" || !("legs" in result) || !Array.isArray(result.legs)) {
        const serverError = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string" ? result.error : "Could not save these flight changes. Try again.";
        throw new Error(serverError);
      }
      onSaved(draft, { displayName: result.displayName, legs: result.legs as SavedEdit["legs"] });
      setMessage("Changes saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save these flight changes. Try again.");
    } finally { setBusy(false); }
  }

  async function lookup(direction: "inbound" | "outbound") {
    setError(""); setMessage(""); setLookupBusy(direction);
    const leg = draft[direction];
    try {
      const response = await fetch("/api/flight-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flightNumber: leg.flightNumber, departureDate: leg.departureDate }) });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok || typeof result !== "object" || result === null || !("ok" in result) || result.ok !== true || !("flight" in result)) {
        const serverError = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string" ? result.error : "Could not find this flight. Check the number and date, then try again.";
        throw new Error(serverError);
      }
      const found = result.flight as Partial<DraftLeg>;
      if (![found.airline, found.flightNumber, found.origin, found.destination, found.departureDate, found.departureTime, found.arrivalDate, found.arrivalTime].every((value) => typeof value === "string" && value.length > 0)) throw new Error("The flight lookup returned incomplete details. Enter them manually.");
      setDraft((current) => ({ ...current, [direction]: { ...current[direction], ...found } as DraftLeg }));
      setMessage("Flight details found. Review them, then save.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not find this flight. Try again."); }
    finally { setLookupBusy(null); }
  }

  const state: FlightRowEditorState = {
    draft, formId, busy, error, message, lookupBusy, lookup: (direction) => { void lookup(direction); },
    submit: (event) => { void submit(event); },
    setDisplayName: (displayName) => setDraft((current) => ({ ...current, displayName })),
    setLegField: (direction, field, value) => setDraft((current) => ({ ...current, [direction]: { ...current[direction], [field]: value } })),
  };
  return <>{children(state)}</>;
}

function GuestCard({ row, editing, onEdit, onCancel, onSaved }: {
  row: Row<typeof features, GuestFlight>; editing: boolean; onEdit: () => void; onCancel: () => void; onSaved: (draft: RowDraft, result: SavedEdit) => void;
}) {
  const cells = row.getAllCells();
  const renderCell = (id: string) => {
    const cell = cells.find((candidate) => candidate.column.id === id);
    return cell ? flexRender(cell.column.columnDef.cell, cell.getContext()) : null;
  };
  const content = (editor?: FlightRowEditorState) => <li className={`flight-guest-card${editor ? " flight-row-is-editing" : ""}`}>
    <div className="flight-card-head">
      {editor
        ? <input className="flight-inline-name" form={editor.formId} aria-label="Guest name" maxLength={80} placeholder="e.g. Jane Smith" value={editor.draft.displayName} disabled={editor.busy} onChange={(event) => editor.setDisplayName(event.currentTarget.value)} />
        : <h4>{renderCell("guest")}</h4>}
      {!editor && <button type="button" className="flight-row-edit" aria-label={`Edit flight details for ${row.original.displayName}`} title="Edit flight details" onClick={onEdit}><PencilSimple aria-hidden="true" size={18} weight="regular" /></button>}
    </div>
    <div className="flight-card-leg"><h5>Arriving</h5>
      {editor ? <FlightFlightFields direction="inbound" editor={editor} /> : row.original.inbound ? <p>{renderCell("inFlight")}</p> : <p className="flight-pending">No flight recorded</p>}
      {editor ? <FlightSchedule leg={row.original.inbound} inbound edit={editor} /> : row.original.inbound && renderCell("arrival")}
    </div>
    <div className="flight-card-leg"><h5>Departing</h5>
      {editor ? <FlightFlightFields direction="outbound" editor={editor} /> : row.original.outbound ? <p>{renderCell("outFlight")}</p> : <p className="flight-pending">No flight recorded</p>}
      {editor ? <FlightSchedule leg={row.original.outbound} edit={editor} /> : row.original.outbound && renderCell("departure")}
    </div>
    {editor && <FlightEditActions guest={row.original} editor={editor} onCancel={onCancel} />}
  </li>;
  return editing
    ? <FlightRowEditor guest={row.original} onSaved={onSaved}>{(editor) => content(editor)}</FlightRowEditor>
    : content();
}

function DesktopGuestRow({ row, editing, onEdit, onCancel, onSaved }: {
  row: Row<typeof features, GuestFlight>; editing: boolean; onEdit: () => void; onCancel: () => void; onSaved: (draft: RowDraft, result: SavedEdit) => void;
}) {
  const render = (editor?: FlightRowEditorState) => <tr className={editor ? "flight-row-is-editing" : undefined}>
    {row.getAllCells().map((cell) => {
      const id = cell.column.id;
      if (id === "guest") return <th scope="row" key={cell.id}>
        {editor
          ? <input className="flight-inline-name" form={editor.formId} aria-label="Guest name" maxLength={80} placeholder="e.g. Jane Smith" value={editor.draft.displayName} disabled={editor.busy} onChange={(event) => editor.setDisplayName(event.currentTarget.value)} />
          : flexRender(cell.column.columnDef.cell, cell.getContext())}
      </th>;
      if (id === "actions") return <td key={cell.id}>{editor
        ? <FlightEditActions guest={row.original} editor={editor} onCancel={onCancel} />
        : <button type="button" className="flight-row-edit" aria-label={`Edit flight details for ${row.original.displayName}`} title="Edit flight details" onClick={onEdit}>
          <PencilSimple aria-hidden="true" size={18} weight="regular" />
        </button>}</td>;
      if (id === "inFlight" || id === "outFlight") return <td key={cell.id}>{editor
        ? <FlightFlightFields direction={id === "inFlight" ? "inbound" : "outbound"} editor={editor} />
        : flexRender(cell.column.columnDef.cell, cell.getContext())}</td>;
      if (id === "arrival" || id === "departure") return <td key={cell.id}><FlightSchedule leg={id === "arrival" ? row.original.inbound : row.original.outbound} inbound={id === "arrival"} edit={editor} /></td>;
      return <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>;
    })}
  </tr>;
  return editing
    ? <FlightRowEditor guest={row.original} onSaved={onSaved}>{(editor) => render(editor)}</FlightRowEditor>
    : render();
}

type LookupLegInput = { flightNumber: string; departureDate: string };

function FlightLookupDialog({ guest, onClose, onSaved }: { guest: GuestFlight; onClose: () => void; onSaved: (draft: RowDraft, result: SavedEdit) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pairedInput = (leg: Leg | null): LookupLegInput => {
    const flightNumber = leg?.flightNumber?.trim() ?? "";
    const departureDate = leg?.departureLocal.slice(0, 10) ?? "";
    return flightNumber && departureDate ? { flightNumber, departureDate } : { flightNumber: "", departureDate: "" };
  };
  const [inputs, setInputs] = useState<Record<"inbound" | "outbound", LookupLegInput>>({
    inbound: pairedInput(guest.inbound),
    outbound: pairedInput(guest.outbound),
  });
  const [busy, setBusy] = useState<"finding" | "saving" | null>(null);
  const [error, setError] = useState("");
  const [savedConfirmation, setSavedConfirmation] = useState(false);
  const doneButtonRef = useRef<HTMLButtonElement>(null);
  const dialogId = `flight-lookup-${useId().replaceAll(":", "")}`;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  useEffect(() => {
    if (savedConfirmation) doneButtonRef.current?.focus();
  }, [savedConfirmation]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const requested = (["inbound", "outbound"] as const).filter((direction) => inputs[direction].flightNumber.trim() || inputs[direction].departureDate);
    if (requested.length === 0 || requested.some((direction) => !inputs[direction].flightNumber.trim() || !inputs[direction].departureDate)) {
      setError("Enter both a flight number and departure date for each flight you want to add."); return;
    }
    const draft: RowDraft = { displayName: guest.displayName, inbound: draftLeg(guest.inbound), outbound: draftLeg(guest.outbound) };
    setBusy("finding");
    try {
      for (const direction of requested) {
        const input = inputs[direction];
        const response = await fetch("/api/flight-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
        const result: unknown = await response.json().catch(() => null);
        if (!response.ok || typeof result !== "object" || result === null || !("ok" in result) || result.ok !== true || !("flight" in result)) {
          const message = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string" ? result.error : "Could not find this flight. Check the number and date, then try again.";
          throw new Error(`${direction === "inbound" ? "Arrival" : "Return"} flight: ${message}`);
        }
        const found = result.flight as Partial<DraftLeg>;
        if (![found.airline, found.flightNumber, found.origin, found.destination, found.departureDate, found.departureTime, found.arrivalDate, found.arrivalTime].every((value) => typeof value === "string" && value.length > 0)) throw new Error("The flight lookup returned incomplete details. Check the flight number and date, then try again.");
        draft[direction] = { ...draft[direction], ...found } as DraftLeg;
      }
      setBusy("saving");
      const response = await fetch("/api/flight-details", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId: guest.id, displayName: guest.displayName, legs: requested.map((direction) => ({
          direction: direction === "inbound" ? "INBOUND" : "OUTBOUND",
          expectedFlightId: guest[direction]?.id ?? null,
          ...draft[direction],
          airline: draft[direction].airline.trim() || null,
          flightNumber: draft[direction].flightNumber.trim() || null,
          origin: draft[direction].origin.trim().toUpperCase(),
          destination: draft[direction].destination.trim().toUpperCase(),
        })) }),
      });
      const saved: unknown = await response.json().catch(() => null);
      if (!response.ok || typeof saved !== "object" || saved === null || !("ok" in saved) || saved.ok !== true || !("displayName" in saved) || typeof saved.displayName !== "string" || !("legs" in saved) || !Array.isArray(saved.legs)) {
        const message = typeof saved === "object" && saved !== null && "error" in saved && typeof saved.error === "string" ? saved.error : "Could not save these flight details. Try again.";
        throw new Error(message);
      }
      onSaved(draft, { displayName: saved.displayName, legs: saved.legs as SavedEdit["legs"] });
      setSavedConfirmation(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not find and save these flight details. Try again."); }
    finally { setBusy(null); }
  }

  const field = (direction: "inbound" | "outbound", label: string) => <fieldset className="flight-lookup-direction">
    <legend>{label}</legend>
    <label className="flight-inline-field"><span>Flight number</span><input autoFocus={direction === "inbound"} type="text" maxLength={20} placeholder="e.g. UA956" value={inputs[direction].flightNumber} disabled={busy !== null}
      aria-label={`${label} flight number`} autoCapitalize="characters" onChange={(event) => { const value = event.currentTarget.value; setInputs((current) => ({ ...current, [direction]: { ...current[direction], flightNumber: value } })); }} /></label>
    <label className="flight-inline-field"><span>Departure date</span><input type="date" value={inputs[direction].departureDate} disabled={busy !== null}
      aria-label={`${label} flight departure date`} onChange={(event) => { const value = event.currentTarget.value; setInputs((current) => ({ ...current, [direction]: { ...current[direction], departureDate: value } })); }} /></label>
  </fieldset>;

  return <dialog ref={dialogRef} className="flight-lookup-dialog" aria-labelledby={`${dialogId}-title`} onCancel={(event) => { event.preventDefault(); if (busy === null) onClose(); }}>
      <header><div><p className="flight-dialog-kicker">Group flights · {guest.displayName}</p><h4 id={`${dialogId}-title`}>{savedConfirmation ? "Flight details saved" : "Add flight details"}</h4></div>
        <button type="button" className="flight-dialog-close" aria-label="Close flight lookup" onClick={onClose} disabled={busy !== null}><X aria-hidden="true" size={18} /></button></header>
      {savedConfirmation ? <div className="flight-lookup-saved">
        <p role="status" aria-live="polite">Flight details saved for {guest.displayName}.</p>
        <button ref={doneButtonRef} type="button" className="flight-lookup-submit" onClick={onClose}>Done</button>
      </div> : <>
      <p className="flight-dialog-intro">Enter each flight number and its departure date. We’ll find the route and times, then save them to the table.</p>
      <form onSubmit={(event) => { void submit(event); }}>
        {field("inbound", "Arriving")}
        {field("outbound", "Departing")}
        <p className="flight-lookup-credit">Flight lookup by <a href="https://aerodatabox.com/" target="_blank" rel="noopener">AeroDataBox</a></p>
        {error && <p className="flight-edit-error" role="alert">{error}</p>}
        <button type="submit" className="flight-lookup-submit" disabled={busy !== null}>
          {busy === "finding" ? "Finding flight…" : busy === "saving" ? "Saving…" : "Find and save flights"}
        </button>
      </form>
      </>}
  </dialog>;
}

export function GroupFlightTable({ flights }: { flights: FlightTable }) {
  const mobile = useSyncExternalStore(subscribeMobile, mobileSnapshot, serverSnapshot);
  const [data, setData] = useState(flights);
  const [editingGuestId, setEditingGuestId] = useState<string | null>(null);
  // useTable's default subscription re-renders both renderers when sorting changes.
  const table = useTable({ features, data, columns, getRowId: (guest) => guest.id });
  const rows = table.getRowModel().rows;
  const saveRow = (guest: GuestFlight, draft: RowDraft, result: SavedEdit) => {
    const legs = new Map(result.legs.map((leg) => [leg.direction, leg.flightId]));
    setData((current) => current.map((row) => {
      if (row.id !== guest.id) return row;
      const next: GuestFlight = { ...row, displayName: result.displayName };
      for (const direction of ["INBOUND", "OUTBOUND"] as const) {
        const flightId = legs.get(direction);
        if (!flightId) continue;
        const key = direction === "INBOUND" ? "inbound" : "outbound";
        const value = draft[key];
        const origin = value.origin.trim().toUpperCase();
        const destination = value.destination.trim().toUpperCase();
        const scheduledDeparture = fromZonedTime(`${value.departureDate}T${value.departureTime}:00`, airportTimeZone(origin));
        const scheduledArrival = fromZonedTime(`${value.arrivalDate}T${value.arrivalTime}:00`, airportTimeZone(destination));
        next[key] = {
          ...(row[key] ?? { direction, terminal: null, source: "ORGANIZER" as const, confirmedAt: new Date(), supersededById: null, confirmedByGuest: true }),
          id: flightId, direction, airline: value.airline.trim() || null, flightNumber: value.flightNumber.trim() || null,
          origin, destination, scheduledDeparture, scheduledArrival, departureLocal: airportLocalTime(scheduledDeparture, origin), arrivalLocal: airportLocalTime(scheduledArrival, destination),
          confirmedAt: new Date(), confirmedByGuest: true, supersededById: null,
        };
      }
      return next;
    }));
  };
  return <section className="group-flights" aria-labelledby="group-flights-heading">
    <style>{styles}</style>
    <h3 id="group-flights-heading">Group Flights</h3>
    {!flights.some((guest) => guest.inbound || guest.outbound) && <p className="flight-help">No flights recorded yet. Everyone is listed below.</p>}
    {mobile ? <>
      <ul className="flight-cards" aria-label="Group Flights">{rows.map((row) => <GuestCard key={row.id} row={row} editing={false}
        onEdit={() => setEditingGuestId(row.original.id)} onCancel={() => setEditingGuestId(null)} onSaved={(draft, result) => saveRow(row.original, draft, result)} />)}</ul>
    </> : <div className="flight-table-frame"><table className="flight-table" aria-label="Group Flights">
      <colgroup><col /><col /><col /><col /><col /><col /></colgroup>
      <thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <th key={header.id} colSpan={header.colSpan}
        scope={header.column.columns.length ? "colgroup" : "col"}>
        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
      </th>)}</tr>)}</thead>
      <tbody>{rows.map((row) => <DesktopGuestRow key={row.id} row={row} editing={false}
        onEdit={() => setEditingGuestId(row.original.id)} onCancel={() => setEditingGuestId(null)} onSaved={(draft, result) => saveRow(row.original, draft, result)} />)}</tbody>
    </table></div>}
    {editingGuestId && (() => { const guest = data.find((row) => row.id === editingGuestId); return guest ? <FlightLookupDialog guest={guest} onClose={() => setEditingGuestId(null)} onSaved={(draft, result) => saveRow(guest, draft, result)} /> : null; })()}
  </section>;
}

const styles = `
.group-flights { margin-top: 32px; }
.group-flights > h3 { font: 700 24px var(--font-display); letter-spacing: -.02em; margin: 0 0 8px; }
.group-flights > p { margin: 0 0 8px; color: var(--text-muted); }
.group-flights .flight-help { font-size: 13px; color: var(--text-dim); margin-bottom: 16px; }
.flight-table-frame { overflow-x: auto; border: 0; border-radius: 0; background: transparent; }
.flight-table { width: 100%; min-width: 680px; table-layout: fixed; border-collapse: collapse; text-align: left; background: transparent; }
.flight-table col:nth-child(1) { width: 16%; }
.flight-table col:nth-child(2) { width: 17%; }
.flight-table col:nth-child(3) { width: 19%; }
.flight-table col:nth-child(4) { width: 17%; }
.flight-table col:nth-child(5) { width: 20%; }
.flight-table col:nth-child(6) { width: 11%; }
.flight-table th, .flight-table td { padding: 14px 14px; overflow-wrap: normal; vertical-align: top; border: 0; }
.flight-table thead { color: var(--text-dim); font-size: 11px; }
.flight-table thead tr:first-child th { padding-bottom: 6px; border-bottom: 1px solid var(--border-subtle); }
.flight-table thead tr:nth-child(2) th { padding-top: 7px; }
.flight-table tbody tr { border-top: 1px solid var(--border-subtle); }
.flight-table tbody tr:hover { background: color-mix(in srgb, var(--surface) 55%, transparent); }
.flight-table thead th { font-weight: 600; }
.flight-table tbody { font-size: 13px; }
.flight-table tbody th { font-weight: 600; }
.flight-table td { color: var(--text-muted); }
.flight-table th:first-child, .flight-table td:first-child { vertical-align: middle; }
.flight-table td:last-child { padding-inline: 6px; vertical-align: middle; }
.flight-table .flight-route { color: var(--text); font-weight: 600; }
.flight-schedule { display: grid; gap: 8px; margin: 0; }
.flight-schedule > div { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px; align-items: baseline; }
.flight-schedule dt { color: var(--text-dim); font-size: 11px; }
.flight-schedule dd { min-width: 0; margin: 0; color: var(--text); font-variant-numeric: tabular-nums; white-space: nowrap; }
.group-flights :is(button, a):focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 2px; }
.flight-route { font-weight: 600; color: var(--text); }
.flight-row-edit, .flight-edit-save, .flight-edit-cancel { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 8px 12px; border: 1px solid var(--border-strong); border-radius: 0; background: transparent; color: var(--text); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.flight-row-edit { width: 44px; min-width: 44px; padding: 0; border-color: transparent; }
.flight-row-edit:hover, .flight-edit-cancel:hover { background: var(--hover); }
.flight-edit-save { background: var(--text); color: var(--surface); }
.flight-edit-save:hover { background: var(--text-muted); }
.flight-edit-save:disabled, .flight-edit-cancel:disabled { opacity: .55; cursor: wait; }
.flight-inline-name, .flight-inline-field input, .flight-inline-datetime { box-sizing: border-box; min-width: 0; min-height: 44px; border: 1px solid var(--border-strong); border-radius: 0; background: var(--surface); color: var(--text); font: inherit; font-size: 14px; }
.flight-inline-name { width: 100%; padding: 7px 8px; }
.flight-inline-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.flight-inline-field { display: grid; min-width: 0; gap: 4px; color: var(--text-dim); font-size: 10px; font-weight: 600; line-height: 1.2; }
.flight-inline-field input { width: 100%; padding: 6px 8px; font-size: 13px; font-weight: 400; }
.flight-inline-datetime { width: 100%; padding: 6px 8px; font-size: 13px; }
.flight-table :is(button, input):focus-visible, .flight-cards :is(button, input, select):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.flight-inline-actions { display: grid; gap: 6px; }
.flight-inline-action-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
.flight-inline-actions .flight-edit-save, .flight-inline-actions .flight-edit-cancel { width: 44px; min-width: 44px; padding: 0; }
.flight-edit-error, .flight-edit-status { margin: 0; font-size: 12px; line-height: 1.35; }
.flight-edit-error { color: var(--danger); }
.flight-edit-status { color: var(--text-muted); }
.flight-pending { color: var(--text-dim); }
.flight-lookup { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 8px; }
.flight-lookup-button { grid-column: 1 / -1; display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 8px 12px; border: 1px solid var(--border-strong); border-radius: 0; background: var(--text); color: var(--surface); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.flight-lookup-button:disabled { opacity: .55; cursor: not-allowed; }
.flight-lookup-credit { margin: 0 0 8px; color: var(--text-dim); font-size: 11px; }
.flight-lookup-credit a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
.flight-lookup-dialog { position: fixed; inset: 0; box-sizing: border-box; width: min(calc(100% - 32px), 520px); max-height: calc(100dvh - 32px); margin: auto; overflow-y: auto; padding: 24px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); box-shadow: 0 18px 60px rgb(0 0 0 / 24%); }
.flight-lookup-dialog::backdrop { background: rgb(0 0 0 / 52%); }
.flight-lookup-dialog > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.flight-lookup-dialog h4 { margin: 0; font: 700 24px var(--font-display); letter-spacing: -.02em; }
.flight-dialog-kicker { margin: 0 0 5px; color: var(--text-dim); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
.flight-dialog-intro { margin: 12px 0 18px; color: var(--text-muted); font-size: 14px; line-height: 1.5; }
.flight-dialog-close { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 44px; min-width: 44px; height: 44px; border: 1px solid var(--border-subtle); background: transparent; color: inherit; cursor: pointer; }
.flight-lookup-dialog form { display: grid; gap: 14px; }
.flight-lookup-direction { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; min-width: 0; margin: 0; padding: 12px; border: 1px solid var(--border-subtle); }
.flight-lookup-direction legend { padding: 0 5px; font-size: 12px; font-weight: 700; }
.flight-lookup-direction .flight-inline-field { font-size: 11px; }
.flight-lookup-direction input { box-sizing: border-box; width: 100%; min-width: 0; min-height: 44px; padding: 8px; border: 1px solid var(--border-strong); border-radius: 0; background: var(--surface); color: var(--text); font: inherit; font-size: 14px; }
.flight-lookup-submit { min-height: 48px; margin-top: 2px; padding: 10px 16px; border: 1px solid var(--text); border-radius: 0; background: var(--text); color: var(--surface); font: inherit; font-weight: 700; cursor: pointer; }
.flight-lookup-submit:disabled, .flight-dialog-close:disabled { opacity: .6; cursor: wait; }
.flight-lookup-saved { display: grid; gap: 16px; margin-top: 16px; }
.flight-lookup-saved p { margin: 0; color: var(--text); font-size: 15px; line-height: 1.5; }
.flight-lookup-dialog :is(input, button):focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
/* The sub-860px card layout remains the same content and ordering as the table. */
@media (max-width: 859px) {
  .flight-guest-card > .flight-inline-actions { margin-top: 12px; }
  .flight-guest-card h4 a { display: inline-flex; align-items: center; min-height: 44px; min-width: 44px; }
  .flight-lookup-button:active, .flight-guest-card a:active { color: var(--brand-dim); }
  .flight-lookup-dialog { width: calc(100% - 32px); max-height: calc(100dvh - 32px); padding: 18px; }
  .flight-card-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .flight-card-head h4 { flex: 1; min-width: 0; margin: 0; }
  .flight-card-head > .flight-inline-name { flex: 1; }
  .flight-card-head > .flight-row-edit { flex: none; }
  .flight-cards, .flight-guest-card { -webkit-tap-highlight-color: transparent; }
}
@media (min-width: 860px) and (max-width: 1099px) {
  .flight-schedule > div { grid-template-columns: 1fr; gap: 2px; }
}
.flight-cards { list-style: none; padding: 0; margin: 0; display: grid; gap: 0; }
.flight-guest-card { min-width: 0; overflow-wrap: anywhere; background: transparent; border: 0; border-radius: 0; padding: 16px 0 24px; border-top: 1px solid var(--border-subtle); }
.flight-guest-card h4 { min-width: 0; margin: 0; font-size: 16px; }
.flight-card-leg { min-width: 0; margin-top: 12px; padding: 12px 0 0; border-top: 1px solid var(--border-subtle); }
.flight-card-leg h5 { margin: 0 0 6px; color: var(--text-dim); text-transform: uppercase; letter-spacing: .08em; font-size: 11px; }
.flight-card-leg > p { margin: 0 0 6px; font-size: 14px; }
.flight-card-leg > p.flight-pending { font-size: 13px; color: var(--text-dim); }
.flight-card-leg .flight-schedule { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; }
.flight-card-leg .flight-schedule > div { display: block; min-width: 0; }
.flight-card-leg .flight-schedule dd { white-space: normal; overflow-wrap: anywhere; font-size: 13px; }
@media (max-width: 379px) {
  .flight-row-is-editing .flight-card-leg .flight-schedule { grid-template-columns: minmax(0, 1fr); }
}
`;
