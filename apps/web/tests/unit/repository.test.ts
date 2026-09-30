import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadDatabase } from "../../src/lib/db/client.server";

const { findUniqueOrThrow } = vi.hoisted(() => ({ findUniqueOrThrow: vi.fn() }));
vi.mock("../../src/lib/db/client.server", () => ({
  withReadDatabase: (read: (db: ReadDatabase) => Promise<unknown>) => read({ trip: { findUniqueOrThrow } }),
}));

import {
  getChefSummary, getFlightTable, getGuestTasks, getLinks, getOpenSpots,
  getProperty, getRoomsByFloor, getSchedule, getShuttles, getTripOverview,
} from "../../src/lib/db/repository.server";

const spot = (id: string, status: "AVAILABLE" | "ASSIGNED" | "NOT_OFFERED") => ({ id, status, priceOverride: null });
const pricing = {
  minPerPerson: 1690, maxPerPerson: 1860, currency: "EUR",
  description: "per person, all-in",
  breakdown: { taxes: 33.6, shuttle: 178, incidentals: 100, chef: 408 },
  note: "All-in = room rate + taxes + shuttle + incidentals + chef",
  includes: ["Your bed for 7 nights", "Private chef — 6 breakfasts, 5 dinners", "Group shuttle GVA ↔ chalet", "Taxes, incidentals and tips"],
  excludes: ["flights", "ski pass", "rentals", "nights out"],
};
const floors = [{ id: "floor", name: "Middle", rooms: [
  { id: "open", name: "Quad", pricePerPerson: null, spots: [spot("a", "AVAILABLE"), spot("b", "AVAILABLE"), spot("c", "NOT_OFFERED")] },
  { id: "full", name: "Double", pricePerPerson: null, spots: [spot("d", "ASSIGNED")] },
] }];

beforeEach(() => {
  // Returning the mock would register it as a Vitest cleanup callback.
  findUniqueOrThrow.mockReset();
});

