import { ArrowRight } from "@phosphor-icons/react/ssr";
import { getRoomsByFloor } from "@/lib/db/repository.server";
import { PageHeading } from "../components/trip-details";
import { BedroomMap } from "../components/bedroom-map/bedroom-map";
import { RoomSharingFaq } from "../components/room-sharing-faq";
import type { Route } from "./+types/rooms";
import { tripPageMeta } from "../lib/social-meta";

export function meta() {
  return tripPageMeta({ path: "/rooms", title: "Room assignments · Méribel ’27 — Club Athletic", description: "View chalet room layouts, bed assignments, and room-sharing details.", image: "chalet" });
}

export async function loader() {
  const data = await getRoomsByFloor();
  return {
    guestCount: data.guestCount, openCount: data.openCount, capacity: data.capacity,
    floors: data.floors.map(({ id, name, code, rooms }) => ({
      id, name, code,
      rooms: rooms.map(({ id, name, type, description, openCount, spots }) => ({
        id, name, type, description, openCount,
        spots: spots.map(({ id, index, status, guest }) => ({ id, index, status, guest })),
      })),
    })),
  };
}

export default function Rooms({ loaderData: data }: Route.ComponentProps) {
  return <section aria-labelledby="rooms-heading">
    <PageHeading id="rooms-heading" sub={<>{data.guestCount} confirmed guests · {data.openCount} open spots{data.capacity !== null && <> · sleeps up to {data.capacity}</>}.</>}>Rooms</PageHeading>
    <div className="room-guide-link"><a href="/spots">Open spots and prices <span aria-hidden="true"><ArrowRight size="1em" /></span></a></div>
    <BedroomMap floors={data.floors} />
    <RoomSharingFaq />
  </section>;
}
