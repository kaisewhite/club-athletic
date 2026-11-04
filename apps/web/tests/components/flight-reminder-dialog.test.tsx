import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLIGHT_REMINDER_KEY, FlightReminderDialog } from "../../app/components/flight-reminder-dialog";

const props = { startDate: new Date("2027-01-30T00:00:00.000Z"), arrivalCutoff: "09:30" };
let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("FlightReminderDialog", () => {
  it("is absent from the server HTML so it never blocks the first paint", () => {
    expect(renderToStaticMarkup(<FlightReminderDialog {...props} />)).toBe("");
  });

  it("opens on arrival with the shuttle day and landing cutoff from the trip rules", async () => {
    await act(async () => root!.render(<FlightReminderDialog {...props} />));
    const dialog = container.querySelector<HTMLDialogElement>("dialog.flight-reminder");
    expect(dialog?.open).toBe(true);
    expect(dialog?.querySelector("h2")?.textContent).toBe("Quick flight reminder.");
    const body = dialog?.querySelector("#flight-reminder-body")?.textContent;
    expect(body).toBe("We have the group shuttle booked for Saturday, January 30. It doesn’t matter whether you fly in Friday or Saturday — just make sure your flight lands in Geneva before 9:30 AM Saturday so you can make the shuttle.");
    expect([...dialog!.querySelectorAll("strong")].map((node) => node.textContent)).toEqual(["Saturday, January 30", "lands in Geneva before 9:30 AM Saturday"]);
  });

  it("closes on Got it and stays closed for the rest of the session", async () => {
    await act(async () => root!.render(<FlightReminderDialog {...props} />));
    await act(async () => container.querySelector<HTMLButtonElement>(".flight-reminder-close")!.click());
    expect(container.querySelector("dialog")).toBeNull();
    expect(window.sessionStorage.getItem(FLIGHT_REMINDER_KEY)).toBe("true");

    await act(async () => root!.unmount());
    root = createRoot(container);
    await act(async () => root!.render(<FlightReminderDialog {...props} />));
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("closes from the labelled X in the corner", async () => {
    await act(async () => root!.render(<FlightReminderDialog {...props} />));
    const x = container.querySelector<HTMLButtonElement>(".flight-reminder-x")!;
    expect(x.getAttribute("aria-label")).toBe("Close flight reminder");
    expect(x.querySelector("svg")).not.toBeNull();
    await act(async () => x.click());
    expect(container.querySelector("dialog")).toBeNull();
    expect(window.sessionStorage.getItem(FLIGHT_REMINDER_KEY)).toBe("true");
  });

  it("closes on Escape like a native dialog", async () => {
    await act(async () => root!.render(<FlightReminderDialog {...props} />));
    await act(async () => { container.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })); });
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("formats an afternoon cutoff and still opens when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    await act(async () => root!.render(<FlightReminderDialog startDate="2027-01-30T00:00:00.000Z" arrivalCutoff="13:05" />));
    expect(container.querySelector("#flight-reminder-body")?.textContent).toContain("before 1:05 PM Saturday");
    vi.restoreAllMocks();
  });
});
