import { ArrowRight } from "@phosphor-icons/react/ssr";
import { Link } from "react-router";
import { getSchedule } from "@/lib/db/repository.server";
import type { Route } from "./+types/overview";

import { TripInfo } from "../components/trip-info";
import { ArrowText } from "../components/arrow-text";

export async function loader(_args?: Route.LoaderArgs) {
  const schedule = await getSchedule();
  // Return display data only; Prisma Decimal fields must not cross the loader boundary.
  return {
    week: schedule.map((day) => ({
      id: day.id, dow: day.dow, number: day.dayNumber, event: day.isOpen ? "TBD" : day.eventTitle,
    })),
  };
}

/** Home: the trip at a glance, then the week. The concierge has its own page
 * at `/chat`, reached from the trip info, the sidebar's New chat and the nav. */
export default function Overview({ loaderData: data }: Route.ComponentProps) {
  return (
    <section className="home-overview" aria-labelledby="trip-welcome-title">
      <TripInfo />
      <section className="home-schedule" aria-labelledby="home-week-heading">
        <div className="week-heading">
          <h2 id="home-week-heading" className="section-label">This week</h2>
          <Link to="/schedule">See full schedule <ArrowRight size="1em" aria-hidden="true" /></Link>
        </div>
        <ol className="home-week">
          {data.week.map(day => <li key={day.id}>
            <span className="home-week-day">{day.dow} {day.number}</span>
            <span className="home-week-event"><ArrowText>{day.event}</ArrowText></span>
          </li>)}
        </ol>
      </section>
      <nav className="trip-chapters" aria-label="Plan the trip">
        <div className="trip-chapters-heading">
          <h2 className="section-label">Plan the trip</h2>
          <span>Club Athletic · Méribel ’27</span>
        </div>
        <ol className="trip-chapters-list">
          <li><span className="trip-chapter-number">01</span><Link to="/flights"><span className="trip-chapter-title">Getting there</span><span className="trip-chapter-note">Flights and airport transfers</span><ArrowRight size="1em" aria-hidden="true" /></Link></li>
          <li><span className="trip-chapter-number">02</span><Link to="/schedule"><span className="trip-chapter-title">The week</span><span className="trip-chapter-note">Dates, meals and plans</span><ArrowRight size="1em" aria-hidden="true" /></Link></li>
          <li><span className="trip-chapter-number">03</span><Link to="/rooms"><span className="trip-chapter-title">Where we stay</span><span className="trip-chapter-note">Falcon Lodge F and room assignments</span><ArrowRight size="1em" aria-hidden="true" /></Link></li>
          <li><span className="trip-chapter-number">04</span><Link to="/pricing"><span className="trip-chapter-title">Rooms and prices</span><span className="trip-chapter-note">Available spots and trip costs</span><ArrowRight size="1em" aria-hidden="true" /></Link></li>
          <li><span className="trip-chapter-number">05</span><Link to="/questionnaire"><span className="trip-chapter-title">Questionnaire</span><span className="trip-chapter-note">Room choice, contact info and preferences</span><ArrowRight size="1em" aria-hidden="true" /></Link></li>
          <li><span className="trip-chapter-number">06</span><Link to="/faq"><span className="trip-chapter-title">Trip questions</span><span className="trip-chapter-note">Answers to common questions</span><ArrowRight size="1em" aria-hidden="true" /></Link></li>
        </ol>
      </nav>
    </section>
  );
}
