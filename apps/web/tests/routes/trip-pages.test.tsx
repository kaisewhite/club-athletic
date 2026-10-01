import { act } from "react";
import { Window } from "happy-dom";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../../app/components/app-shell";
import { loader as overviewLoader } from "../../app/routes/overview";
import { loader as faqLoader } from "../../app/routes/faq";
import { loader as scheduleLoader } from "../../app/routes/schedule";

const queries = vi.hoisted(() => ({ getTripOverview: vi.fn(), getSchedule: vi.fn() }));
vi.mock("@/lib/db/repository.server", () => queries);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

describe("read-only trip loaders", () => {
  it("projects FAQ answers separately from the concise homepage week ticker", async () => {
    queries.getTripOverview.mockResolvedValue({
      destination: "Test resort, Test country", resort: "Test region",
      startDate: new Date("2028-02-12T00:00:00Z"), endDate: new Date("2028-02-19T00:00:00Z"),
      timezone: "Europe/Paris", currency: "EUR", pricing: { minPerPerson: 2100, maxPerPerson: 2300 },
      openCount: 4, guestCount: 13, capacity: 24, chefBreakfastCount: 3, chefDinnerCount: 2,
      flightArrivalCutoff: "07:45", flightReturnCutoff: "12:30",
      property: { name: "Test lodge", address: "123 Test road", mapsUrl: "https://maps.google.com/?q=test", description: "~350 m from slopes" },
      shuttles: [
        { direction: "INBOUND", departWindowStart: new Date("2028-02-12T08:15:00Z"), departWindowEnd: new Date("2028-02-12T08:45:00Z") },
        { direction: "OUTBOUND", departWindowStart: new Date("2028-02-19T05:20:00Z") },
      ],
    });
    queries.getSchedule.mockResolvedValue([
      { id: "arrival", date: new Date("2028-02-12T00:00:00Z"), dow: "Sat", dayNumber: 12, eventTitle: "Changed arrival", breakfast: "NONE", dinner: "CHEF" },
      { id: "middle", date: new Date("2028-02-13T00:00:00Z"), dow: "Sun", dayNumber: 13, eventTitle: "Changed venue", breakfast: "CHEF", dinner: "OWN" },
      { id: "departure", date: new Date("2028-02-19T00:00:00Z"), dow: "Sat", dayNumber: 19, eventTitle: "Changed departure", breakfast: "NONE", dinner: "NONE" },
    ]);
    const result = await overviewLoader();
    const faq = await faqLoader();
    // FAQ copy is static, the answers are not: every value above is this mock's.
    expect(faq.tiles.map((tile) => tile.question)).toEqual([
      "When is the trip?", "Where are we staying?", "What time does the bus leave Geneva?",
      "What time do I need to land?", "How many beds are still open?", "How much is a bunk?",
      "How many meals does the chef cook?", "What time is the bus back to the airport?", "How many people are coming?",
    ]);
    expect(faq.tiles[0]?.sub).toMatch(/^\d+ days until the trip$/);
    expect(faq.tiles[0]?.lead).toBe("Sat 12 Feb → Sat 19 Feb 2028");
    expect(faq.tiles[1]?.lead).toBe("Test region, Test country");
    expect(faq.tiles[1]?.sub).toBe("");
    expect(faq.tiles[4]?.sub).toContain("€2,100");
    expect(faq.tiles[1]?.lead).not.toContain("Test lodge");
    expect(result.week).toHaveLength(3);
    expect(result.week.map((day) => day.event)).toEqual(["Changed arrival", "Changed venue", "Changed departure"]);
    expect(result.week[1]).toEqual({ id: "middle", dow: "Sun", number: 13, event: "Changed venue" });
    expect(await scheduleLoader()).toEqual({ schedule: await queries.getSchedule() });
  });
});

/** Evaluate the shell's own media query the way a browser would, at `width`. */
function matchesAt(query: string, width: number) {
  const probe = new Window({ innerWidth: width, innerHeight: 900 });
  const matches = probe.matchMedia(query).matches;
  void probe.happyDOM.close();
  return matches;
}

it("hydrates the wide SSR shell on a narrow viewport, then switches at exactly 860px", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  // The seam is the media query the stylesheets switch on, not `innerWidth`
  // (which counts a classic scrollbar and so disagrees with the CSS by ~15px).
  // happy-dom never fires `change`, so the notification is stubbed while
  // `matches` still comes from happy-dom's own evaluation of the query.
  let width = 859;
  const listeners = new Set<() => void>();
  const seamQueries: string[] = [];
  vi.stubGlobal("matchMedia", vi.fn((query: string) => {
    seamQueries.push(query);
    return {
      media: query, matches: matchesAt(query, width),
      addEventListener: (_event: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_event: string, fn: () => void) => listeners.delete(fn),
    };
  }));
  const resizeTo = async (next: number) => {
    width = next;
    await act(async () => { for (const notify of [...listeners]) notify(); });
  };
  const element = <MemoryRouter initialEntries={["/schedule"]}><AppShell daysUntil={126} /></MemoryRouter>;
  const container = document.createElement("div");
  document.body.append(container);
  container.innerHTML = renderToString(element);
  expect(container.querySelector(".sidebar")).not.toBeNull();
  expect(container.textContent).not.toContain("30 Jan – 6 Feb 2027");
  const hydrationErrors: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => { root = hydrateRoot(container, element, { onRecoverableError: (error) => hydrationErrors.push(error) }); });
    expect(hydrationErrors).toEqual([]);
    expect(container.querySelector(".sidebar")).toBeNull();
    expect(container.querySelector(".mobile-header")?.textContent).not.toContain("days");
    expect(container.querySelector(".mobile-nav-toggle")?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => container.querySelector<HTMLButtonElement>(".mobile-nav-toggle")!.click());
    expect(container.querySelector('.mobile-drawer .side-item.active')?.textContent).toBe("Schedule");
    expect(container.querySelectorAll(".mobile-drawer nav a")).toHaveLength(11);
    // One seam, subscribed to the query rather than to `resize`.
    expect(seamQueries.length).toBeGreaterThan(0);
    expect([...new Set(seamQueries)]).toEqual(["(width < 860px)"]);
    expect(listeners.size).toBe(1);
    await resizeTo(860);
    expect(container.querySelector(".sidebar")).not.toBeNull();
    expect(container.querySelector(".mobile-header")).toBeNull();
    expect(container.querySelector(".side-item.active")?.textContent).toBe("Schedule");
    expect(container.querySelector(".new-chat")?.hasAttribute("disabled")).toBe(false);
    // …and back: 859 is mobile again, so the seam is the same width both ways.
    await resizeTo(859);
    expect(container.querySelector(".sidebar")).toBeNull();
    expect(container.querySelector(".mobile-header")).not.toBeNull();
    const brand = container.querySelector<HTMLAnchorElement>(".mobile-brand");
    expect(brand?.getAttribute("href")).toBe("/");
    await act(async () => brand?.click());
    expect(container.querySelector(".home-route")).not.toBeNull();
  } finally {
    await act(async () => { root?.unmount(); });
    expect(listeners.size).toBe(0);
  }
});
