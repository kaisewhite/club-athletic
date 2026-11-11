import { getFlightRecommendations, getFlightRules, getFlightTable, getLinks } from "@/lib/db/repository.server";
import { FlightBookingRules } from "../components/flight-booking-rules";
import { FlightRecommendationsSection } from "../components/flight-recommendations";
import { GroupFlightTable } from "../components/flight-table";
import { FlightReminderDialog } from "../components/flight-reminder-dialog";
import { PageHeading } from "../components/trip-details";
import type { Route } from "./+types/flights";
import { tripPageMeta } from "../lib/social-meta";

export function meta() {
  return tripPageMeta({ path: "/flights", title: "Flights · Méribel ’27 — Club Athletic", description: "Flight options to Geneva, airport transfer guidance, and group flight details for Méribel ’27." });
}

export async function loader() {
  const [flights, recommendations, rules, links] = await Promise.all([getFlightTable(), getFlightRecommendations(), getFlightRules(), getLinks()]);
  return { flights, recommendations, rules, hotelLinks: links.filter((link) => link.group === "Hotels") };
}

export default function Flights({ loaderData: { flights, recommendations, rules, hotelLinks } }: Route.ComponentProps) {
  return <section aria-labelledby="flights-heading">
    <PageHeading id="flights-heading">Flights</PageHeading>
    <FlightReminderDialog startDate={rules.startDate} arrivalCutoff={rules.arrivalCutoff} />
    <div className="flight-planning-section">
      <div className="travel-chapter-heading"><h3>Plan your arrival and return</h3></div>
      <FlightBookingRules rules={rules} />
    </div>
    <div className="flight-planning-section flight-options-section">
      <div className="travel-chapter-heading"><h3>Flight options</h3></div>
      <FlightRecommendationsSection sections={recommendations} hotelLinks={hotelLinks} tripDates={{ startDate: rules.startDate, endDate: rules.endDate }} />
    </div>
    <div className="flight-planning-section flight-group-section">
      <GroupFlightTable flights={flights} />
    </div>
  </section>;
}
