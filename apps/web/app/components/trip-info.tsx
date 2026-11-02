import { Link } from "react-router";
import "./trip-info.css";

/** The trip at a glance. It was the first-visit dialog; it is now the home
 * page's opening section, shown to every visitor without a click. */
export function TripInfo() {
  return (
    <section className="trip-welcome" aria-labelledby="trip-welcome-title" aria-describedby="trip-welcome-summary">
      <div className="trip-welcome-inner">
        <p className="trip-welcome-dateline">Méribel, France <span>·</span> January 30–February 6, 2027</p>
        <h1 id="trip-welcome-title" className="trip-welcome-title">A week in the<br />Three Valleys.</h1>
        <p id="trip-welcome-summary" className="trip-welcome-summary">
          Ski days, après, chef-prepared meals, and plans with the group, based at Falcon Lodge F.
        </p>

        <div className="trip-welcome-details">
          <section>
            <h2>Included</h2>
            <p>Chalet accommodation, private chef service, round-trip Geneva airport shuttle, taxes, and shared incidentals.</p>
          </section>
          <section>
            <h2>The chalet</h2>
            <p>Private hot tub and saunas, plus the residence pool, hammam, and spa.</p>
          </section>
          <section>
            <h2>Plan your budget</h2>
            <p>Room prices vary. Flights, lift passes, rentals, and personal spending are separate.</p>
          </section>
        </div>

        <div className="trip-welcome-actions">
          <Link to="/spots" className="trip-welcome-primary">See rooms &amp; prices <span aria-hidden="true">→</span></Link>
          <Link to="/chat" className="trip-welcome-secondary">Ask the trip guide</Link>
        </div>
      </div>
    </section>
  );
}
