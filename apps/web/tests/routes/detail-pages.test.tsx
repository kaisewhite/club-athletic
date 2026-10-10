import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadDatabase } from "../../src/lib/db/client.server";
import Shuttle, { loader as shuttleLoader } from "../../app/routes/shuttle";
import Chalet, { loader as chaletLoader } from "../../app/routes/chalet";
import Rooms, { loader as roomsLoader } from "../../app/routes/rooms";
import Spots, { loader as spotsLoader } from "../../app/routes/spots";
import Chef, { loader as chefLoader } from "../../app/routes/chef";
import Tasks, { loader as tasksLoader } from "../../app/routes/tasks";
import Links, { loader as linksLoader } from "../../app/routes/links";

const { findUniqueOrThrow } = vi.hoisted(() => ({ findUniqueOrThrow: vi.fn() }));
const { getEurUsdRate } = vi.hoisted(() => ({ getEurUsdRate: vi.fn() }));
vi.mock("../../src/lib/db/client.server", () => ({
  withReadDatabase: (read: (db: ReadDatabase) => Promise<unknown>) => read({ trip: { findUniqueOrThrow } }),
}));
vi.mock("../../app/lib/exchange-rates.server", () => ({ getEurUsdRate }));

function renderPage<P extends { loaderData: unknown }>(Component: (props: P) => ReactNode, data: P["loaderData"]) {
  const node = document.createElement("div");
  // These pure route components only consume loaderData; router metadata is unused.
  node.innerHTML = renderToStaticMarkup(Component({ loaderData: data } as P));
  expect(node.querySelectorAll("form, input:not([disabled]), button:not(.bm-expand), select, textarea")).toHaveLength(0);
  // The accent-dot convention is the app's own page headings. The bedroom map
  // sheet is the owner's authored artwork, embedded as-is, and keeps its own.
  for (const heading of [...node.querySelectorAll("h2")].filter((h) => !h.closest(".bm-sheet"))) {
    expect(heading.querySelector(".text-accent")?.textContent).toBe(".");
  }
  expect(findUniqueOrThrow).toHaveBeenCalledTimes(1);
  expect(findUniqueOrThrow.mock.calls[0]?.[0].where).toEqual({ seedKey: "meribel-2027" });
  return node;
}

const names = ["Kaise", "Amelia Drake", "Kristy Kelly", "Kristy Khoury", "Valeriia Stobolva", "Augustus Shewchuck", "Wayne Martindale", "Olajuwon Jones", "Ted Delcima"];
const room = (number: number, type: string, occupants: (string | null)[]) => ({
  id: `room-${number}`, name: `Bedroom ${number}`, shortName: `Bedroom ${number}`, type, pricePerPerson: ({ 4: 1810, 5: 1690, 8: 1860 } as Record<number, number>)[number] ?? null,
  description: ({ 4: "Women's quad bunk — shared balcony, shared shower", 5: "Men's bunk cabin — shared shower", 8: "Women's quad bunk — en-suite bathroom" } as Record<number, string>)[number] ?? null,
  spots: occupants.map((occupant, index) => ({ id: `${number}-${index}`, index: index + 1, priceOverride: null,
    status: occupant === null ? "NOT_OFFERED" : occupant ? "ASSIGNED" : "AVAILABLE",
    guest: occupant ? { id: occupant, displayName: occupant } : null,
  })),
});
const floors = [
  { id: "upper", name: "Upper floor", code: "R11 / F21", rooms: [room(1, "MASTER_DOUBLE", [names[0]!, null])] },
  { id: "middle", name: "Middle floor", code: "R10 / F21", rooms: [
    room(2, "DOUBLE", names.slice(1, 3)), room(3, "TWIN", names.slice(3, 5)),
    room(4, "QUAD_BUNK", ["", "", "", ""]), room(5, "BUNK_CABIN", ["", ""]),
  ] },
  { id: "lower", name: "Lower floor", code: "R9 / F12", rooms: [
    room(6, "DOUBLE", names.slice(5, 7)), room(7, "DOUBLE", names.slice(7, 9)), room(8, "QUAD_BUNK", ["", "", "", ""]),
  ] },
];
const pricing = { minPerPerson: 1690, maxPerPerson: 1860, currency: "EUR", description: "per person, all-in",
  breakdown: { taxes: 33.6, shuttle: 178, incidentals: 100, chef: 408 },
  note: "All-in = room rate + taxes + shuttle + incidentals + chef",
  includes: ["Your bed for 7 nights", "Private chef — 6 breakfasts, 5 dinners", "Group shuttle GVA ↔ chalet", "Taxes, incidentals and tips"],
  excludes: ["flights", "ski pass", "rentals", "nights out"],
};

