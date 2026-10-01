import { useSyncExternalStore } from "react";
import {
  createSortedRowModel, flexRender, rowSortingFeature,
  sortFn_alphanumeric, sortFn_basic, sortFn_text, tableFeatures, useTable,
  type Column, type ColumnDef, type Row,
} from "@tanstack/react-table";
import type { FlightTable } from "@/lib/db/repository.server";

type GuestFlight = FlightTable[number];
type Leg = NonNullable<GuestFlight["inbound"]>;
// v9 includes the core row model and header groups; sorting is explicitly registered.
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic, text: sortFn_text },
});
const mobileQuery = "(width < 860px)";
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
  return <><span className="flight-route">{leg.origin} → {leg.destination}</span>{number && <> · {number}</>}</>;
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
  // §2.13 will consume this question in the Home chat composer.
  const question = `When does ${guest.displayName} land?`;
  return <a href={`/?question=${encodeURIComponent(question)}`}>{guest.displayName}</a>;
}

const columns: ColumnDef<typeof features, GuestFlight>[] = [
  { id: "guest", accessorKey: "displayName", header: "Guest", sortFn: "text", cell: ({ row }) => <GuestName guest={row.original} /> },
  { id: "arriving", header: "Arriving", columns: [
    { id: "inFlight", header: "Flight", accessorFn: (guest) => guest.inbound ? `${guest.inbound.origin} ${guest.inbound.airline ?? ""} ${guest.inbound.flightNumber ?? ""}` : undefined,
      sortFn: "alphanumeric", sortUndefined: "last", sortDescFirst: false, cell: ({ row }) => <FlightName leg={row.original.inbound} /> },
    { id: "inDeparture", header: "Departs", accessorFn: (guest) => guest.inbound?.scheduledDeparture.getTime(),
      sortFn: "basic", sortUndefined: "last", sortDescFirst: false, cell: ({ row }) => <FlightTime local={row.original.inbound?.departureLocal} /> },
    { id: "arrival", header: "Lands GVA", accessorFn: (guest) => guest.inbound?.scheduledArrival.getTime(),
      sortFn: "basic", sortUndefined: "last", sortDescFirst: false, cell: ({ row }) => <FlightTime local={row.original.inbound?.arrivalLocal} /> },
  ] },
  { id: "departing", header: "Departing", columns: [
    { id: "outFlight", header: "Flight", accessorFn: (guest) => guest.outbound ? `${guest.outbound.destination} ${guest.outbound.airline ?? ""} ${guest.outbound.flightNumber ?? ""}` : undefined,
      sortFn: "alphanumeric", sortUndefined: "last", sortDescFirst: false, cell: ({ row }) => <FlightName leg={row.original.outbound} /> },
    { id: "departure", header: "Departs GVA", accessorFn: (guest) => guest.outbound?.scheduledDeparture.getTime(),
      sortFn: "basic", sortUndefined: "last", sortDescFirst: false, cell: ({ row }) => <FlightTime local={row.original.outbound?.departureLocal} /> },
    { id: "outArrival", header: "Arrives", accessorFn: (guest) => guest.outbound?.scheduledArrival.getTime(),
      sortFn: "basic", sortUndefined: "last", sortDescFirst: false, cell: ({ row }) => <FlightTime local={row.original.outbound?.arrivalLocal} /> },
  ] },
];

function SortButton({ column }: { column: Column<typeof features, GuestFlight, unknown> }) {
  const sorted = column.getIsSorted();
  return <button type="button" className="flight-sort" onClick={column.getToggleSortingHandler()}
    aria-label={`Sort by ${String(column.columnDef.header)}${sorted ? `, currently ${sorted === "asc" ? "ascending" : "descending"}` : ""}`}>
    {String(column.columnDef.header)} <span aria-hidden="true">{sorted === "asc" ? "↑" : sorted === "desc" ? "↓" : "↕"}</span>
  </button>;
}

function GuestCard({ row }: { row: Row<typeof features, GuestFlight> }) {
  const cells = row.getAllCells();
  const renderCell = (id: string) => {
    const cell = cells.find((candidate) => candidate.column.id === id);
    return cell ? flexRender(cell.column.columnDef.cell, cell.getContext()) : null;
  };
  return <li className="flight-guest-card">
    <h4>{renderCell("guest")}</h4>
    <div className="flight-card-leg"><h5>Arriving</h5><dl>
      <dt>Flight</dt><dd>{renderCell("inFlight")}</dd>
      <dt>Departs</dt><dd>{renderCell("inDeparture")}</dd>
      <dt>Lands GVA</dt><dd>{renderCell("arrival")}</dd>
    </dl></div>
    <div className="flight-card-leg"><h5>Departing</h5><dl>
      <dt>Flight</dt><dd>{renderCell("outFlight")}</dd>
      <dt>Departs GVA</dt><dd>{renderCell("departure")}</dd>
      <dt>Arrives</dt><dd>{renderCell("outArrival")}</dd>
    </dl></div>
  </li>;
}

