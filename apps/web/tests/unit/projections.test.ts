import { getTripPricing } from "../../src/lib/db/projections";
import { describe, expect, it } from "vitest";
import { countOpenSpots, summarizeTasks } from "../../src/lib/db/projections";

describe("derived section counts", () => {
  it("counts only AVAILABLE, never ASSIGNED or NOT_OFFERED", () => {
    expect(countOpenSpots([
      ...Array.from({ length: 10 }, () => ({ status: "AVAILABLE" as const })),
      ...Array.from({ length: 9 }, () => ({ status: "ASSIGNED" as const })),
      { status: "NOT_OFFERED" },
    ])).toBe(10);
  });
  it("sums done and total tasks independently", () => {
    expect(summarizeTasks([{ id: "guest", tasks: [{ done: true }, { done: false }, { done: true }] }]))
      .toMatchObject({ doneCount: 2, totalTasks: 3, guests: [{ id: "guest", doneCount: 2, totalTasks: 3 }] });
  });
  it("returns zero for an empty result", () => {
    expect(countOpenSpots([])).toBe(0);
    expect(summarizeTasks([])).toEqual({ guests: [], doneCount: 0, totalTasks: 0 });
  });
});


describe("Trip pricing JSON", () => {
  const value = { minPerPerson: 1690, maxPerPerson: 1860, currency: "EUR", description: "per person, all-in", breakdown: { taxes: 33.6, shuttle: 178, incidentals: 100, chef: 408 }, note: "All-in = room rate + taxes + shuttle + incidentals + chef", includes: ["Bed", "Chef"], excludes: ["Flights"] };
  it("preserves every pricing field and formats the seeded range", () => {
    expect(getTripPricing(value)).toEqual({ ...value, rangeLabel: "€1,690–€1,860" });
  });
  it("uses changed database prices, currency, description and lists", () => {
    const changed = { minPerPerson: 2000, maxPerPerson: 2500, currency: "USD", description: "Updated", includes: ["Transfer"], excludes: [] };
    expect(getTripPricing(changed)).toEqual({ ...changed, rangeLabel: "US$2,000–US$2,500" });
  });
  it("accepts older pricing rows without breakdown or note", () => {
    const { breakdown: _breakdown, note: _note, ...older } = value;
    expect(getTripPricing(older)).toMatchObject({ rangeLabel: "€1,690–€1,860" });
  });
  it("rejects missing or invalid fields rather than inventing prices", () => {
    for (const invalid of [null, {}, { ...value, minPerPerson: null }, { ...value, maxPerPerson: 1 }, { ...value, includes: "Bed" }, { ...value, currency: "eur" }]) {
      expect(() => getTripPricing(invalid)).toThrow();
    }
  });
});
