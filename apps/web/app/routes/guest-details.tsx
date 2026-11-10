import { GuestDetailsForm } from "../components/guest-details-form";
import { getOpenSpots, getRoomsByFloor } from "../../src/lib/db/repository.server";
import { tripPageMeta } from "../lib/social-meta";

export async function loader() {
  const [data, roomData] = await Promise.all([getOpenSpots(), getRoomsByFloor()]);
  const addOnsPerPerson = data.pricing.breakdown
    ? Object.values(data.pricing.breakdown).reduce((total, amount) => total + amount, 0)
    : null;
  const formatPrice = new Intl.NumberFormat("en-IE", {
    style: "currency", currency: data.pricing.currency, minimumFractionDigits: 0, maximumFractionDigits: 2,
  });
  const occupantsByRoom = new Map(roomData.floors.flatMap((floor) => floor.rooms.map((room) => [room.id, room.spots
    .filter((spot) => spot.status === "ASSIGNED" && spot.guest)
    .map((spot) => ({ displayName: spot.guest!.displayName, instagramUrl: spot.guest!.instagramUrl }))] as const)));
  return { rooms: data.openRooms.filter((room) => room.openCount > 0).map((room) => ({
    id: room.id, name: room.name, shortName: room.shortName, type: room.type,
    floorName: room.floorName, openCount: room.openCount, occupants: occupantsByRoom.get(room.id) ?? [],
    priceLabel: room.priceLabel,
    totalPriceLabel: room.pricePerPerson === null || addOnsPerPerson === null
      ? null
      : formatPrice.format(Number(room.pricePerPerson) + addOnsPerPerson),
    description: room.description,
  })) };
}

export function meta() {
  return tripPageMeta({ path: "/questionnaire", title: "Questionnaire · Méribel ’27 — Club Athletic", description: "Choose a room and share your contact details, preferences, and trip information for Méribel.", image: "chalet" });
}

export default function GuestDetails({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  return <section aria-label="Méribel 2027 questionnaire">
    <GuestDetailsForm rooms={loaderData.rooms} />
  </section>;
}
