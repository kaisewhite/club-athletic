import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Flights, { loader } from "../../app/routes/flights";
import { GroupFlightTable } from "../../app/components/flight-table";
import type { FlightTable } from "../../src/lib/db/repository.server";

const { getFlightTable, getFlightRecommendations, getFlightRules } = vi.hoisted(() => ({ getFlightTable: vi.fn(), getFlightRecommendations: vi.fn(), getFlightRules: vi.fn() }));
vi.mock("../../src/lib/db/repository.server", () => ({ getFlightTable, getFlightRecommendations, getFlightRules }));
// The rules card's every figure is this fixture's, so an assertion on "08:30"
// below is an assertion that the card printed the database, not a constant.
const rules = {
  startDate: new Date("2027-01-30T00:00:00Z"), endDate: new Date("2027-02-06T00:00:00Z"),
  arrivalTarget: "08:00", arrivalCutoff: "08:30", returnCutoff: "11:00",
  inbound: { from: "10:30", to: "11:00", durationMinutes: 120, pickup: "Geneva Airport (GVA)" },
  outbound: { from: "04:15", to: "04:30", durationMinutes: 120, pickup: "Chalet" },
  hotels: [
    { id: "marriott", label: "Geneva Marriott (Friday night)", href: "https://www.marriott.com/en-us/hotels/gvamc-geneva-marriott-hotel/overview/", note: "free shuttle, under 5 min" },
    { id: "hilton", label: "Hilton Geneva (Friday night)", href: "https://www.hilton.com/en/hotels/gvacchi-hilton-geneva-hotel-and-conference-centre/", note: "free shuttle every ~20 min, 4:20 AM–11:40 PM" },
  ],
};
const recommendations = [
  { id: "sat", title: "Option 1 — Fly Friday night, arrive Saturday", intro: "Land by 8:30 AM.", outro: null, options: [
    { id: "ewr", carrier: "United", route: "EWR → GVA", departs: "5:30 PM Fri", arrives: "7:30 AM Sat", fitsShuttle: true, note: "Best buffer" },
    { id: "jfk", carrier: "SWISS LX23", route: "JFK → GVA", departs: "7:25 PM Fri", arrives: "9:15 AM Sat", fitsShuttle: false, note: "Lands after the 8:30 AM cutoff — separate transfer" },
  ] },
  { id: "home", title: "Return — Saturday 6 February", intro: "Book 11:00 AM or later.", outro: "Schedules change — confirm when booking.", options: [] },
];

type Guest = FlightTable[number];
type Leg = NonNullable<Guest["inbound"]>;
const names = ["Kristy Khoury", "Augustus Shewchuck", "Valeriia Stobolva", "Amelia Drake", "Wayne Martindale", "Olajuwon Jones", "Ted Delcima", "Kristy Kelly", "Kaise"];
const guest = (displayName: string, changes: Partial<Guest> = {}): Guest => ({
  id: displayName, firstName: displayName, lastName: "", displayName,
  inbound: null, outbound: null, status: "Not booked", arrivingFriday: false, arrivalMarker: null, ...changes,
});
const leg = (changes: Partial<Leg> = {}): Leg => ({
  id: "flight", direction: "INBOUND", airline: "United", flightNumber: "UA956", origin: "EWR", destination: "GVA",
  scheduledDeparture: new Date("2027-01-28T22:35:00Z"), scheduledArrival: new Date("2027-01-29T06:25:00Z"),
  departureLocal: "2027-01-28T17:35:00-05:00", arrivalLocal: "2027-01-29T07:25:00+01:00",
  terminal: null, source: "AGENT_EXTRACTION", confirmedAt: new Date("2026-09-20T12:00:00Z"),
  supersededById: null, confirmedByGuest: true, ...changes,
});
const outbound = () => leg({ id: "return", direction: "OUTBOUND", origin: "GVA", destination: "EWR",
  scheduledDeparture: new Date("2027-02-06T10:00:00Z"), scheduledArrival: new Date("2027-02-06T19:00:00Z"),
  departureLocal: "2027-02-06T11:00:00+01:00", arrivalLocal: "2027-02-06T14:00:00-05:00", source: "ORGANIZER",
});

function staticPage(flights: FlightTable) {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(<Flights {...{ loaderData: { flights, recommendations, rules } } as ComponentProps<typeof Flights>} />);
  return page;
}

