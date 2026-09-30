import { useEffect, useRef } from "react";
import { SHEET_HTML, SHEET_SIZE } from "./sheet";
import "./bedroom-map.css";

type BedroomMapFloor = {
  id: string;
  name: string;
  code: string;
  rooms: { id: string; name: string; description: string | null }[];
};

// Positions on the authored drawing, in the same floor/room order as the loader.
const roomPositions = [
  { left: 650, top: 644 },
  { left: 489, top: 533 },
  { left: 222, top: 368 },
  { left: 706, top: 533 },
  { left: 600, top: 30 },
  { left: 30, top: 1062 },
  { left: 240, top: 1050 },
  { left: 250, top: 560 },
] as const;

/** Scale the authored drawing and label it with room rows from the loader. */
export function BedroomMap({ floors }: { floors: BedroomMapFloor[] }) {
  const box = useRef<HTMLDivElement>(null);
  const rooms = floors.flatMap((floor) => floor.rooms.map((room) => ({ ...room, floor })));
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => el.style.setProperty("--bm-scale", String(el.clientWidth / SHEET_SIZE));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <figure className="bm" aria-label="Chalet F bedroom map">
      <div className="bm-scale" ref={box}>
        <div className="bm-sheet">
          <div dangerouslySetInnerHTML={{ __html: SHEET_HTML }} />
          {rooms.map((room, index) => roomPositions[index] && (
            <div className="bm-room-marker" style={roomPositions[index]} key={room.id}>{room.name}</div>
          ))}
        </div>
      </div>
      <figcaption className="bm-details">
        <h3>Bedroom details</h3>
        <table className="bm-room-table">
          <thead><tr><th scope="col">Bedroom</th><th scope="col">Floor / door</th><th scope="col">Description</th></tr></thead>
          <tbody>{rooms.map((room) => <tr key={room.id}>
            <th scope="row">{room.name}</th>
            <td data-label="Floor / door"><span className="bm-mobile-field-label">Floor / door</span><span className="bm-mobile-field-value">{room.floor.name} · {room.floor.code}</span></td>
            <td data-label="Description"><span className="bm-mobile-field-label">Description</span><span className="bm-mobile-field-value">{room.description}</span></td>
          </tr>)}</tbody>
        </table>
      </figcaption>
    </figure>
  );
}
