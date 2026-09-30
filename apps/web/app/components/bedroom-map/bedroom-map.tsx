import { useEffect, useRef } from "react";
import { SHEET_HTML, SHEET_SIZE } from "./sheet";
import "./bedroom-map.css";

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
    </figure>
  );
}
