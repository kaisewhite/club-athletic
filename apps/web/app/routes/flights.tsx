import { getFlightRecommendations, getFlightRules, getFlightTable } from "@/lib/db/repository.server";
import { FlightBookingRules } from "../components/flight-booking-rules";
import { FlightRecommendationsSection } from "../components/flight-recommendations";
import { GroupFlightTable } from "../components/flight-table";
import { PageHeading } from "../components/trip-details";
import type { Route } from "./+types/flights";

export async function loader() {
  const [flights, recommendations, rules] = await Promise.all([getFlightTable(), getFlightRecommendations(), getFlightRules()]);
  return { flights, recommendations, rules };
}

export default function Flights({ loaderData: { flights, recommendations, rules } }: Route.ComponentProps) {
  return <section aria-labelledby="flights-heading">
    <PageHeading id="flights-heading" sub="Everything is timed around the group shuttle at Geneva (GVA).">Flights</PageHeading>
    <FlightBookingRules rules={rules} />
    <FlightRecommendationsSection sections={recommendations} />
    <GroupFlightTable flights={flights} />
  </section>;
}
