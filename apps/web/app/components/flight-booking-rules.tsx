import type { CSSProperties } from "react";
import type { FlightRules } from "@/lib/db/repository.server";
import { tripDate } from "../lib/schedule-display";

const kicker: CSSProperties = { fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--accent)", fontWeight: 700, margin: 0 };
const time: CSSProperties = { fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 56, lineHeight: 1, letterSpacing: "-.04em", margin: "10px 0 4px" };
const rule: CSSProperties = { fontWeight: 600, marginBottom: 10 };
const copy: CSSProperties = { fontSize: 14, margin: "0 0 6px", color: "var(--text-muted)" };
const note: CSSProperties = { fontSize: 13, margin: 0, color: "var(--text-dim)" };

/** "08:30" -> "8:30 AM" for prose; the big figure keeps the stored 24h form. */
const spoken = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const hour = ((h ?? 0) + 11) % 12 + 1;
  return `${hour}:${String(m ?? 0).padStart(2, "0")} ${(h ?? 0) < 12 ? "AM" : "PM"}`;
};
const hours = (minutes: number) => (minutes % 60 === 0 ? `${minutes / 60} h` : `${Math.round(minutes / 6) / 10} h`);

/**
 * The three booking cards. Every figure is the database's — the cutoffs on the
 * trip, the shuttle windows on the shuttle rows, the hotels from Links — so a
 * change made in Prisma Studio shows up here and in the agent's answers alike.
 */
export function FlightBookingRules({ rules }: { rules: FlightRules }) {
  return <div className="detail-grid">
    <article className="detail-card">
      <h3 style={kicker}>Getting there · {tripDate(rules.startDate, "long")}</h3>
      <div style={time}>{rules.arrivalCutoff}</div>
      <div style={rule}>Your flight needs to land in Geneva by {spoken(rules.arrivalCutoff)}</div>
      <p style={copy}>Aim for {spoken(rules.arrivalTarget)} or earlier for bags and delays.{rules.inbound && <> Shuttle leaves {rules.inbound.pickup} {rules.inbound.from}–{rules.inbound.to}.</>}</p>
      <p style={note}>Land later and you'll likely miss it — plan your own transfer.</p>
    </article>
    <article className="detail-card">
      <h3 style={kicker}>Going home · {tripDate(rules.endDate, "long")}</h3>
      <div style={time}>{rules.returnCutoff}</div>
      <div style={rule}>Book a flight leaving Geneva at {spoken(rules.returnCutoff)} or later</div>
      <p style={copy}>{rules.outbound && <>Chalet pickup {rules.outbound.from === rules.outbound.to ? rules.outbound.from : `${rules.outbound.from}–${rules.outbound.to}`}, ~{hours(rules.outbound.durationMinutes)} to GVA, then check-in and security.</>}</p>
      <p style={note}>Anything earlier and you won't make it through security in time.</p>
    </article>
    <article className="detail-card">
      <h3 style={kicker}>Option · Arrive Friday</h3>
      <div style={{ ...time, fontSize: 30, lineHeight: 1.05, letterSpacing: "-.03em", margin: "10px 0 10px" }}>Overnight near GVA</div>
      <p style={{ ...copy, marginBottom: 12 }}>Fly Thursday evening, land Friday morning, sleep by the airport, meet the shuttle Saturday. Flights in the recommendations below.</p>
      <div style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 6 }}>
        {rules.hotels.map((hotel) => <div key={hotel.id}>
          <a href={hotel.href} target="_blank" rel="noopener noreferrer">{hotel.label.replace(/\s*\(Friday night\)$/, "")}</a>
          {hotel.note && <span style={{ color: "var(--text-dim)" }}> — {hotel.note}</span>}
        </div>)}
      </div>
    </article>
  </div>;
}