beforeEach(() => { findUniqueOrThrow.mockReset(); getEurUsdRate.mockReset(); getEurUsdRate.mockResolvedValue({ rate: 1.2, date: "2026-10-01" }); });

describe("database-backed read-only detail pages", () => {
  it("renders eight rooms, nine named guests, ten available beds and one not-offered bed", async () => {
    findUniqueOrThrow.mockResolvedValue({ property: { floors, sleepsMax: 20 }, _count: { guests: 9 } });
    const page = renderPage(Rooms, await roomsLoader());
    expect(page.textContent).toContain("9 confirmed · 10 spots open · sleeps up to 20");
    expect(page.querySelectorAll(".room-card")).toHaveLength(8);
    expect(page.querySelectorAll(".spot-available")).toHaveLength(10);
    expect(page.querySelectorAll(".spot-not-offered")).toHaveLength(1);
    expect(page.querySelector(".room-card")?.textContent).toContain("Spot 2not offered");
    expect(page.querySelectorAll(".has-open-spots")).toHaveLength(3);
    for (const name of names) expect(page.textContent).toContain(name);
    // The bedroom map is the owner's own sheet, embedded verbatim: the defs
    // sheet, three floor drawings and the leader-line overlay, every bedroom
    // called out, and the mapping table.
    const sheet = page.querySelector(".bm-sheet")!;
    expect(page.querySelector<HTMLButtonElement>(".bm-expand")?.getAttribute("aria-label")).toBe("Enlarge bedroom map");
    expect(page.querySelector(".bm-dialog")).toBeNull();
    expect(sheet.querySelectorAll("svg")).toHaveLength(5);
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) expect(sheet.textContent).toContain(`Bedroom ${n}`);
    expect(page.querySelectorAll(".bm-room-table tbody tr")).toHaveLength(8);
    expect(sheet.innerHTML).not.toMatch(/sc-|\{\{/);
  });
  it("links guest names to Instagram on rooms and chef pages", async () => {
    const roomFloors = floors.map((floor) => ({ ...floor, rooms: floor.rooms.map((item) => item.name === "Bedroom 4"
      ? room(4, "QUAD_BUNK", ["Christine Calvo", "Christie Navarre", "", ""])
      : item) }));
    findUniqueOrThrow.mockResolvedValue({ property: { floors: roomFloors, sleepsMax: 20 }, _count: { guests: 12 } });
    const roomsPage = renderPage(Rooms, await roomsLoader());
    for (const [name, handle] of [["Christie Navarre", "xtnavarre"], ["Christine Calvo", "christinecalvo_"], ["Valeriia Stobolva", "valeriiastolbova"], ["Wayne Martindale", "_wayne.em_"]] as const) {
      const link = [...roomsPage.querySelectorAll<HTMLAnchorElement>(".spot-assigned a")].find((anchor) => anchor.querySelector("span")?.textContent === name);
      expect(link?.getAttribute("href")).toBe(`https://www.instagram.com/${handle}`);
      expect(link?.target).toBe("_blank");
      expect(link?.rel).toContain("noopener");
    }

    findUniqueOrThrow.mockReset();
    findUniqueOrThrow.mockResolvedValue({ chefBreakfastCount: 6, chefDinnerCount: 5, scheduleDays: [], guests: [
      { id: "christie", displayName: "Christie Navarre", dietaryNotes: null },
      { id: "christine", displayName: "Christine Calvo", dietaryNotes: null },
      { id: "valeriia", displayName: "Valeriia Stobolva", dietaryNotes: null },
      { id: "wayne", displayName: "Wayne Martindale", dietaryNotes: null },
    ] });
    const chefPage = renderPage(Chef, await chefLoader());
    for (const name of ["Christie Navarre", "Christine Calvo", "Valeriia Stobolva", "Wayne Martindale"]) {
      const link = [...chefPage.querySelectorAll<HTMLAnchorElement>('table[aria-label="Guest dietary requirements"] th a')].find((anchor) => anchor.textContent === name);
      expect(link?.getAttribute("href")).toMatch(/^https:\/\/www\.instagram\.com\//);
    }
  });
  it("renders Trip pricing, inclusions and organizer room prices and descriptions", async () => {
    findUniqueOrThrow.mockResolvedValue({ pricing, property: { floors: floors.map((floor) => ({ ...floor,
      rooms: floor.rooms.filter((room) => room.spots.some((spot) => spot.status === "AVAILABLE"))
        .map((room) => ({ ...room, spots: room.spots.filter((spot) => spot.status === "AVAILABLE") })),
    })) } });
    const page = renderPage(Spots, await spotsLoader());
    expect(page.querySelector(".spots-heading")?.textContent).toBe("Spots still open 10");
    expect(page.querySelector(".spots-count")?.textContent).toBe("10");
    expect(page.textContent).toContain("€1,690–€1,860");
    expect([...page.querySelectorAll(".spots-currency dt")].map((node) => node.textContent)).toEqual(["EUR · per person, all-in", "USD estimate · per person, all-in"]);
    expect(page.querySelector(".spots-price-usd")?.textContent).toContain("≈ $2,028–$2,232");
    expect(page.querySelector(".spots-rate-date")?.textContent).toContain("ECB rate · Oct 1, 2026");
    for (const item of [...pricing.includes, ...pricing.excludes]) expect(page.textContent).toContain(item);
    expect([...page.querySelectorAll(".open-room-count")].map((node) => node.textContent)).toEqual(["4", "2", "4"]);
    expect(page.querySelectorAll(".open-room-price")).toHaveLength(3);
    expect([...page.querySelectorAll(".open-room-price")].map((note) => note.textContent)).toEqual(["€1,810 per person", "€1,690 per person", "€1,860 per person"]);
    for (const description of ["Women's quad bunk — shared balcony, shared shower", "Men's bunk cabin — shared shower", "Women's quad bunk — en-suite bathroom"]) expect(page.textContent).toContain(description);
    const breakdown = page.querySelector(".price-breakdown");
    expect(breakdown?.getAttribute("aria-label")).toBe("How the all-in price is built");
    expect([...breakdown!.querySelectorAll("dt")].map((node) => node.textContent)).toEqual(["Room rate", "Taxes", "Shuttle", "Incidentals", "Chef"]);
    expect([...breakdown!.querySelectorAll("dd")].map((node) => node.textContent)).toEqual(["varies by room", "€33.60", "€178", "€100", "€408"]);
  });
  it("keeps EUR pricing visible when the daily USD rate is unavailable", async () => {
    getEurUsdRate.mockResolvedValue(null);
    findUniqueOrThrow.mockResolvedValue({ pricing, property: { floors: [] } });
    const page = renderPage(Spots, await spotsLoader());
    expect(page.querySelector(".spots-price")?.textContent).toBe("€1,690–€1,860");
    expect(page.querySelector(".spots-price-usd")?.textContent).toBe("Temporarily unavailable");
  });
  it("renders both shuttle windows in local time and editable driver and meeting notes", async () => {
    findUniqueOrThrow.mockResolvedValue({ shuttles: [
      { id: "out", direction: "INBOUND", seats: 49, durationMinutes: 120, pickupLocation: "Geneva Airport (GVA)", departWindowStart: new Date("2027-01-30T09:30:00Z"), departWindowEnd: new Date("2027-01-30T10:00:00Z"), notes: "Meeting point: arrivals door 5.", driverContact: "+41 123" },
      { id: "back", direction: "OUTBOUND", seats: 49, durationMinutes: 120, pickupLocation: "Falcon Lodge F", departWindowStart: new Date("2027-02-06T03:15:00Z"), departWindowEnd: new Date("2027-02-06T03:30:00Z"), notes: "Meeting point/driver TBA.", driverContact: null },
    ] });
    const page = renderPage(Shuttle, await shuttleLoader());
    for (const text of ["49-seat", "2 hours", "10:30 and 11:00", "04:15 and 04:30", "Saturday 30 Jan", "Saturday 6 Feb", "arrivals door 5", "+41 123"]) expect(page.textContent).toContain(text);
    expect(page.querySelectorAll(".shuttle-outbound")).toHaveLength(1);
  });
  it("renders property JSON amenities, real facts and listing destinations without a photo section", async () => {
    const listings = [{ id: "whole", label: "Falcon Lodge F — Ski in Luxury", href: "https://www.skiinluxury.com/france/meribel/falcon-lodge-f", note: "The whole chalet" },
      { id: "f12", label: "Apartment F12 — Ski in Luxury", href: "https://www.skiinluxury.com/france/meribel/falcon-lodge-f12", note: "Sleeps 4–8" }];
    findUniqueOrThrow.mockResolvedValue({ property: { name: "Falcon Lodge F", address: "269 Rte de l'Altiport, 73550 Les Allues, France", mapsUrl: "https://maps.google.com/?q=Falcon", sizeSquareMeters: 326, floorCount: 3, bedroomCount: 8, sleepsMin: 10, sleepsMax: 20,
      amenities: { private: ["Private outdoor hot tub", "Ski lockers with boot warmers"], shared: ["Indoor pool, hammam, sauna, massage rooms"] }, photos: [], externalListingUrls: [],
      description: "Central Méribel. Most rooms en-suite with balcony/terrace; some bunk rooms share a shower room, may lack balcony.",
    }, links: listings });
    const page = renderPage(Chalet, await chaletLoader());
    for (const text of ["269 Rte de l'Altiport", "Private outdoor hot tub", "hammam", "share a shower room"]) expect(page.textContent).toContain(text);
    // The facts strip: size, levels, bedrooms, sleeps — from the property row.
    expect([...page.querySelectorAll(".stat-value")].map((node) => node.textContent)).toEqual(["326 m²", "3", "8", "10–20"]);
    expect(page.querySelector("img")).toBeNull();
    expect([...page.querySelectorAll(".chalet-listings .link-row")].map((link) => link.getAttribute("href"))).toEqual(listings.map((l) => l.href));
    expect(page.querySelectorAll(".stat")).toHaveLength(4);
  });
  it("renders chef milestones, all eight schedule days and each guest's dietary notes", async () => {
    const days = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dow, index) => ({
      id: String(index), dow, dayNumber: index < 2 ? 30 + index : index - 1,
      date: new Date(Date.UTC(2027, 0, 30 + index)), breakfast: index > 0 && index < 7 ? "CHEF" : "NONE",
      dinner: index < 5 ? "CHEF" : index < 7 ? "OWN" : "NONE",
    }));
    findUniqueOrThrow.mockResolvedValue({ chefBreakfastCount: 6, chefDinnerCount: 5, scheduleDays: days, guests: [{ id: "kaise", displayName: "Kaise", dietaryNotes: "No peanuts" }, { id: "amelia", displayName: "Amelia Drake", dietaryNotes: null }] });
    const page = renderPage(Chef, await chefLoader());
    for (const text of ["6 breakfasts and 5 dinners", "Dinner, Sat 30", "Wed 3 Feb", "Fri 5 Feb", "No peanuts", "Add allergies or dietary needs", "Add allergies or dietary needs in the table below before the trip."]) expect(page.textContent).toContain(text);
    const rows = page.querySelectorAll('table[aria-label="Chef meal schedule"] tbody tr');
    expect(rows).toHaveLength(8);
    // A dinner the chef is not cooking is a dash, whatever the reason.
    expect(rows[5]?.textContent).not.toContain("On your own");
    expect(rows[5]?.querySelector('td[data-meal="Dinner"]')?.textContent).toBe("—");
  });
  it("renders flight and payment status in the shared table without a Details column", async () => {
    const storage = vi.spyOn(Storage.prototype, "getItem");
    try {
      findUniqueOrThrow.mockResolvedValue({
        startDate: new Date("2027-01-30T00:00:00Z"), endDate: new Date("2027-02-06T00:00:00Z"), timezone: "Europe/Paris",
        flightArrivalTarget: "08:00", flightArrivalCutoff: "08:30", flightReturnCutoff: "11:00",
        guests: names.map((displayName) => ({ id: displayName, firstName: displayName, lastName: "", displayName,
          tasks: [{ done: displayName === "Amelia Drake" }], flights: [],
        })),
      });
      const page = renderPage(Tasks, await tasksLoader());
      expect(page.textContent).toContain("1 paid");
      expect(page.querySelectorAll('table[aria-label="Guest flight and payment status"] tbody tr')).toHaveLength(9);
      expect(page.querySelectorAll('td[data-label="Flight"] .task-status[data-done="false"]')).toHaveLength(9);
      expect(page.querySelector('[data-label="Payment"] .task-status[data-done="true"]')?.textContent).toBe("Paid");
      expect([...page.querySelectorAll("thead th")].map((node) => node.textContent)).toEqual(["Guest", "Flight", "Payment"]);
      expect(page.textContent).not.toContain("Details");
      expect(page.querySelector('[data-label="Payment"] .task-status[data-done="false"]')?.textContent).toBe("—");
      expect(page.querySelector('table[aria-label="Guest flight and payment status"] tbody th a')?.getAttribute("aria-label")).toBe("Kaise on Instagram");
      expect(storage).not.toHaveBeenCalled();
    } finally { storage.mockRestore(); }
  });
  it("preserves all nine link destinations and the six source groups in order", async () => {
    const links = [
      ["Chalet", "Falcon Lodge F — Ski in Luxury", "https://www.skiinluxury.com/france/meribel/falcon-lodge-f"],
      ["Chalet", "Chalet F — Alpine Resorts", "https://www.alpine-resorts.fr/en_US/summer/resort/falcon/hebergement/chalet-f"],
      ["Ski pass", "Méribel / 3 Vallées ski pass", "https://www.skipass-meribel.com/en/"],
      ["Ski pass", "Epic Pass — Les 3 Vallées access", "https://www.epicpass.com/regions/europe/france/les-3-vallees.aspx"],
      ["Mountain", "Méribel webcams", "https://www.meribel.net/informations-pratiques/webcams/"],
      ["Wellness", "Spa Falcon", "https://www.alpine-resorts.fr/en_US/destination/alpes-fr/meribel/spa/spa-falcon"],
      ["Hotels", "Geneva Marriott (Friday night)", "https://www.marriott.com/en-us/hotels/gvamc-geneva-marriott-hotel/overview/"],
      ["Hotels", "Hilton Geneva (Friday night)", "https://www.hilton.com/en/hotels/gvacchi-hilton-geneva-hotel-and-conference-centre/"],
    ].map(([group, label, href], index) => ({ id: String(index), group, label, href }));
    findUniqueOrThrow.mockResolvedValue({ links });
    const page = renderPage(Links, await linksLoader());
    const anchors = [...page.querySelectorAll<HTMLAnchorElement>('.link-row[data-group]:not([data-group="Guests"])')];
    expect(anchors.map((link) => link.getAttribute("href"))).toEqual(links.map((link) => link.href));
    expect(anchors.map((link) => link.getAttribute("data-group"))).toEqual(links.map((link) => link.group));
    for (const link of anchors) { expect(link.target).toBe("_blank"); expect(link.rel).toContain("noopener"); }
    const guestRows = [...page.querySelectorAll<HTMLAnchorElement>('.link-row[data-group="Guests"]')];
    expect(guestRows).toHaveLength(11);
    expect(guestRows[0]?.querySelector(".guest-instagram-label")?.textContent).toContain("Kaise");
    expect(guestRows[0]?.getAttribute("href")).toBe("https://www.instagram.com/kaise.white");
    expect(guestRows.every((link) => link.querySelector(".guest-instagram-arrow"))).toBe(true);
  });
});
