import { ArrowRight } from "@phosphor-icons/react/ssr";
import { Link } from "react-router";
import { getFlightRules, getOpenSpots, getSchedule, getTripOverview } from "@/lib/db/repository.server";
import { PageHeading } from "../components/trip-details";
import { ArrowText } from "../components/arrow-text";
import type { Route } from "./+types/trip-overview";
import { tripPageMeta } from "../lib/social-meta";

export function meta() {
  return tripPageMeta({ path: "/overview", title: "Trip overview · Méribel ’27 — Club Athletic", description: "Trip dates, chalet, flights, shuttle, schedule, and prices for the Club Athletic week in Méribel." });
}

const date = (value: Date) => new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", day: "numeric", month: "short", year: "numeric",
}).format(value);

export async function loader(_args: Route.LoaderArgs) {
  const [trip, flightRules, pricing, schedule] = await Promise.all([
    getTripOverview(), getFlightRules(), getOpenSpots(), getSchedule(),
  ]);
  return {
    dates: `${date(trip.startDate)} – ${date(trip.endDate)}`,
    destination: `${trip.resort}, ${trip.destination}`,
    property: trip.property.name,
    address: trip.property.address,
    price: pricing.pricing.rangeLabel,
    currency: pricing.pricing.description,
    arrivalAirport: flightRules.inbound?.pickup ?? null,
    shuttles: [
      flightRules.inbound && { direction: "To the chalet", ...flightRules.inbound },
      flightRules.outbound && { direction: "To the airport", ...flightRules.outbound },
    ].filter((item): item is NonNullable<typeof item> => item !== null),
    scheduledDays: schedule.filter((day) => !day.isOpen).length,
  };
}

export default function TripOverview({ loaderData: data }: Route.ComponentProps) {
  return <section className="trip-overview-page" aria-labelledby="trip-overview-heading">
    <PageHeading id="trip-overview-heading" sub="Dates, travel, lodging, and costs for the Méribel trip.">Trip overview</PageHeading>
    <dl className="trip-overview-list">
      <div><dt>Dates</dt><dd>{data.dates}</dd></div>
      <div><dt>Location</dt><dd><ArrowText>{data.destination}</ArrowText></dd></div>
      <div><dt>Stay</dt><dd><ArrowText>{data.property}</ArrowText><span className="trip-overview-note"><ArrowText>{data.address}</ArrowText></span></dd></div>
      <div><dt>Flights</dt><dd>{data.arrivalAirport ? `${data.arrivalAirport} is the airport for the group transfer to and from Méribel.` : "See the Flights page for route and transfer information."}</dd></div>
      <div><dt>Airport shuttle</dt><dd>{data.shuttles.map((shuttle) => <span className="trip-overview-note" key={shuttle.direction}>{shuttle.direction}: {shuttle.pickup} · {shuttle.from}–{shuttle.to}</span>)}</dd></div>
      <div><dt>Week</dt><dd>{data.scheduledDays} days have planned events. The schedule lists meal times and daily plans.</dd></div>
      <div><dt>Price</dt><dd>{data.price} <span className="trip-overview-note">{data.currency}</span></dd></div>
    </dl>
    <nav className="trip-overview-links" aria-label="Trip details">
      <div className="trip-chapters-heading"><h3 className="section-label">More details</h3></div>
      <ol className="trip-chapters-list">
        <li><span className="trip-chapter-number">01</span><Link to="/flights"><span className="trip-chapter-title">Flights</span><span className="trip-chapter-note">Arrival and return guidance</span><ArrowRight size="1em" aria-hidden="true" /></Link></li>
        <li><span className="trip-chapter-number">02</span><Link to="/shuttle"><span className="trip-chapter-title">Airport shuttle</span><span className="trip-chapter-note">Pickup times and locations</span><ArrowRight size="1em" aria-hidden="true" /></Link></li>
        <li><span className="trip-chapter-number">03</span><Link to="/schedule"><span className="trip-chapter-title">Schedule</span><span className="trip-chapter-note">Meals and daily plans</span><ArrowRight size="1em" aria-hidden="true" /></Link></li>
        <li><span className="trip-chapter-number">04</span><Link to="/spots"><span className="trip-chapter-title">Rooms and prices</span><span className="trip-chapter-note">Room options and cost details</span><ArrowRight size="1em" aria-hidden="true" /></Link></li>
      </ol>
    </nav>
  </section>;
}
