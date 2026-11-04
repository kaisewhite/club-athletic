import { GuestDetailsForm } from "../components/guest-details-form";
import { getOpenSpots, getRoomsByFloor } from "../../src/lib/db/repository.server";
import { tripPageMeta } from "../lib/social-meta";

export async function loader() {
  const [data, roomData] = await Promise.all([getOpenSpots(), getRoomsByFloor()]);
  const occupantsByRoom = new Map(roomData.floors.flatMap((floor) => floor.rooms.map((room) => [room.id, room.spots
    .filter((spot) => spot.status === "ASSIGNED" && spot.guest)
    .map((spot) => ({ displayName: spot.guest!.displayName, instagramUrl: spot.guest!.instagramUrl }))] as const)));
  return { rooms: data.openRooms.filter((room) => room.openCount > 0).map((room) => ({
    id: room.id, name: room.name, shortName: room.shortName, type: room.type,
    floorName: room.floorName, openCount: room.openCount, occupants: occupantsByRoom.get(room.id) ?? [],
    priceLabel: room.priceLabel, description: room.description,
  })) };
}

export function meta() {
  return tripPageMeta({ path: "/guest-details", title: "Guest details · Méribel ’27 — Club Athletic", description: "Share your room preferences and trip details for the Club Athletic week in Méribel.", image: "chalet" });
}

export default function GuestDetails({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  return <section aria-label="Méribel 2027 guest details">
    <GuestDetailsForm rooms={loaderData.rooms} />
  </section>;
}
