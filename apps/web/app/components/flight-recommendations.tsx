import type { FlightRecommendations, Links } from "@/lib/db/repository.server";

/**
 * The organizer's flight recommendations (owner, 2026-09-29), in the shape of
 * the trip's Notion guide: one table per option, one-line verdicts, and a
 * shuttle column that says plainly whether the group bus works for that flight.
 * All of it — titles, rows, verdicts — is the database's.
 */
export function FlightRecommendationsSection({ sections, hotelLinks = [] }: { sections: FlightRecommendations; hotelLinks?: Links }) {
  if (sections.length === 0) return null;
  return <section className="flight-recs" aria-labelledby="flight-recs-heading">
    <h3 id="flight-recs-heading" className="detail-kicker">Suggested flights from New York</h3>
    {sections.map((section) => <article key={section.id} className="flight-rec">
      <h4 className="flight-rec-title">{section.title}</h4>
      {section.intro && <p className="flight-rec-copy">{section.intro}</p>}
      {section.options.length > 0 && <div className="detail-table-wrap"><table className="detail-table flight-rec-table" aria-label={section.title}>
        <thead><tr><th scope="col">Flight</th><th scope="col">Route</th><th scope="col">Departs</th><th scope="col">Arrives</th></tr></thead>
        <tbody>{section.options.map((option) => <tr key={option.id}>
          <th scope="row">{option.carrier}</th>
          <td className="flight-rec-route" data-label="Route">{option.route}</td>
          <td data-label="Departs">{option.departs}</td>
          <td data-label="Arrives">{option.arrives}</td>
        </tr>)}</tbody>
      </table></div>}
      {section.outro && <p className="flight-rec-copy flight-rec-outro">{section.outro}</p>}
    </article>)}
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
