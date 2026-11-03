import type { FlightRecommendations, Links } from "@/lib/db/repository.server";
import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight } from "@phosphor-icons/react/ssr";
import { ArrowText } from "./arrow-text";

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

function formatDate(date: Date, includeYear = false) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", ...(includeYear ? { year: "numeric" as const } : {}), timeZone: "UTC",
  }).format(date);
}

function datedSectionTitle(title: string, sectionId: string, dates: TripDates, options: FlightRecommendations[number]["options"]): ReactNode {
  if (sectionId.toLowerCase().includes("home") || /return/i.test(title)) return `Return — ${formatDate(dates.endDate, true)}`;
  if (options.length === 0) return <ArrowText>{title}</ArrowText>;
  const first = options[0]!;
  const arrivalDay = first.arrives.match(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:day)?\b/i)?.[1];
  const departureDay = first.departs.match(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:day)?\b/i)?.[1];
  if (!arrivalDay || !departureDay) return <ArrowText>{title}</ArrowText>;
  const arrival = dateForWeekday(dates.startDate, arrivalDay, "on-or-before");
  const departure = dateForWeekday(arrival, departureDay, "before");
  const optionNumber = title.match(/^Option\s+\d+/i)?.[0] ?? "Option";
  return <>{optionNumber} — {formatDate(departure)} <span className="flight-rec-date-arrival"><span className="sr-only">to</span><ArrowRight size="1em" aria-hidden="true" /> {formatDate(arrival, true)}</span></>;
}

/**
 * The organizer's flight recommendations (owner, 2026-09-29), in the shape of
 * the trip's Notion guide: one table per option, one-line verdicts, and concise
 * dates in each option heading.
 */
export function FlightRecommendationsSection({ sections, hotelLinks = [], tripDates }: { sections: FlightRecommendations; hotelLinks?: Links; tripDates: TripDates }) {
  if (sections.length === 0) return null;
  return <section className="flight-recs" aria-labelledby="flight-recs-heading">
    <h3 id="flight-recs-heading" className="detail-kicker">Suggested flights from New York</h3>
    {sections.map((section) => {
      return <article key={section.id} className="flight-rec">
        <h4 className="flight-rec-title">{datedSectionTitle(section.title, section.id, tripDates, section.options)}</h4>
        {section.intro && <p className="flight-rec-copy"><ArrowText>{section.intro}</ArrowText></p>}
        {section.options.length > 0 && <div className="detail-table-wrap"><table className="detail-table flight-rec-table" aria-label={section.title}>
          <thead><tr><th scope="col">Flight</th><th scope="col">Route</th><th scope="col">Departs</th><th scope="col">Arrives</th></tr></thead>
          <tbody>{section.options.map((option) => <tr key={option.id}>
            <th scope="row"><ArrowText>{option.carrier}</ArrowText></th>
            <td className="flight-rec-route" data-label="Route"><ArrowText>{option.route}</ArrowText></td>
            <td data-label="Departs"><ArrowText>{option.departs}</ArrowText></td>
            <td data-label="Arrives"><ArrowText>{option.arrives}</ArrowText></td>
          </tr>)}</tbody>
        </table></div>}
        {section.outro && <p className="flight-rec-copy flight-rec-outro"><ArrowText>{section.outro}</ArrowText></p>}
      </article>;
    })}
    {hotelLinks.length > 0 && <section className="flight-hotels" aria-labelledby="flight-hotels-heading">
      <h4 id="flight-hotels-heading" className="flight-rec-title">If you arrive Friday</h4>
      <p className="flight-rec-copy">Staying near GVA is optional. These airport hotels run shuttles back to the terminal for Saturday’s Méribel transfer.</p>
      <div className="link-list">
        {hotelLinks.map((link) => <a className="link-row" key={link.id} href={link.href} target="_blank" rel="noopener noreferrer">
          <span><span className="link-name"><ArrowText>{link.label}</ArrowText></span>{link.note && <span className="link-group"><ArrowText>{link.note}</ArrowText></span>}</span>
          <span className="text-accent" aria-hidden="true"><ArrowUpRight size="1em" /></span>
        </a>)}
      </div>
    </section>}
  </section>;
}
