import { FaqTable } from "./room-sharing-faq";
import type { FlightRules } from "@/lib/db/repository.server";
import { tripDate } from "../lib/schedule-display";

/** "08:30" -> "8:30 AM" for prose. */
const spoken = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const hour = ((h ?? 0) + 11) % 12 + 1;
  return `${hour}:${String(m ?? 0).padStart(2, "0")} ${(h ?? 0) < 12 ? "AM" : "PM"}`;
};
const hours = (minutes: number) => (minutes % 60 === 0 ? `${minutes / 60} h` : `${Math.round(minutes / 6) / 10} h`);

/** Arrival, return, and Friday-arrival guidance in the same Q&A table used by the FAQ. */
export function FlightBookingRules({ rules }: { rules: FlightRules }) {
  const arrival = <ul className="flight-rules-answer">
    <li>Land in Geneva by <strong>{spoken(rules.arrivalCutoff)}</strong> on {tripDate(rules.startDate, "long")}.</li>
    <li>Aim for {spoken(rules.arrivalTarget)} to allow time for bags and delays.</li>
    {rules.inbound && <li>The shuttle leaves {rules.inbound.pickup} between {rules.inbound.from} and {rules.inbound.to}.</li>}
    <li>Arriving later means arranging your own transfer.</li>
  </ul>;
  const returnFlight = <ul className="flight-rules-answer">
    <li>Book a Geneva departure at <strong>{spoken(rules.returnCutoff)}</strong> or later on {tripDate(rules.endDate, "long")}.</li>
    {rules.outbound && <li>The chalet shuttle leaves {rules.outbound.from === rules.outbound.to ? rules.outbound.from : `${rules.outbound.from}–${rules.outbound.to}`}; the drive to GVA takes about {hours(rules.outbound.durationMinutes)}, before check-in and security.</li>}
  </ul>;
  const friday = <ul className="flight-rules-answer">
    <li>Fly Thursday evening, stay near Geneva Airport, then meet the shuttle on Saturday.</li>
    {rules.hotels.map((hotel) => <li key={hotel.id}><a href={hotel.href} target="_blank" rel="noopener noreferrer">{hotel.label.replace(/\s*\(Friday night\)$/, "")}</a>{hotel.note ? ` — ${hotel.note}` : ""}</li>)}
    <li>Flight options are listed below.</li>
  </ul>;

  return <FaqTable label="Flight arrival and return guidance" rows={[
    { question: "When should I land in Geneva?", answer: arrival },
    { question: "What time should my return flight leave?", answer: returnFlight },
    { question: "Can I arrive on Friday?", answer: friday },
  ]} />;
}
