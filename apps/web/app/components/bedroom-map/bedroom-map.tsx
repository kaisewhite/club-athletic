import { useEffect, useRef } from "react";
import { SHEET_HTML, SHEET_SIZE } from "./sheet";
import "./bedroom-map.css";

const bedroomRows = [
  ["Bedroom 1", "Upper · R11 · F21", "Master · terrace, dressing, en-suite"],
  ["Bedroom 2", "Middle · R10 · F21", "Twin · balcony, en-suite shower"],
  ["Bedroom 3", "Middle · R10 · F21", "Double · balcony, en-suite shower"],
  ["Bedroom 4", "Middle · R10 · F21", "Quad bunk · balcony, shared shower"],
  ["Bedroom 5", "Middle · R10 · F21", "Bunk cabin · shared shower"],
  ["Bedroom 6", "Lower · R9 · F12", "Double · terrace, en-suite shower"],
  ["Bedroom 7", "Lower · R9 · F12", "Double · terrace, en-suite shower"],
  ["Bedroom 8", "Lower · R9 · F12", "Quad bunk · en-suite bathroom"],
] as const;

/**
 * The owner's bedroom map, as authored. The markup is theirs (see sheet.ts); this
 * component only gives it a box and scales it to fit, so it reads as one sheet at
 * any width instead of re-flowing.
 */
export function BedroomMap() {
  const box = useRef<HTMLDivElement>(null);
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
        <div className="bm-sheet" dangerouslySetInnerHTML={{ __html: SHEET_HTML }} />
      </div>
      <div className="bm-mobile-details">
        <table className="bm-mobile-room-table" aria-label="Bedroom details">
          <thead><tr><th scope="col">Bedroom</th><th scope="col">Floor / door</th><th scope="col">Type</th></tr></thead>
          <tbody>{bedroomRows.map(([bedroom, floorDoor, type]) => <tr key={bedroom}>
            <th scope="row">{bedroom}</th>
            <td data-label="Floor / door">{floorDoor}</td>
            <td data-label="Type">{type}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </figure>
  );
}
