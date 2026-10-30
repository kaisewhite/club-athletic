import { useEffect, useRef } from "react";
import { Link } from "react-router";
import "./first-visit-welcome.css";

const DISMISSAL_KEY = "club-athletic-trip-welcome-dismissed-v1";

export function FirstVisitWelcome() {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(DISMISSAL_KEY) === "true") return;
    } catch {
      // Storage can be disabled; the welcome still works for this visit.
    }
    dialog.current?.showModal();
  }, []);

  const rememberDismissal = () => {
    try {
      window.localStorage.setItem(DISMISSAL_KEY, "true");
    } catch {
      // Closing the dialog should not depend on storage being available.
    }
  };

  const closeDialog = () => dialog.current?.close();

  return (
    <dialog
      ref={dialog}
      className="trip-welcome"
      aria-labelledby="trip-welcome-title"
      aria-describedby="trip-welcome-summary"
      onClose={rememberDismissal}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeDialog();
      }}
    >
      <div className="trip-welcome-inner">
        <div className="trip-welcome-topline">
          <span>Club Athletic · Trip guide</span>
          <button className="trip-welcome-close" type="button" onClick={closeDialog} autoFocus aria-label="Close trip overview">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>

        <p className="trip-welcome-dateline">Méribel, France <span>·</span> January 30–February 6, 2027</p>
        <h2 id="trip-welcome-title">A week in the<br />Three Valleys.</h2>
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
          <Link to="/spots" className="trip-welcome-primary" onClick={() => { rememberDismissal(); closeDialog(); }}>See rooms &amp; prices <span aria-hidden="true">→</span></Link>
          <button className="trip-welcome-secondary" type="button" onClick={closeDialog}>Explore the trip</button>
        </div>
      </div>
    </dialog>
  );
}
