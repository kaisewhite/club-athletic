import type { FlightRecommendations, Links } from "@/lib/db/repository.server";

type TripDates = { startDate: Date; endDate: Date };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function dateForWeekday(anchor: Date, day: string, direction: "before" | "on-or-before") {
  const target = WEEKDAYS.findIndex((value) => value.toLowerCase() === day.slice(0, 3).toLowerCase());
  if (target < 0) return anchor;
  const date = new Date(anchor);
  const delta = (date.getUTCDay() - target + 7) % 7;
  date.setUTCDate(date.getUTCDate() - delta - (direction === "before" && delta === 0 ? 7 : 0));
  return date;
}

function formatDate(date: Date, long = false) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: long ? "long" : "short", month: long ? "long" : "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(date);
}

function formatFlightTime(value: string, date: Date) {
  if (/\b\d{4}\b/.test(value)) return value;
  const day = value.match(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:day)?\b/i)?.[1];
  const time = value.replace(/\s+(Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:day)?\b/i, "").trim();
  const flightDate = day ? dateForWeekday(date, day, "on-or-before") : date;
  return `${formatDate(flightDate)} · ${time}`;
}

function datedSectionTitle(title: string, sectionId: string, dates: TripDates, options: FlightRecommendations[number]["options"]) {
  if (/\b\d{4}\b/.test(title) || options.length === 0) return title;
  if (sectionId.toLowerCase().includes("home") || /return/i.test(title)) return /\b\d{1,2}\s+[A-Za-z]+/.test(title) ? `${title}, ${dates.endDate.getUTCFullYear()}` : `${title} — ${formatDate(dates.endDate, true)}`;
  const first = options[0]!;
  const arrivalDay = first.arrives.match(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:day)?\b/i)?.[1];
  const departureDay = first.departs.match(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:day)?\b/i)?.[1];
  if (!arrivalDay || !departureDay) return title;
  const arrival = dateForWeekday(dates.startDate, arrivalDay, "on-or-before");
  const departure = dateForWeekday(arrival, departureDay, "before");
  return `${title} (${formatDate(departure, true)} to ${formatDate(arrival, true)})`;
}

/**
 * The organizer's flight recommendations (owner, 2026-09-29), in the shape of
 * the trip's Notion guide: one table per option, one-line verdicts, and a
 * shuttle column that says plainly whether the group bus works for that flight.
 * All of it — titles, rows, verdicts — is the database's.
 */
export function FlightRecommendationsSection({ sections, hotelLinks = [], tripDates }: { sections: FlightRecommendations; hotelLinks?: Links; tripDates: TripDates }) {
  if (sections.length === 0) return null;
  return <section className="flight-recs" aria-labelledby="flight-recs-heading">
    <h3 id="flight-recs-heading" className="detail-kicker">Suggested flights from New York</h3>
    {sections.map((section) => {
      const isReturn = section.id.toLowerCase().includes("home") || /return/i.test(section.title);
      const anchor = isReturn ? tripDates.endDate : tripDates.startDate;
      return <article key={section.id} className="flight-rec">
        <h4 className="flight-rec-title">{datedSectionTitle(section.title, section.id, tripDates, section.options)}</h4>
        {section.intro && <p className="flight-rec-copy">{section.intro}</p>}
        {section.options.length > 0 && <div className="detail-table-wrap"><table className="detail-table flight-rec-table" aria-label={section.title}>
          <thead><tr><th scope="col">Flight</th><th scope="col">Route</th><th scope="col">Departs</th><th scope="col">Arrives</th></tr></thead>
          <tbody>{section.options.map((option) => <tr key={option.id}>
            <th scope="row">{option.carrier}</th>
            <td className="flight-rec-route" data-label="Route">{option.route}</td>
            <td data-label="Departs">{formatFlightTime(option.departs, anchor)}</td>
            <td data-label="Arrives">{formatFlightTime(option.arrives, anchor)}</td>
          </tr>)}</tbody>
        </table></div>}
        {section.outro && <p className="flight-rec-copy flight-rec-outro">{section.outro}</p>}
      </article>;
    })}
    {hotelLinks.length > 0 && <section className="flight-hotels" aria-labelledby="flight-hotels-heading">
      <h4 id="flight-hotels-heading" className="flight-rec-title">If you arrive Friday</h4>
      <p className="flight-rec-copy">Staying near GVA is optional. These airport hotels run shuttles back to the terminal for Saturday’s Méribel transfer.</p>
      <div className="link-list">
        {hotelLinks.map((link) => <a className="link-row" key={link.id} href={link.href} target="_blank" rel="noopener noreferrer">
          <span><span className="link-name">{link.label}</span>{link.note && <span className="link-group">{link.note}</span>}</span>
          <span className="text-accent" aria-hidden="true">↗</span>
        </a>)}
      </div>
    </section>}
  </section>;
}
