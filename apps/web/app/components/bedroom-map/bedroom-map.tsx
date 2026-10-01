import { useEffect, useRef, useState } from "react";
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

function MapDrawing({ rooms }: { rooms: { id: string; name: string }[] }) {
  return <div className="bm-sheet">
    <div dangerouslySetInnerHTML={{ __html: SHEET_HTML }} />
    {rooms.map((room, index) => roomPositions[index] && (
      <div className="bm-room-marker" style={roomPositions[index]} key={room.id}>{room.name}</div>
    ))}
  </div>;
}

/** Scale the authored drawing and label it with room rows from the loader. */
export function BedroomMap({ floors }: { floors: BedroomMapFloor[] }) {
  const box = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
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
  useEffect(() => {
    if (!expanded || !dialog.current) return;
    const element = dialog.current;
    element.showModal();
    closeButton.current?.focus();
    return () => { if (element.open) element.close(); };
  }, [expanded]);
  return (
    <figure className="bm" aria-label="Chalet F bedroom map">
      <div className="bm-map-wrap">
        <button className="bm-expand" type="button" onClick={() => setExpanded(true)} aria-label="Enlarge bedroom map">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" /></svg>
          <span>Enlarge map</span>
        </button>
        <div className="bm-scale" ref={box}>
          <MapDrawing rooms={rooms} />
        </div>
      </div>
      {expanded && <dialog className="bm-dialog" ref={dialog} aria-label="Enlarged chalet bedroom map" onClose={() => setExpanded(false)}>
        <div className="bm-dialog-bar"><span>Chalet F bedroom map</span><button ref={closeButton} type="button" onClick={() => setExpanded(false)} aria-label="Close enlarged map">Close</button></div>
        <div className="bm-dialog-scroll" tabIndex={0}><div className="bm-expanded-canvas"><MapDrawing rooms={rooms} /></div></div>
      </dialog>}
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
