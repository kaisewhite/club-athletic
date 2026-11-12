import { useSyncExternalStore, type ReactNode } from "react";
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

type AdminFlight = AdminGuests[number]["flights"][number];
type FolieDouceVote = Awaited<ReturnType<typeof getFolieDouceVotes>>["vip"][number];
type GuestField = { label: string; value: ReactNode };
const mobileQuery = "(max-width: 859px)";

function subscribeMobile(onChange: () => void) {
  const media = window.matchMedia(mobileQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

const mobileSnapshot = () => window.matchMedia(mobileQuery).matches;
const serverSnapshot = () => false;

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

function guestFields(guest: AdminGuests[number]): GuestField[] {
  const fullName = [guest.firstName, guest.lastName].filter(Boolean).join(" ");
  const instagram = guest.instagramUrl && <GuestInstagramLink displayName={guest.instagramUrl.replace(/^https?:\/\/(www\.)?instagram\.com\//, "@").replace(/\/$/, "")} instagramUrl={guest.instagramUrl} />;
  const room = guest.spot ? `${guest.spot.room.name} · spot ${guest.spot.index}` : guest.preferredRoom ? `${guest.preferredRoom.name} · selected` : "No room yet";
  return [
    { label: "Status", value: <span className="admin-status">{humanize(guest.status)}</span> },
    { label: "Room / spot", value: room },
    { label: "Venmo", value: guest.venmoHandle || <span className="admin-empty">—</span> },
    { label: "Phone", value: guest.phone ? <a href={`tel:${guest.phone}`}>{guest.phone}</a> : <span className="admin-empty">—</span> },
    { label: "Instagram", value: instagram || <span className="admin-empty">—</span> },
    { label: "Dietary", value: guest.dietaryNotes || <span className="admin-empty">—</span> },
    { label: "Cocktails", value: guest.favoriteCocktails || <span className="admin-empty">—</span> },
    { label: "Tasks", value: guest.tasks.length ? <ul className="admin-task-list">{guest.tasks.map((task) => <li key={task.id}><span className={task.done ? "admin-task-done" : "admin-task-open"}>{humanize(task.type)} · {task.done ? `Done${task.completedAt ? ` ${formatDay(task.completedAt)}` : ""}` : "Not done"}{task.notes ? ` · ${task.notes}` : ""}</span></li>)}</ul> : <span className="admin-empty">None</span> },
    { label: "Flights", value: guest.flights.length ? <div className="admin-flight-legs">{guest.flights.map((flight) => <FlightLeg key={flight.id} flight={flight} />)}</div> : <span className="admin-empty">No flights yet</span> },
  ];
}

function GuestName({ guest }: { guest: AdminGuests[number] }) {
  const fullName = [guest.firstName, guest.lastName].filter(Boolean).join(" ");
  return <>
    <span className="admin-guest-name">{guest.displayName}</span>
    {fullName !== guest.displayName && <span className="admin-full-name">{fullName}</span>}
  </>;
}

function GuestRow({ guest }: { guest: AdminGuests[number] }) {
  return <tr className="admin-guest">
    <th className="admin-identity" scope="row"><GuestName guest={guest} /></th>
    {guestFields(guest).map((field) => <td key={field.label}>{field.value}</td>)}
  </tr>;
}

function GuestCard({ guest }: { guest: AdminGuests[number] }) {
  return <li className="admin-guest-card">
    <article aria-labelledby={`admin-guest-${guest.id}`}>
      <h3 id={`admin-guest-${guest.id}`}><GuestName guest={guest} /></h3>
      <dl className="admin-mobile-fields">
        {guestFields(guest).map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}
      </dl>
    </article>
  </li>;
}

function GuestRoster({ guests }: { guests: AdminGuests }) {
  const mobile = useSyncExternalStore(subscribeMobile, mobileSnapshot, serverSnapshot);
  if (mobile) return <ul className="admin-guest-cards" aria-label="Guest details">{guests.map((guest) => <GuestCard key={guest.id} guest={guest} />)}</ul>;

  return <div className="admin-guest-table-wrap">
    <table className="admin-guest-table" aria-label="Guest details">
      <thead><tr><th scope="col">Guest</th><th scope="col">Status</th><th scope="col">Room / spot</th><th scope="col">Venmo</th><th scope="col">Phone</th><th scope="col">Instagram</th><th scope="col">Dietary</th><th scope="col">Cocktails</th><th scope="col">Tasks</th><th scope="col">Flights</th></tr></thead>
      <tbody>{guests.map((guest) => <GuestRow key={guest.id} guest={guest} />)}</tbody>
    </table>
  </div>;
}

export default function Admin({ loaderData }: Route.ComponentProps) {
  const { guests, folieDouceVotes } = loaderData;
  const voteCount = folieDouceVotes.vip.length + folieDouceVotes.generalAdmission.length;
  return <section className="admin-page" aria-labelledby="admin-heading">
    <PageHeading id="admin-heading" sub={`${guests.length} guests · contact details, rooms, preferences, flights and ${voteCount} La Folie Douce responses.`}>Admin</PageHeading>
    <section className="admin-folie" aria-labelledby="admin-folie-heading">
      <h2 id="admin-folie-heading">La Folie Douce</h2>
      <div className="admin-folie-groups">
        <FolieDouceGroup title="VIP table" votes={folieDouceVotes.vip} />
        <FolieDouceGroup title="General Admission" votes={folieDouceVotes.generalAdmission} />
      </div>
    </section>
    <section className="admin-folie admin-refunds" aria-labelledby="admin-refunds-heading">
      <h2 id="admin-refunds-heading">Refunds to track</h2>
      <p className="admin-missing">People identified for refund follow-up · 7 guests</p>
      <ul aria-label="Guests to follow up about refunds">
        <li>Augustus</li>
        <li>Pete</li>
        <li>Amelia</li>
        <li>Kristy Khoury</li>
        <li>Valeria</li>
        <li>Ted</li>
        <li>Elijah</li>
      </ul>
    </section>
    <GuestRoster guests={guests} />
  </section>;
}
