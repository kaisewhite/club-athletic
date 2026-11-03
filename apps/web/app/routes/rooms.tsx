import { ArrowRight } from "@phosphor-icons/react/ssr";
import { getRoomsByFloor } from "@/lib/db/repository.server";
import { PageHeading } from "../components/trip-details";
import { BedroomMap } from "../components/bedroom-map/bedroom-map";
import { RoomSharingFaq } from "../components/room-sharing-faq";
import { GuestInstagramLink } from "../components/guest-instagram-link";
import { ArrowText } from "../components/arrow-text";
import type { Route } from "./+types/rooms";

import { roomTypeLabel as roomType } from "../lib/room-types";

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
    <section className="room-assignment-guide" aria-labelledby="room-assignments-heading">
      <div className="travel-chapter-heading"><span>01</span><h3 id="room-assignments-heading">Room assignments</h3></div>
      <div className="room-floors">{data.floors.map((floor) => <section key={floor.id} aria-labelledby={`floor-${floor.id}`}>
      <div className="floor-heading"><h3 id={`floor-${floor.id}`}><ArrowText>{floor.name}</ArrowText></h3><span><ArrowText>{floor.code}</ArrowText></span></div>
      <div className="room-grid">{floor.rooms.map((room) => <article key={room.id} className={`room-card${room.openCount > 0 ? " has-open-spots" : ""}`}>
        <h4 className="room-name"><ArrowText>{room.name}</ArrowText></h4><div className="room-type">{roomType[room.type]}</div>
        {room.description && <div className="detail-note"><ArrowText>{room.description}</ArrowText></div>}
        <div className="room-spots">{room.spots.map((spot) => <div className="room-spot" key={spot.id}>
          <span className="spot-number">Spot {spot.index}</span>
          {spot.status === "NOT_OFFERED" ? <span className="spot-not-offered">not offered</span>
            : spot.status === "AVAILABLE" ? <span className="spot-available">Available</span>
            : <span className="spot-assigned">{spot.guest ? (() => {
              return <GuestInstagramLink displayName={spot.guest.displayName} instagramUrl={spot.guest.instagramUrl} />;
            })() : "Guest not listed"}</span>}
        </div>)}</div>
      </article>)}</div>
      </section>)}</div>
    </section>
    <BedroomMap floors={data.floors} />
    <RoomSharingFaq />
  </section>;
}
