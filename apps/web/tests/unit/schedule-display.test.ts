import { describe, expect, it } from "vitest";
import { dayEntries } from "../../app/lib/schedule-display";

// Owner, 2026-09-28: "if there's not an event for that day, stop adding it to the
// schedule… There's no need to add dinner when there is no dinner." A day is a
// list of commitments, so anything that is not happening contributes no row.
const day = (over: Partial<Parameters<typeof dayEntries>[0]> = {}) => dayEntries({
  id: "d", eventTitle: "Le Cap Horn, Courchevel 1850", isOpen: false,
  breakfast: "CHEF", dinner: "CHEF", breakfastAt: "07:00", dinnerAt: "19:30", eventAt: null,
  ...over,
});
const shape = (over?: Partial<Parameters<typeof dayEntries>[0]>) =>
  day(over).map((entry) => [entry.time ?? "TBD", entry.title]);

describe("a schedule day lists only what happens on it", () => {
  it("renders a full day as breakfast, event, dinner in that order", () => {
    expect(shape()).toEqual([
      ["07:00", "Breakfast"], ["TBD", "Le Cap Horn, Courchevel 1850"], ["19:30", "Dinner"],
    ]);
  });

  it("drops a meal the chef is not cooking rather than printing an empty row", () => {
    // NONE and OWN both mean the trip is not serving it. Which of the two it is
    // belongs on the chef page, which already lists every day's meals.
    expect(shape({ breakfast: "NONE", breakfastAt: null })).toEqual([
      ["TBD", "Le Cap Horn, Courchevel 1850"], ["19:30", "Dinner"],
    ]);
    expect(shape({ dinner: "OWN", dinnerAt: null })).toEqual([
      ["07:00", "Breakfast"], ["TBD", "Le Cap Horn, Courchevel 1850"],
    ]);
  });

  it("drops the event row on an open day, because an open day has no event", () => {
    expect(shape({ isOpen: true, eventTitle: "Open — last ski day" })).toEqual([
      ["07:00", "Breakfast"], ["19:30", "Dinner"],
    ]);
  });

  it("leaves departure day with nothing but the departure", () => {
    expect(shape({
      eventTitle: "Departure — shuttle to GVA", eventAt: "04:15",
      breakfast: "NONE", breakfastAt: null, dinner: "NONE", dinnerAt: null,
    })).toEqual([["04:15", "Departure — shuttle to GVA"]]);
  });

  it("keeps the order fixed even when a clock time would sort differently", () => {
    expect(shape({ eventAt: "03:00" }).map(([, title]) => title)).toEqual([
      "Breakfast", "Le Cap Horn, Courchevel 1850", "Dinner",
    ]);
  });

  it("still says TBD for a chef sitting whose time the organizer has cleared", () => {
    // A row with no time is a real commitment awaiting a time — that is what TBD
    // means. A meal that is not served has no row to put a placeholder in.
    expect(shape({ breakfastAt: null })).toEqual([
      ["TBD", "Breakfast"], ["TBD", "Le Cap Horn, Courchevel 1850"], ["19:30", "Dinner"],
    ]);
  });

  it("yields an empty list for an open day with no chef meals, inventing nothing", () => {
    expect(day({ isOpen: true, breakfast: "OWN", breakfastAt: null, dinner: "OWN", dinnerAt: null })).toEqual([]);
  });
});
