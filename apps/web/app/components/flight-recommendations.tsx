import type { FlightRecommendations } from "@/lib/db/repository.server";

/**
 * The organizer's flight recommendations (owner, 2026-09-29), in the shape of
 * the trip's Notion guide: one table per option, one-line verdicts, and a
 * shuttle column that says plainly whether the group bus works for that flight.
 * All of it — titles, rows, verdicts — is the database's.
 */
export function FlightRecommendationsSection({ sections }: { sections: FlightRecommendations }) {
  if (sections.length === 0) return null;
  return <section className="flight-recs" aria-labelledby="flight-recs-heading">
    <h3 id="flight-recs-heading" className="detail-kicker">Recommended flights · New York</h3>
    {sections.map((section) => <article key={section.id} className="flight-rec">
      <h4 className="flight-rec-title">{section.title}</h4>
      {section.intro && <p className="flight-rec-copy">{section.intro}</p>}
      {section.options.length > 0 && <div className="detail-table-wrap"><table className="detail-table flight-rec-table" aria-label={section.title}>
        <thead><tr><th scope="col">Flight</th><th scope="col">Route</th><th scope="col">Departs</th><th scope="col">Arrives</th><th scope="col">Group shuttle</th></tr></thead>
        <tbody>{section.options.map((option) => <tr key={option.id} data-fits={option.fitsShuttle ?? undefined}>
          <th scope="row">{option.carrier}</th>
          <td className="flight-rec-route" data-label="Route">{option.route}</td>
          <td data-label="Departs">{option.departs}</td>
          <td data-label="Arrives">{option.arrives}</td>
          <td className="flight-rec-verdict" data-label="Group shuttle">
            {option.fitsShuttle === true && <span className="flight-rec-yes">Yes</span>}
            {option.fitsShuttle === false && <span className="flight-rec-no">No</span>}
            {option.note && <span className="flight-rec-note">{option.fitsShuttle === null ? "" : " · "}{option.note}</span>}
          </td>
        </tr>)}</tbody>
      </table></div>}
      {section.outro && <p className="flight-rec-copy flight-rec-outro">{section.outro}</p>}
    </article>)}
  </section>;
}
