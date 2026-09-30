import { getSchedule } from "@/lib/db/repository.server";
import { dayEntries } from "../lib/schedule-display";
import type { Route } from "./+types/schedule";

export async function loader() {
  return { schedule: await getSchedule() };
}

export default function Schedule({ loaderData }: Route.ComponentProps) {
  return (
    <section aria-labelledby="schedule-heading">
      <h2 id="schedule-heading">The week<span className="text-accent">.</span></h2>
      <p className="page-sub">Events and chef meals. Open days are up for grabs.</p>
      <div className="schedule-list">
        {loaderData.schedule.map((day) => <div className="schedule-row" key={day.id}>
          <div><div className="day-label">{day.dow}</div><div className="schedule-day-number">{day.dayNumber}</div></div>
          {/* Breakfast, the event and dinner are the same kind of thing — something
              happening at a time — so they get the same row shape, and a day
              lists only the ones that are happening (see dayEntries). Owner,
              2026-09-28: "Everything needs to be consistent", and "if there's
              not an event for that day, stop adding it to the schedule." Times
              come from the database (D11), never from constants here. */}
          <ol className="schedule-entries">
            {dayEntries(day).map((entry) => <li key={entry.key} className="schedule-entry">
              <span className="schedule-time">{entry.time ?? "TBD"}</span>
              <span className="schedule-entry-title">{entry.title}</span>
            </li>)}
          </ol>
        </div>)}
      </div>
    </section>
  );
}
