import { getShuttles } from "@/lib/db/repository.server";
import { PageHeading } from "../components/trip-details";
import type { Route } from "./+types/shuttle";

// Both ends of this transfer use the same local clock, including DST.
const localTime = (date: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(date);
const localDate = (date: Date) => {
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "Europe/Paris" }).format(date);
  return `${part({ weekday: "long" })} ${part({ day: "numeric" })} ${part({ month: "short" })}`;
};
const splitStops = (location: string) => location.split(/\s+(?:\+|then|and)\s+/).map((stop) => stop.trim()).filter(Boolean);

export async function loader() {
  return { shuttles: await getShuttles() };
}

export default function Shuttle({ loaderData: { shuttles } }: Route.ComponentProps) {
  const inbound = shuttles.find((shuttle) => shuttle.direction === "INBOUND");
  const outbound = shuttles.find((shuttle) => shuttle.direction === "OUTBOUND");
  const chaletStops = inbound ? splitStops(inbound.dropoffLocation) : [];
  const returnStops = outbound ? splitStops(outbound.pickupLocation) : [];
  return <section aria-labelledby="shuttle-heading">
    <PageHeading id="shuttle-heading" sub="Pickup and drop-off times and locations.">Shuttle</PageHeading>
    <div className="detail-grid">{shuttles.map((shuttle) => {
      const toChalet = shuttle.direction === "INBOUND";
      const pickupStops = splitStops(shuttle.pickupLocation);
      const dropoffStops = splitStops(shuttle.dropoffLocation);
      const pickupTimes = pickupStops.length > 1
        ? [shuttle.departWindowStart, shuttle.departWindowEnd]
        : [];
      return <article className={`detail-card${toChalet ? " shuttle-outbound" : ""}`} key={shuttle.id}>
        <h3 className="detail-kicker" style={{ marginBottom: 0 }}>{toChalet ? "To the chalet" : "Back to the airport"} · {localDate(shuttle.departWindowStart)}</h3>
        <div className="shuttle-time">{localTime(shuttle.departWindowStart)}{localTime(shuttle.departWindowStart) !== localTime(shuttle.departWindowEnd) && `–${localTime(shuttle.departWindowEnd)}`}</div>
        <div className="shuttle-locations">
          <div className="shuttle-location-group">
            <div className="shuttle-location-label">Pickup</div>
            <ol className="shuttle-stop-list">
              {pickupStops.map((stop, index) => <li className={`shuttle-stop${pickupStops.length === 1 ? " shuttle-stop-single" : ""}`} key={`${stop}-${index}`}>
                <span className="shuttle-stop-index">{pickupStops.length > 1 ? `Stop ${index + 1}` : ""}{pickupTimes[index] && ` · ${localTime(pickupTimes[index]!)}`}</span>
                <span className="shuttle-stop-address">{stop}</span>
              </li>)}
            </ol>
          </div>
          <div className="shuttle-location-group">
            <div className="shuttle-location-label">Drop-off</div>
            <ol className="shuttle-stop-list">
              {dropoffStops.map((stop, index) => <li className={`shuttle-stop${dropoffStops.length === 1 ? " shuttle-stop-single" : ""}`} key={`${stop}-${index}`}>
                <span className="shuttle-stop-index">{dropoffStops.length > 1 ? `Stop ${index + 1}` : ""}</span>
                <span className="shuttle-stop-address">{stop}</span>
              </li>)}
            </ol>
          </div>
        </div>
      </article>;
    })}</div>
    <div className="shuttle-explainer">
      <h3 className="detail-kicker">What to know</h3>
      <ul className="shuttle-explainer-list">
        {inbound && <>
          <li>For the trip to Méribel, meet the shuttle outside baggage claim at Geneva Airport (GVA).</li>
          <li>The shuttle leaves GVA between {localTime(inbound.departWindowStart)} and {localTime(inbound.departWindowEnd)}.</li>
          {chaletStops.length > 1 && <li>At the chalet, the shuttle stops at {chaletStops[0]} first, then {chaletStops[1]}.</li>}
        </>}
        {outbound && returnStops.length > 1 && <li>For the trip home, be ready at {returnStops[0]} at {localTime(outbound.departWindowStart)}. The shuttle then stops at {returnStops[1]} at {localTime(outbound.departWindowEnd)}.</li>}
      </ul>
    </div>
  </section>;
}
