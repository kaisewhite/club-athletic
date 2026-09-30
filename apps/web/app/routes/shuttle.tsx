import { getShuttles } from "@/lib/db/repository.server";
import { PageHeading } from "../components/trip-details";
import type { Route } from "./+types/shuttle";

// Both ends of this transfer use the same local clock, including DST.
const localTime = (date: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(date);
const localDate = (date: Date) => {
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "Europe/Paris" }).format(date);
  return `${part({ weekday: "long" })} ${part({ day: "numeric" })} ${part({ month: "short" })}`;
};

export async function loader() {
  return { shuttles: await getShuttles() };
}

export default function Shuttle({ loaderData: { shuttles } }: Route.ComponentProps) {
  const outbound = shuttles.find((shuttle) => shuttle.direction === "INBOUND");
  return <section aria-labelledby="shuttle-heading">
    <PageHeading id="shuttle-heading" sub={outbound ? <>One {outbound.seats}-seat bus each way for people, luggage and skis. About {outbound.durationMinutes / 60} hours door to door.</> : "Group transfers for people, luggage and skis."}>Shuttle</PageHeading>
    <div className="detail-grid">{shuttles.map((shuttle) => {
      const toChalet = shuttle.direction === "INBOUND";
      return <article className={`detail-card${toChalet ? " shuttle-outbound" : ""}`} key={shuttle.id}>
        <h3 className="detail-kicker" style={{ marginBottom: 0 }}>{toChalet ? "To the chalet" : "Back to the airport"} · {localDate(shuttle.departWindowStart)}</h3>
        <div className="shuttle-time">{localTime(shuttle.departWindowStart)}</div>
        <p className="shuttle-copy">{toChalet ? "The bus leaves" : "The bus picks us up at"} {shuttle.pickupLocation} {localTime(shuttle.departWindowStart) === localTime(shuttle.departWindowEnd) ? `at ${localTime(shuttle.departWindowStart)}` : `between ${localTime(shuttle.departWindowStart)} and ${localTime(shuttle.departWindowEnd)}`}. {toChalet ? "Have your bags with you at the meeting point." : "Pack the night before."}</p>
      </article>;
    })}</div>
    {shuttles.map((shuttle) => <p className="detail-note" key={shuttle.id}>
      <span>{shuttle.direction === "INBOUND" ? "To the chalet" : "Back to the airport"}: </span>
      {shuttle.notes?.match(/Meeting point[^.]*\.?/i)?.[0] ?? shuttle.notes ?? "Meeting point to be announced."}
      {shuttle.driverContact && <> Driver contact: {shuttle.driverContact}</>}
    </p>)}
  </section>;
}