describe("read section repository", () => {
  it("derives the seed's 9 guests / 10 available beds / capacity 20 across 3 floors and 8 rooms", async () => {
    const seededFloors = [
      { id: "upper", name: "Upper", rooms: [{ id: "1", spots: [spot("1", "ASSIGNED"), spot("2", "NOT_OFFERED")] }] },
      { id: "middle", name: "Middle", rooms: [
        { id: "2", spots: [spot("3", "ASSIGNED"), spot("4", "ASSIGNED")] },
        { id: "3", spots: [spot("5", "ASSIGNED"), spot("6", "ASSIGNED")] },
        { id: "4", spots: [7, 8, 9, 10].map((id) => spot(String(id), "AVAILABLE")) },
        { id: "5", spots: [11, 12].map((id) => spot(String(id), "AVAILABLE")) },
      ] },
      { id: "lower", name: "Lower", rooms: [
        { id: "6", spots: [spot("13", "ASSIGNED"), spot("14", "ASSIGNED")] },
        { id: "7", spots: [spot("15", "ASSIGNED"), spot("16", "ASSIGNED")] },
        { id: "8", spots: [17, 18, 19, 20].map((id) => spot(String(id), "AVAILABLE")) },
      ] },
    ];
    findUniqueOrThrow.mockResolvedValue({ property: { sleepsMax: 20, floors: seededFloors }, _count: { guests: 9 } });
    const overview = await getTripOverview();
    expect(overview).toMatchObject({ openCount: 10, guestCount: 9, capacity: 20 });
    expect(overview.openRooms.map((room) => room.openCount)).toEqual([4, 2, 4]);
    expect(overview.property.floors).toHaveLength(3);
    expect(overview.property.floors.reduce((sum, floor) => sum + floor.rooms.length, 0)).toBe(8);
    expect(findUniqueOrThrow).toHaveBeenCalledTimes(1);
  });
  it("derives available beds and open rooms while preserving property capacity", async () => {
    findUniqueOrThrow.mockResolvedValue({ id: "trip", property: { sleepsMax: 20, floors }, _count: { guests: 9 }, shuttles: [] });
    const result = await getTripOverview();
    expect(result).toMatchObject({ guestCount: 9, openCount: 2, capacity: 20 });
    expect(result.openRooms).toHaveLength(1);
    expect(result.openRooms[0]).toMatchObject({ id: "open", name: "Quad", floorName: "Middle", openCount: 2 });
    expect(findUniqueOrThrow).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: { seedKey: "meribel-2027" },
      include: expect.objectContaining({ _count: { select: { guests: { where: { status: "CONFIRMED" } } } } }),
    }));
  });
  it("returns typed room details and per-room open counts in one call", async () => {
    findUniqueOrThrow.mockResolvedValue({ property: { floors, sleepsMax: 20 }, _count: { guests: 9 } });
    const result = await getRoomsByFloor();
    expect(result.floors[0]?.rooms[0]).toMatchObject({ name: "Quad", openCount: 2 });
    expect(result.floors[0]?.rooms[1]?.openCount).toBe(0);
    expect(result).toMatchObject({ guestCount: 9, openCount: 2, capacity: 20 });
    expect(findUniqueOrThrow.mock.calls[0]?.[0].select._count.select.guests.where).toEqual({ status: "CONFIRMED" });
    expect(findUniqueOrThrow.mock.calls[0]?.[0].select.property.select.sleepsMax).toBe(true);
    expect(findUniqueOrThrow).toHaveBeenCalledTimes(1);
  });
  it("queries only available spots and preserves unknown prices and zero overrides", async () => {
    findUniqueOrThrow.mockResolvedValue({ pricing, property: { floors: [{ id: "floor", name: "Middle", rooms: [{ id: "room", pricePerPerson: null,
      spots: [{ ...spot("a", "AVAILABLE"), priceOverride: 0 }, spot("b", "AVAILABLE")] }] }] } });
    const result = await getOpenSpots();
    expect(result.spots.map((item) => item.pricePerPerson)).toEqual([0, null]);
    expect(result).toMatchObject({ openCount: 2, pricing: { ...pricing, rangeLabel: "€1,690–€1,860" } });
    expect(result.openRooms).toMatchObject([{ id: "room", floorName: "Middle", openCount: 2, pricePerPerson: null, priceLabel: null }]);
    expect(findUniqueOrThrow.mock.calls[0]?.[0].select.pricing).toBe(true);
    expect(findUniqueOrThrow).toHaveBeenCalledTimes(1);
    expect(findUniqueOrThrow.mock.calls[0]?.[0].select.property.select.floors.include.rooms.include.spots.where)
      .toEqual({ status: "AVAILABLE" });
  });
  it("returns ten available beds and source-ordered room counts with Trip pricing in one read", async () => {
    findUniqueOrThrow.mockResolvedValue({ pricing, property: { floors: [
      { id: "middle", name: "Middle floor", rooms: [
        { id: "4", shortName: "Bedroom 4", pricePerPerson: 1810, description: "Women's quad bunk — shared balcony, shared shower", spots: [1, 2, 3, 4].map((id) => spot(String(id), "AVAILABLE")) },
        { id: "5", shortName: "Bedroom 5", pricePerPerson: 1690, description: "Men's bunk cabin — shared shower", spots: [5, 6].map((id) => spot(String(id), "AVAILABLE")) },
      ] },
      { id: "lower", name: "Lower floor", rooms: [
        { id: "8", shortName: "Bedroom 8", pricePerPerson: 1860, description: "Women's quad bunk — en-suite bathroom", spots: [7, 8, 9, 10].map((id) => spot(String(id), "AVAILABLE")) },
      ] },
    ] } });
    const result = await getOpenSpots("different-trip");
    expect(result.openCount).toBe(10);
    expect(result.spots).toHaveLength(10);
    expect(result.openRooms.map((room) => [room.id, room.openCount, room.priceLabel])).toEqual([["4", 4, "€1,810"], ["5", 2, "€1,690"], ["8", 4, "€1,860"]]);
    expect(findUniqueOrThrow).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ where: { seedKey: "different-trip" } }));
  });
  it("formats known room prices without replacing null prices and handles no available rooms", async () => {
    findUniqueOrThrow.mockResolvedValueOnce({ pricing, property: { floors: [{ id: "floor", name: "Upper", rooms: [
      { id: "room", pricePerPerson: { toString: () => "1725.50" }, spots: [spot("a", "AVAILABLE")] },
    ] }] } });
    expect((await getOpenSpots()).openRooms[0]?.priceLabel).toBe("€1,725.5");
    findUniqueOrThrow.mockResolvedValueOnce({ pricing, property: { floors: [] } });
    expect(await getOpenSpots()).toEqual({ spots: [], openRooms: [], openCount: 0, pricing: { ...pricing, rangeLabel: "€1,690–€1,860" } });
  });
  it("preserves unknown capacity and empty Rooms aggregates", async () => {
    findUniqueOrThrow.mockResolvedValue({ property: { floors: [], sleepsMax: null }, _count: { guests: 0 } });
    expect(await getRoomsByFloor()).toEqual({ floors: [], guestCount: 0, openCount: 0, capacity: null });
  });
  it("derives overall and per-guest task completion from confirmed guests' tasks", async () => {
    findUniqueOrThrow.mockResolvedValue({ guests: [
      { id: "one", tasks: [{ done: true }, { done: false }, { done: true }] },
      { id: "two", tasks: [{ done: false }, { done: false }, { done: true }] },
    ] });
    const result = await getGuestTasks();
    expect(result).toMatchObject({ doneCount: 3, totalTasks: 6 });
    expect(result.guests[0]).toMatchObject({ doneCount: 2, totalTasks: 3 });
    expect(findUniqueOrThrow).toHaveBeenCalledTimes(1);
    expect(findUniqueOrThrow.mock.calls[0]?.[0].select.guests.where).toEqual({ status: "CONFIRMED" });
  });
  it("filters flight provenance in the database query and keeps guests without flights", async () => {
    findUniqueOrThrow.mockResolvedValue({
      startDate: new Date("2027-01-30T00:00:00Z"), endDate: new Date("2027-02-06T00:00:00Z"), timezone: "Europe/Paris",
      flightArrivalTarget: "08:00", flightArrivalCutoff: "08:30", flightReturnCutoff: "11:00",
      guests: [{ id: "one", firstName: "One", lastName: "", displayName: "One", flights: [] }],
    });
    expect(await getFlightTable()).toMatchObject([{ id: "one", status: "Not booked" }]);
    expect(findUniqueOrThrow).toHaveBeenCalledTimes(1);
    const query = findUniqueOrThrow.mock.calls[0]?.[0];
    expect(query.select.guests.select.flights.where).toEqual({ supersededById: null, confirmedByGuest: true });
    expect(query.select.guests.select.flights.select).not.toHaveProperty("confirmationCode");
  });
  it.each([
    ["schedule", getSchedule, "scheduleDays"],
    ["shuttles", getShuttles, "shuttles"],
    ["property", getProperty, "property"],
    ["links", getLinks, "links"],
  ] as const)("reads %s in one trip-scoped call", async (_name, helper, key) => {
    const value = key === "property" ? { id: "chalet" } : [{ id: "row" }];
    findUniqueOrThrow.mockResolvedValue({ [key]: value });
    expect(await helper("other-trip")).toEqual(value);
    expect(findUniqueOrThrow).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ where: { seedKey: "other-trip" } }));
  });
  it("derives chef milestones in a single read", async () => {
    const days = [
      { id: "arrival", breakfast: "NONE", dinner: "CHEF" },
      { id: "middle", breakfast: "CHEF", dinner: "CHEF" },
      { id: "last", breakfast: "CHEF", dinner: "OWN" },
    ];
    findUniqueOrThrow.mockResolvedValue({ chefBreakfastCount: 2, chefDinnerCount: 2, scheduleDays: days, guests: [] });
    expect(await getChefSummary()).toMatchObject({ firstMeal: { day: days[0], meal: "Dinner" },
      lastBreakfast: days[2], lastDinner: days[1] });
    expect(findUniqueOrThrow).toHaveBeenCalledTimes(1);
  });
  it("handles an empty chef schedule without inventing meals", async () => {
    findUniqueOrThrow.mockResolvedValue({ chefBreakfastCount: 0, chefDinnerCount: 0, scheduleDays: [], guests: [] });
    expect(await getChefSummary()).toMatchObject({ firstMeal: null, lastBreakfast: null, lastDinner: null });
  });
  it("propagates a missing trip instead of returning misleading zero counts", async () => {
    findUniqueOrThrow.mockRejectedValue(new Error("Trip not found"));
    await expect(getTripOverview("missing")).rejects.toThrow("Trip not found");
  });
});
