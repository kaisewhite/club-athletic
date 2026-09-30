import { getRoomsByFloor } from "@/lib/db/repository.server";
import { PageHeading } from "../components/trip-details";
import { BedroomMap } from "../components/bedroom-map/bedroom-map";
import { RoomSharingFaq } from "../components/room-sharing-faq";
import { guestInstagramUrl } from "../lib/guest-instagrams";
import type { Route } from "./+types/rooms";

const roomType = { MASTER_DOUBLE: "Master double", DOUBLE: "Double room", TWIN: "Twin room", QUAD_BUNK: "Quad bunk room", BUNK_CABIN: "Bunk cabin" } as const;

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
    <PageHeading id="rooms-heading" sub={<>{data.guestCount} confirmed · {data.openCount} spots open{data.capacity !== null && <> · sleeps up to {data.capacity}</>}.</>}>Rooms</PageHeading>
    <div className="room-floors">{data.floors.map((floor) => <section key={floor.id} aria-labelledby={`floor-${floor.id}`}>
      <div className="floor-heading"><h3 id={`floor-${floor.id}`}>{floor.name}</h3><span>{floor.code}</span></div>
      <div className="room-grid">{floor.rooms.map((room) => <article key={room.id} className={`room-card${room.openCount > 0 ? " has-open-spots" : ""}`}>
        <h4 className="room-name">{room.name}</h4><div className="room-type">{roomType[room.type]}</div>
        {room.description && <div className="detail-note">{room.description}</div>}
        <div className="room-spots">{room.spots.map((spot) => <div className="room-spot" key={spot.id}>
          <span className="spot-number">Spot {spot.index}</span>
          {spot.status === "NOT_OFFERED" ? <span className="spot-not-offered">not offered</span>
            : spot.status === "AVAILABLE" ? <span className="spot-available">Available</span>
            : <span className="spot-assigned">{spot.guest ? (() => {
              const instagramUrl = guestInstagramUrl(spot.guest.displayName);
              return instagramUrl
                ? <a href={instagramUrl} target="_blank" rel="noopener noreferrer">{spot.guest.displayName}</a>
                : spot.guest.displayName;
            })() : "Assignment unavailable"}</span>}
        </div>)}</div>
      </article>)}</div>
    </section>)}</div>
    <BedroomMap floors={data.floors} />
    <RoomSharingFaq />
  </section>;
}
