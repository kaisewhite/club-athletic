import { ArrowRight } from "@phosphor-icons/react/ssr";
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import "./trip-info.css";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

/** The trip at a glance, opening the home page: a full-width hero over the
 * mountain video, then the three facts on the page below it. */
export function TripInfo() {
  const video = useRef<HTMLVideoElement>(null);
  // The video is server-rendered paused, showing its poster. Playback starts
  // only after hydration and only when motion is welcome; with reduced motion
  // the still poster stays.
  useEffect(() => {
    const element = video.current;
    if (!element || window.matchMedia(reducedMotionQuery).matches) return;
    element.play().catch(() => {
      // Autoplay can be refused (data saver, low power). The poster remains.
    });
  }, []);
  return (
    <section className="trip-welcome" aria-labelledby="trip-welcome-title" aria-describedby="trip-welcome-summary">
      <div className="trip-hero">
        <video ref={video} className="trip-hero-video" src="/video/meribel-peaks.mp4" poster="/video/meribel-peaks-poster.webp"
          muted loop playsInline preload="none" aria-hidden="true" tabIndex={-1} />
        <div className="trip-hero-content">
          <p className="trip-welcome-dateline">Méribel, France <span>·</span> January 30–February 6, 2027</p>
          <h1 id="trip-welcome-title" className="trip-welcome-title">A week in the<br />Three Valleys.</h1>
          <p id="trip-welcome-summary" className="trip-welcome-summary">
            Ski days, après, chef-prepared meals, and plans with the group, based at Falcon Lodge F.
          </p>
          <div className="trip-welcome-actions">
            <Link to="/pricing" className="trip-welcome-primary">See rooms &amp; prices <span aria-hidden="true"><ArrowRight size="1em" /></span></Link>
            <Link to="/chat" className="trip-welcome-secondary">Ask the trip guide</Link>
          </div>
        </div>
      </div>

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
    </section>
  );
}
