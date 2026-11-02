import { Link } from "react-router";
import { getSchedule } from "@/lib/db/repository.server";
import type { Route } from "./+types/overview";

import { TripInfo } from "../components/trip-info";

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
          <Link to="/schedule">See full schedule →</Link>
        </div>
        <ol className="home-week">
          {data.week.map(day => <li key={day.id}>
            <span className="home-week-day">{day.dow} {day.number}</span>
            <span className="home-week-event">{day.event}</span>
          </li>)}
        </ol>
      </section>
      <div className="home-welcome">
        <Link to="/faq">See common questions <span aria-hidden="true">→</span></Link>
      </div>
    </section>
  );
}