export function GroupFlightTable({ flights }: { flights: FlightTable }) {
  const mobile = useSyncExternalStore(subscribeMobile, mobileSnapshot, serverSnapshot);
  // useTable's default subscription re-renders both renderers when sorting changes.
  const table = useTable({ features, data: flights, columns, getRowId: (guest) => guest.id,
    initialState: { sorting: [{ id: "arrival", desc: false }] }, enableSortingRemoval: false,
  });
  const rows = table.getRowModel().rows;
  return <section className="group-flights" aria-labelledby="group-flights-heading">
    <style>{styles}</style>
    <h3 id="group-flights-heading">Group Flights</h3>
    {!flights.some((guest) => guest.inbound || guest.outbound) && <p className="flight-help">No flights recorded yet. Everyone is listed below.</p>}
    {mobile ? <>
      <div className="flight-mobile-sorting" aria-label="Sort Group Flights">{table.getAllLeafColumns().map((column) => <SortButton key={column.id} column={column} />)}</div>
      <ul className="flight-cards" aria-label="Group Flights">{rows.map((row) => <GuestCard key={row.id} row={row} />)}</ul>
    </> : <div className="flight-table-frame"><table className="flight-table" aria-label="Group Flights">
      <thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <th key={header.id} colSpan={header.colSpan}
        scope={header.column.columns.length ? "colgroup" : "col"}
        aria-sort={!header.isPlaceholder && header.column.getCanSort() ? header.column.getIsSorted() === "asc" ? "ascending" : header.column.getIsSorted() === "desc" ? "descending" : "none" : undefined}>
        {header.isPlaceholder ? null : header.column.getCanSort() ? <SortButton column={header.column} /> : flexRender(header.column.columnDef.header, header.getContext())}
      </th>)}</tr>)}</thead>
      <tbody>{rows.map((row) => <tr key={row.id}>{row.getAllCells().map((cell) => cell.column.id === "guest"
        ? <th scope="row" key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</th>
        : <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody>
    </table></div>}
  </section>;
}

const styles = `
.group-flights { margin-top: 32px; }
.group-flights > h3 { font: 700 24px var(--font-display); letter-spacing: -.02em; margin: 0 0 8px; }
.group-flights > p { margin: 0 0 8px; color: var(--text-muted); }
.group-flights .flight-help { font-size: 13px; color: var(--text-dim); margin-bottom: 16px; }
.flight-table-frame { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: var(--surface); }
.flight-table { width: 100%; table-layout: fixed; border-collapse: collapse; text-align: left; background: var(--surface); }
.flight-table th, .flight-table td { padding: 12px 10px; overflow-wrap: anywhere; vertical-align: top; border-bottom: 1px solid var(--border); }
.flight-table tbody tr:last-child td, .flight-table tbody tr:last-child th { border-bottom: 0; }
.flight-table thead { color: var(--text-dim); font-size: 11px; }
.flight-table thead th { font-weight: 600; }
.flight-table tbody { font-size: 13px; }
.flight-table tbody th { font-weight: 600; }
.flight-table td { color: var(--text-muted); }
.flight-sort { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-align: left; }
.flight-sort:hover { color: var(--accent); }
.group-flights :is(button, a):focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 2px; }
.flight-route { font-weight: 600; color: var(--text); }
.flight-mobile-sorting { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-bottom: 12px; font-size: 12px; color: var(--text-dim); }
.flight-mobile-sorting button { min-height: 44px; }
/* TODO §2.15 mobile pass. This block and the .flight-* card rules above it are
   reached only by the sub-860px card renderer, never by the desktop <table> —
   the seam is the matchMedia("(width < 860px)") switch in this file, so the
   desktop branch is untouched. The media query is belt and braces. */
@media (max-width: 859px) {
  /* The shortest sort button must still be a 44px box. */
  .flight-mobile-sorting button { min-width: 44px; padding-inline: 2px; }
  /* The guest name is the card's one action (it asks the chat about that guest),
     so it gets a 44px box rather than the 16px line box a short name like
     "Kaise" would otherwise give it. */
  /* min-width too: the shortest real guest name, "Kaise", measures 40px. */
  .flight-guest-card h4 a { display: inline-flex; align-items: center; min-height: 44px; min-width: 44px; }
  .flight-mobile-sorting button:active, .flight-guest-card a:active { color: var(--accent); }
  .flight-cards, .flight-guest-card { -webkit-tap-highlight-color: transparent; }
}
.flight-cards { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
.flight-guest-card { min-width: 0; overflow-wrap: anywhere; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px; }
.flight-guest-card h4 { margin: 0 0 8px; font-size: 16px; }
.flight-card-leg { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-subtle); }
.flight-card-leg h5 { margin: 0 0 8px; color: var(--text-dim); text-transform: uppercase; letter-spacing: .08em; font-size: 11px; }
.flight-card-leg dl { margin: 0; font-size: 13px; }
.flight-card-leg dt { color: var(--text-dim); font-size: 11px; margin-top: 8px; }
.flight-card-leg dd { margin: 2px 0 0; }
`;
