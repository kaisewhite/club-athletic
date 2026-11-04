import { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react/ssr";
import "./flight-reminder-dialog.css";

/** Once per browser session: a reminder, not a gate. Exported for the acceptance helper. */
export const FLIGHT_REMINDER_KEY = "club-athletic-flight-reminder-seen-v1";

const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });

/** "09:30" → "9:30 AM", without a timezone conversion: the cutoff is already Geneva wall time. */
function wallClock(time: string) {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

function alreadySeen() {
  try { return window.sessionStorage.getItem(FLIGHT_REMINDER_KEY) === "true"; } catch { return false; }
}

function markSeen() {
  try { window.sessionStorage.setItem(FLIGHT_REMINDER_KEY, "true"); } catch { /* storage blocked: it simply shows again next visit */ }
}

/** Shown on arrival at /flights. Date and cutoff come from the trip rules, so they match the page's shuttle statuses. */
export function FlightReminderDialog({ startDate, arrivalCutoff }: { startDate: Date | string; arrivalCutoff: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  // Opened after hydration only, so the server HTML never contains a modal.
  useEffect(() => { if (!alreadySeen()) setOpen(true); }, []);
  useEffect(() => {
    const element = dialog.current;
    if (!open || !element || element.open) return;
    element.showModal();
    // Focus the dialog itself: the browser would otherwise put a focus ring on the corner X before any interaction.
    element.focus();
  }, [open]);

  const close = () => { markSeen(); dialog.current?.close(); setOpen(false); };
  if (!open) return null;

  const shuttleDay = day.format(new Date(startDate));
  const weekday = shuttleDay.split(",")[0];
  return <dialog
    ref={dialog}
    className="flight-reminder"
    tabIndex={-1}
    aria-labelledby="flight-reminder-title"
    aria-describedby="flight-reminder-body"
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}
  >
    <button type="button" className="flight-reminder-x" onClick={close} aria-label="Close flight reminder"><X size={20} aria-hidden="true" /></button>
    <div className="flight-reminder-panel">
      <p className="flight-reminder-eyebrow">Group shuttle · Geneva (GVA)</p>
      <h2 id="flight-reminder-title">Quick flight reminder<span className="text-accent">.</span></h2>
      <p id="flight-reminder-body" className="flight-reminder-body">
        We have the group shuttle booked for <strong>{shuttleDay}</strong>. It doesn’t matter whether you fly in Friday or {weekday} — just make sure your flight <strong>lands in Geneva before {wallClock(arrivalCutoff)} {weekday}</strong> so you can make the shuttle.
      </p>
      <button type="button" className="flight-reminder-close" onClick={close}>Got it</button>
    </div>
  </dialog>;
}