let root: Root | undefined;
let container: HTMLDivElement;
let narrow = false;
const listeners = new Set<() => void>();
beforeEach(() => {
  getFlightTable.mockReset();
  getFlightRecommendations.mockReset();
  getFlightRecommendations.mockResolvedValue(recommendations);
  getFlightRules.mockReset();
  getFlightRules.mockResolvedValue(rules);
  narrow = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    media: query, matches: narrow,
    addEventListener: (_event: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_event: string, fn: () => void) => listeners.delete(fn),
  })));
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  expect(listeners.size).toBe(0);
  vi.unstubAllGlobals();
});
async function mount(flights: FlightTable) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<GroupFlightTable flights={flights} />));
  return container;
}
async function clickSort(page: HTMLElement, label: string) {
  const button = [...page.querySelectorAll("button")].find((node) => node.getAttribute("aria-label")?.startsWith(`Sort by ${label}`));
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

describe("Flights route", () => {
  it("returns the accepted query projection unchanged", async () => {
    const flights = names.map((name) => guest(name));
    getFlightTable.mockResolvedValue(flights);
    const result = await loader();
    expect(getFlightTable).toHaveBeenCalledExactlyOnceWith();
    expect(result.flights).toBe(flights);
  });

  it("renders the exact three booking cards and two hotel destinations without a write surface", () => {
    const page = staticPage([]);
    expect(page.querySelector("#flights-heading")?.textContent).toBe("Flights.");
    expect(page.querySelector("#flights-heading .text-accent")?.textContent).toBe(".");
    expect(page.querySelectorAll(".detail-grid > article")).toHaveLength(3);
    for (const text of ["08:30", "11:00", "Aim for 8:00 AM or earlier", "plan your own transfer", "Flights in the recommendations below", "under 5 min", "every ~20 min, 4:20 AM–11:40 PM"]) expect(page.textContent).toContain(text);
    expect([...page.querySelectorAll(".detail-grid a")].map((a) => a.getAttribute("href"))).toEqual([
      "https://www.marriott.com/en-us/hotels/gvamc-geneva-marriott-hotel/overview/",
      "https://www.hilton.com/en/hotels/gvacchi-hilton-geneva-hotel-and-conference-centre/",
    ]);
    expect(page.querySelectorAll("form, input, textarea, select")).toHaveLength(0);
  });

  it("renders the recommendations as the database's tables, verdict column included", () => {
    const page = staticPage([]);
    const tables = page.querySelectorAll(".flight-rec-table");
    expect(tables).toHaveLength(1); // a section with no flights is prose only
    expect([...tables[0]!.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["Flight", "Route", "Departs", "Arrives", "Group shuttle"]);
    const rows = [...tables[0]!.querySelectorAll("tbody tr")];
    expect(rows.map((row) => row.querySelector("th")?.textContent)).toEqual(["United", "SWISS LX23"]);
    expect(rows[0]?.querySelector(".flight-rec-verdict")?.textContent).toBe("Yes · Best buffer");
    expect(rows[1]?.querySelector(".flight-rec-verdict")?.textContent).toBe("No · Lands after the 8:30 AM cutoff — separate transfer");
    for (const text of ["Option 1 — Fly Friday night, arrive Saturday", "Return — Saturday 6 February", "Book 11:00 AM or later.", "Schedules change"]) expect(page.textContent).toContain(text);
  });
  it("keeps all nine guests, grouped headers and missing cells when no flights exist", () => {
    const page = staticPage(names.map((name) => guest(name)));
    expect(page.textContent).toContain("0 of 9 booked · 0 miss the shuttle");
    expect(page.textContent).toContain("No flights recorded yet");
    expect(page.querySelectorAll(".flight-table tbody tr")).toHaveLength(9);
    expect([...page.querySelectorAll(".flight-table tbody th")].map((node) => node.textContent)).toEqual(names);
    expect([...page.querySelectorAll(".flight-status")].map((node) => node.textContent)).toEqual(Array(9).fill("Not booked"));
    expect([...page.querySelectorAll(".flight-table tbody td")].filter((node) => node.textContent === "—")).toHaveLength(54);
    expect([...page.querySelectorAll('th[colspan="3"]')].map((node) => node.textContent)).toEqual(["Arriving", "Departing"]);
    expect(page.querySelectorAll(".flight-guest-card")).toHaveLength(0);
  });

  it("displays supplied statuses, Friday and per-leg provenance without deriving them again", () => {
    // Deliberately share timestamps across all statuses: the query's status must win.
    const statuses: Guest["status"][] = ["On the shuttle", "Tight", "Misses the shuttle", "Not booked"];
    const page = staticPage(statuses.map((status) => guest(status, { status, inbound: leg(), outbound: outbound(), arrivingFriday: true, arrivalMarker: "Arriving Friday" })));
    expect([...page.querySelectorAll(".flight-status")].map((node) => node.getAttribute("style"))).toEqual([
      "color:var(--accent)", "color:var(--warn)", "color:var(--danger)", "color:var(--text-faint)",
    ]);
    expect(page.querySelectorAll(".flight-friday")).toHaveLength(4);
    expect(page.textContent).not.toContain("from screenshot");
    expect(page.textContent).not.toContain("entered by organizer");
    expect(page.textContent).toContain("EWR → GVA");
    expect(page.textContent).toContain("Thu 28 Jan · 17:35");
    expect(page.textContent).toContain("Fri 29 Jan · 07:25");
    expect(page.textContent).toContain("Sat 6 Feb · 11:00");
    const link = page.querySelector<HTMLAnchorElement>("tbody th a")!;
    expect(new URL(link.href).searchParams.get("question")).toBe("When does On the shuttle land?");
    expect(page.textContent).toContain("4 of 4 booked · 1 miss the shuttle");
  });

  it("handles partial bookings and nullable flight details without inventing values", () => {
    const page = staticPage([guest("Partial", { inbound: leg({ airline: null, flightNumber: null, confirmedAt: null }) }), guest("Absent")]);
    expect(page.textContent).toContain("0 of 2 booked");
    expect(page.textContent).not.toContain("No flights recorded yet");
    // A leg with no airline or number still shows its route, and nothing else.
    expect(page.querySelector(".flight-route")?.textContent).toBe("EWR → GVA");
    expect(page.querySelector(".flight-provenance")).toBeNull();
    expect(page.querySelectorAll(".flight-friday")).toHaveLength(0);
    expect(page.textContent).not.toMatch(/undefined|null|Invalid Date/);
  });

  it("sorts arrivals chronologically with missing flights last in either direction", async () => {
    const page = await mount([guest("Missing"), guest("Later", { inbound: leg({ scheduledArrival: new Date("2027-01-30T07:00:00Z") }) }), guest("Earlier", { inbound: leg() })]);
    const order = () => [...page.querySelectorAll("tbody th a")].map((node) => node.textContent);
    expect(order()).toEqual(["Earlier", "Later", "Missing"]);
    expect(page.querySelector('[aria-sort="ascending"]')?.textContent).toContain("Lands GVA");
    await clickSort(page, "Lands GVA");
    expect(order()).toEqual(["Later", "Earlier", "Missing"]);
    expect(page.querySelector('[aria-sort="descending"]')?.textContent).toContain("Lands GVA");
  });

  it("switches to cards below 860px, retaining the same model and sorting state", async () => {
    const page = await mount([guest("Zoe"), guest("Amy")]);
    await clickSort(page, "Guest");
    expect([...page.querySelectorAll("tbody th a")].map((node) => node.textContent)).toEqual(["Amy", "Zoe"]);
    await act(async () => { narrow = true; listeners.forEach((fn) => fn()); });
    expect(window.matchMedia).toHaveBeenCalledWith("(width < 860px)");
    expect(page.querySelector("table")).toBeNull();
    expect([...page.querySelectorAll(".flight-guest-card h4 a")].map((node) => node.textContent)).toEqual(["Amy", "Zoe"]);
    expect(page.querySelectorAll(".flight-card-leg")).toHaveLength(4);
    expect(page.querySelectorAll(".flight-status")).toHaveLength(2);
    await clickSort(page, "Guest");
    expect([...page.querySelectorAll(".flight-guest-card h4 a")].map((node) => node.textContent)).toEqual(["Zoe", "Amy"]);
    await act(async () => { narrow = false; listeners.forEach((fn) => fn()); });
    expect(page.querySelectorAll(".flight-guest-card")).toHaveLength(0);
    expect([...page.querySelectorAll("tbody th a")].map((node) => node.textContent)).toEqual(["Zoe", "Amy"]);
  });
});
