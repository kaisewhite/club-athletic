import { getAdminGuests, getFolieDouceVotes, type AdminGuests } from "@/lib/db/repository.server";
import { PageHeading } from "../components/trip-details";
import { GuestInstagramLink } from "../components/guest-instagram-link";
import { ArrowText } from "../components/arrow-text";
import type { Route } from "./+types/admin";
import "../components/admin.css";

export function meta() {
  return [{ title: "Admin · Méribel ’27 — Club Athletic" }, { name: "robots", content: "noindex, nofollow" }];
}

export function headers() {
  return { "Cache-Control": "private, no-store" };
}

export async function loader() {
  const [guests, folieDouceVotes] = await Promise.all([getAdminGuests(), getFolieDouceVotes()]);
  return { guests, folieDouceVotes };
}

const day = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const formatDay = (value: Date | string) => day.format(new Date(value));
const humanize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase().replaceAll("_", " ");

type Row = { label: string; value: React.ReactNode };

/** One labelled group. Filled rows first; empty ones collapse into a single "Not provided" line. */
function Group({ title, rows }: { title: string; rows: Row[] }) {
  const filled = rows.filter((row) => row.value !== null && row.value !== undefined && row.value !== "");
  const missing = rows.filter((row) => !filled.includes(row)).map((row) => row.label);
  return <section className="admin-group" aria-label={title}>
    <h4 className="admin-group-title">{title}</h4>
    {filled.length > 0 && <dl className="admin-rows">{filled.map((row) => <div className="admin-row" key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}
    {missing.length > 0 && <p className="admin-missing">Not provided: {missing.join(", ")}</p>}
    {rows.length === 0 && <p className="admin-missing">None</p>}
  </section>;
}

type AdminFlight = AdminGuests[number]["flights"][number];
type FolieDouceVote = Awaited<ReturnType<typeof getFolieDouceVotes>>["vip"][number];

function FolieDouceGroup({ title, votes }: { title: string; votes: FolieDouceVote[] }) {
  return <section className="admin-folie-group" aria-label={title}>
    <h3>{title} <span>{votes.length}</span></h3>
    {votes.length ? <ul>{votes.map((vote) => <li key={vote.id}>{[vote.firstName, vote.lastName].filter(Boolean).join(" ")}</li>)}</ul> : <p className="admin-missing">No responses yet</p>}
  </section>;
}

/** Airport-local, like the Flights page: the query supplies the local wall time, so only its calendar day is formatted. */
function LocalTime({ local }: { local: string }) {
  return <time dateTime={local}>{formatDay(`${local.slice(0, 10)}T00:00:00Z`)} · {local.slice(11, 16)}</time>;
}

function FlightLeg({ flight }: { flight: AdminFlight }) {
  const number = [flight.airline, flight.flightNumber].filter(Boolean).join(" ");
  const extras = [flight.confirmationCode && `Confirmation ${flight.confirmationCode}`, flight.terminal && `Terminal ${flight.terminal}`].filter(Boolean).join(" · ");
  return <div className="admin-flight">
    <span className="admin-flight-direction">{flight.direction === "INBOUND" ? "Arriving" : "Departing"}</span>
    <span className="admin-flight-route"><ArrowText>{`${flight.origin} → ${flight.destination}`}</ArrowText>{number && <span className="admin-flight-number"> · {number}</span>}</span>
    <span className="admin-flight-times">
      <span>Departs {flight.origin} <LocalTime local={flight.departureLocal} /></span>
      <span>Lands {flight.destination} <LocalTime local={flight.arrivalLocal} /></span>
    </span>
    {extras && <span className="admin-flight-extra">{extras}</span>}
  </div>;
}

function GuestCard({ guest }: { guest: AdminGuests[number] }) {
  const fullName = [guest.firstName, guest.lastName].filter(Boolean).join(" ");
  const instagram = guest.instagramUrl && <GuestInstagramLink displayName={guest.instagramUrl.replace(/^https?:\/\/(www\.)?instagram\.com\//, "@").replace(/\/$/, "")} instagramUrl={guest.instagramUrl} />;
  return <article className="admin-guest" aria-labelledby={`admin-guest-${guest.id}`}>
    <header className="admin-identity">
      <h3 id={`admin-guest-${guest.id}`}>{guest.displayName}</h3>
      {fullName !== guest.displayName && <span className="admin-full-name">{fullName}</span>}
      <span className="admin-status">{humanize(guest.status)}</span>
      <span className="admin-room">{guest.spot ? `${guest.spot.room.name} · spot ${guest.spot.index}` : guest.preferredRoom ? `${guest.preferredRoom.name} · selected` : "No room yet"}</span>
    </header>
    <div className="admin-details">
      <Group title="Contact" rows={[
        { label: "Venmo", value: guest.venmoHandle },
        { label: "Phone", value: guest.phone && <a href={`tel:${guest.phone}`}>{guest.phone}</a> },
        { label: "Email", value: guest.email && <a href={`mailto:${guest.email}`}>{guest.email}</a> },
        { label: "Instagram", value: instagram },
      ]} />
      <Group title="Food & drink" rows={[
        { label: "Dietary", value: guest.dietaryNotes },
        { label: "Cocktails", value: guest.favoriteCocktails },
      ]} />
      <Group title="Tasks" rows={guest.tasks.map((task) => ({
        label: humanize(task.type),
        value: <span className={task.done ? "admin-task-done" : "admin-task-open"}>{task.done ? `Done${task.completedAt ? ` ${formatDay(task.completedAt)}` : ""}` : "Not done"}{task.notes ? ` · ${task.notes}` : ""}</span>,
      }))} />
      <section className="admin-group admin-flights" aria-label="Flights">
        <h4 className="admin-group-title">Flights</h4>
        {guest.flights.length ? <div className="admin-flight-legs">{guest.flights.map((flight) => <FlightLeg key={flight.id} flight={flight} />)}</div> : <p className="admin-missing">No flights yet</p>}
      </section>
    </div>
  </article>;
}

export default function Admin({ loaderData }: Route.ComponentProps) {
  const { guests, folieDouceVotes } = loaderData;
  const voteCount = folieDouceVotes.vip.length + folieDouceVotes.generalAdmission.length;
  return <section aria-labelledby="admin-heading">
    <PageHeading id="admin-heading" sub={`${guests.length} guests · contact details, rooms, preferences, flights and ${voteCount} La Folie Douce responses.`}>Admin</PageHeading>
    <section className="admin-folie" aria-labelledby="admin-folie-heading">
      <h2 id="admin-folie-heading">La Folie Douce</h2>
      <div className="admin-folie-groups">
        <FolieDouceGroup title="VIP table" votes={folieDouceVotes.vip} />
        <FolieDouceGroup title="General Admission" votes={folieDouceVotes.generalAdmission} />
      </div>
    </section>
    <div className="admin-guests">{guests.map((guest) => <GuestCard key={guest.id} guest={guest} />)}</div>
  </section>;
}
