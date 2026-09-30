import { z } from "zod";
import { tripDate } from "./schedule-display";
import type { getTripOverview } from "@/lib/db/repository.server";

type TripOverview = Awaited<ReturnType<typeof getTripOverview>>;

export function faqTiles(trip: TripOverview) {
  const time = (date: Date | undefined) => date ? new Intl.DateTimeFormat("en-GB", {
    timeZone: trip.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date) : "TBA";
  const pricing = z.object({ minPerPerson: z.number(), maxPerPerson: z.number() }).parse(trip.pricing);
  const money = new Intl.NumberFormat("en-IE", { style: "currency", currency: trip.currency, maximumFractionDigits: 0 });
  const price = money.format(pricing.minPerPerson);
  const bunkRange = pricing.maxPerPerson > pricing.minPerPerson ? `${price}–${money.format(pricing.maxPerPerson)}` : price;
  const country = trip.destination.split(", ").slice(1);
  const location = [trip.resort, ...country].join(", ");
  const dates = `${tripDate(trip.startDate)} → ${tripDate(trip.endDate)} ${trip.endDate.getUTCFullYear()}`;
  const daysUntil = Math.max(0, Math.ceil((trip.startDate.getTime() - Date.now()) / 86_400_000));
  const inbound = trip.shuttles.find((shuttle) => shuttle.direction === "INBOUND");
  const outbound = trip.shuttles.find((shuttle) => shuttle.direction === "OUTBOUND");

  return [
    { to: "/schedule", question: "When is the trip?", lead: dates, kicker: "Trip dates", sub: `${daysUntil} days until the trip` },
    { to: "/chalet", question: "Where are we staying?", lead: location, kicker: "Stay", sub: "" },
    { to: "/shuttle", question: "What time does the bus leave Geneva?", lead: null, kicker: "Bus leaves Geneva", sub: `${tripDate(trip.startDate, "long")}, between ${time(inbound?.departWindowStart)} and ${time(inbound?.departWindowEnd)}` },
    { to: "/flights", question: "What time do I need to land?", lead: trip.flightArrivalCutoff, kicker: "Your flight must land by", sub: `${new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(trip.startDate)} morning at Geneva, or you’ll miss the bus` },
    { to: "/spots", question: "How many beds are still open?", lead: String(trip.openCount), kicker: "Beds still available", sub: `left · from ${price} per person, everything included`, accent: true },
    { to: "/spots", question: "How much is a bunk?", lead: bunkRange, kicker: "Per person, all-in", sub: "everything included · varies by room" },
    { to: "/chef", question: "How many meals does the chef cook?", lead: null, kicker: "Meals cooked for us", sub: `${trip.chefBreakfastCount} breakfasts and ${trip.chefDinnerCount} dinners` },
    { to: "/shuttle", question: "What time is the bus back to the airport?", lead: time(outbound?.departWindowStart), kicker: "Bus back to the airport", sub: `${tripDate(trip.endDate, "long")} · book flights for ${trip.flightReturnCutoff} or later` },
    { to: "/rooms", question: "How many people are coming?", lead: trip.capacity === null ? String(trip.guestCount) : `${trip.guestCount} of ${trip.capacity}`, kicker: "People coming", sub: "see who’s sleeping where" },
  ];
}
