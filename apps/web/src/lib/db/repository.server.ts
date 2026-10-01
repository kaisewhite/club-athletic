/** Read-only section queries. Future write helpers belong in a separate module. */
import { withReadDatabase } from "./client.server";
import type { Prisma } from "../../../prisma/generated/client";
import { buildFlightTable, flightSelect } from "./flights";
import { countOpenSpots, getTripPricing } from "./projections";

// A lookup key, not a duplicate of editable trip facts.
const DEFAULT_TRIP_KEY = "meribel-2027";
const guestIdentity = { id: true, firstName: true, lastName: true, displayName: true } as const;
const guestOrder = [{ displayName: "asc" }, { id: "asc" }] as const;
const roomSelection = {
  orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  include: {
    rooms: {
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      include: { spots: { orderBy: { index: "asc" }, include: { guest: { select: guestIdentity } } } },
    },
  },
} satisfies Prisma.FloorFindManyArgs;

function summarizeRooms(floors: Prisma.FloorGetPayload<{ include: typeof roomSelection.include }>[]) {
  return floors.map((floor) => ({
    ...floor,
    rooms: floor.rooms.map((room) => ({ ...room, openCount: countOpenSpots(room.spots) })),
  }));
}

export async function getTripOverview(tripKey = DEFAULT_TRIP_KEY) {
  return withReadDatabase(async (db) => {
    const { property, _count, ...trip } = await db.trip.findUniqueOrThrow({
      where: { seedKey: tripKey },
      include: {
        _count: { select: { guests: { where: { status: "CONFIRMED" } } } },
        property: { include: { floors: roomSelection } },
        shuttles: { orderBy: { departWindowStart: "asc" } },
      },
    });
    const floors = summarizeRooms(property.floors);
    const openRooms = floors.flatMap((floor) => floor.rooms
      .filter((room) => room.openCount > 0)
      .map((room) => ({ ...room, floorId: floor.id, floorName: floor.name })));
    return {
      ...trip, property, openRooms,
      openCount: openRooms.reduce((sum, room) => sum + room.openCount, 0),
      guestCount: _count.guests,
      // Includes the not-offered bed: the Home tile is "9 of 20", not "9 of 19".
      capacity: property.sleepsMax,
    };
  });
}

export async function getSchedule(tripKey = DEFAULT_TRIP_KEY) {
  return withReadDatabase(async (db) => (await db.trip.findUniqueOrThrow({
    where: { seedKey: tripKey }, select: { scheduleDays: { orderBy: { date: "asc" } } },
  })).scheduleDays);
}

export async function getFlightTable(tripKey = DEFAULT_TRIP_KEY) {
  return withReadDatabase(async (db) => {
    const trip = await db.trip.findUniqueOrThrow({
      where: { seedKey: tripKey },
      select: {
        startDate: true, endDate: true, timezone: true,
        flightArrivalTarget: true, flightArrivalCutoff: true, flightReturnCutoff: true,
        guests: {
          orderBy: [...guestOrder], select: {
            ...guestIdentity,
            flights: {
              where: { supersededById: null, confirmedByGuest: true },
              select: flightSelect,
            },
          },
        },
      },
    });
    return buildFlightTable(trip.guests, trip);
  });
}

/**
 * Everything the booking-rules cards say, from the rows that define it: the
 * cutoffs on Trip, the two shuttle windows, and the Friday-night hotel links.
 * Nothing on that card is typed into the component (owner, 2026-09-29: "every
 * single piece of data should be coming from the database").
 */
export async function getFlightRules(tripKey = DEFAULT_TRIP_KEY) {
  return withReadDatabase(async (db) => {
    const trip = await db.trip.findUniqueOrThrow({
      where: { seedKey: tripKey }, select: {
        startDate: true, endDate: true, timezone: true,
        flightArrivalTarget: true, flightArrivalCutoff: true, flightReturnCutoff: true,
        shuttles: { select: { direction: true, departWindowStart: true, departWindowEnd: true, durationMinutes: true, pickupLocation: true, dropoffLocation: true } },
        links: { where: { group: "Hotels" }, orderBy: { sortOrder: "asc" }, select: { id: true, label: true, href: true, note: true } },
      },
    });
    const clock = (date: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: trip.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
    const window = (direction: "INBOUND" | "OUTBOUND") => {
      const shuttle = trip.shuttles.find((s) => s.direction === direction);
      return shuttle ? { from: clock(shuttle.departWindowStart), to: clock(shuttle.departWindowEnd), durationMinutes: shuttle.durationMinutes, pickup: shuttle.pickupLocation } : null;
    };
    return {
      startDate: trip.startDate, endDate: trip.endDate,
      arrivalTarget: trip.flightArrivalTarget, arrivalCutoff: trip.flightArrivalCutoff, returnCutoff: trip.flightReturnCutoff,
      inbound: window("INBOUND"), outbound: window("OUTBOUND"),
      hotels: trip.links,
    };
  });
}
export type FlightRules = Awaited<ReturnType<typeof getFlightRules>>;

export async function getFlightRecommendations(tripKey = DEFAULT_TRIP_KEY) {
  return withReadDatabase(async (db) => (await db.trip.findUniqueOrThrow({
    where: { seedKey: tripKey }, select: {
      flightRecommendations: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, title: true, intro: true, outro: true,
          options: { orderBy: { sortOrder: "asc" }, select: { id: true, route: true, carrier: true, departs: true, arrives: true, fitsShuttle: true, note: true } } },
      },
    },
  })).flightRecommendations);
}

export async function getShuttles(tripKey = DEFAULT_TRIP_KEY) {
  return withReadDatabase(async (db) => (await db.trip.findUniqueOrThrow({
    where: { seedKey: tripKey }, select: { shuttles: { orderBy: { departWindowStart: "asc" } } },
  })).shuttles);
}

export async function getProperty(tripKey = DEFAULT_TRIP_KEY) {
  return withReadDatabase(async (db) => (await db.trip.findUniqueOrThrow({
    where: { seedKey: tripKey }, select: { property: true },
  })).property);
}

export async function getRoomsByFloor(tripKey = DEFAULT_TRIP_KEY) {
  return withReadDatabase(async (db) => {
    const trip = await db.trip.findUniqueOrThrow({
      where: { seedKey: tripKey }, select: {
        _count: { select: { guests: { where: { status: "CONFIRMED" } } } },
        property: { select: { sleepsMax: true, floors: roomSelection } },
      },
    });
    const floors = summarizeRooms(trip.property.floors);
    return {
      floors,
      guestCount: trip._count.guests,
      capacity: trip.property.sleepsMax,
      openCount: floors.reduce((sum, floor) => sum + floor.rooms.reduce((count, room) => count + room.openCount, 0), 0),
    };
  });
}

export async function getOpenSpots(tripKey = DEFAULT_TRIP_KEY) {
  return withReadDatabase(async (db) => {
    const trip = await db.trip.findUniqueOrThrow({
      where: { seedKey: tripKey }, select: {
        pricing: true,
        property: { select: { floors: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          include: { rooms: {
            where: { spots: { some: { status: "AVAILABLE" } } },
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            include: { spots: { where: { status: "AVAILABLE" }, orderBy: { index: "asc" } } },
          } },
        } } },
      },
    });
    const pricing = getTripPricing(trip.pricing);
    const spots = trip.property.floors.flatMap(({ rooms, ...floor }) => rooms.flatMap(({ spots, ...room }) =>
      spots.map((spot) => ({ ...spot, room, floor, pricePerPerson: spot.priceOverride ?? room.pricePerPerson }))));
    const format = new Intl.NumberFormat("en-IE", { style: "currency", currency: pricing.currency, minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const openRooms = trip.property.floors.flatMap((floor) => floor.rooms.map(({ spots, ...room }) => ({
      ...room, floorName: floor.name, openCount: countOpenSpots(spots),
      priceLabel: room.pricePerPerson === null ? null : format.format(Number(room.pricePerPerson)),
    })));
    return { spots, openRooms, openCount: spots.length, pricing };
  });
}

export async function getChefSummary(tripKey = DEFAULT_TRIP_KEY) {
  return withReadDatabase(async (db) => {
    const trip = await db.trip.findUniqueOrThrow({
      where: { seedKey: tripKey }, select: {
        chefBreakfastCount: true, chefDinnerCount: true,
        scheduleDays: { orderBy: { date: "asc" } },
        guests: { where: { status: "CONFIRMED" }, orderBy: [...guestOrder], select: { ...guestIdentity, dietaryNotes: true } },
      },
    });
    const breakfasts = trip.scheduleDays.filter((day) => day.breakfast === "CHEF");
    const dinners = trip.scheduleDays.filter((day) => day.dinner === "CHEF");
    const first = trip.scheduleDays.find((day) => day.breakfast === "CHEF" || day.dinner === "CHEF");
    return {
      ...trip,
      firstMeal: first ? { day: first, meal: first.breakfast === "CHEF" ? "Breakfast" as const : "Dinner" as const } : null,
      lastBreakfast: breakfasts.at(-1) ?? null,
      lastDinner: dinners.at(-1) ?? null,
    };
  });
}

export async function getGuestTasks(tripKey = DEFAULT_TRIP_KEY) {
  return withReadDatabase(async (db) => {
    const trip = await db.trip.findUniqueOrThrow({
      where: { seedKey: tripKey }, select: {
        startDate: true, endDate: true, timezone: true,
        flightArrivalTarget: true, flightArrivalCutoff: true, flightReturnCutoff: true,
        guests: {
          where: { status: "CONFIRMED" }, orderBy: [...guestOrder],
          select: {
            ...guestIdentity,
            tasks: { where: { type: "PAYMENT" }, select: { done: true } },
            flights: {
              where: { supersededById: null, confirmedByGuest: true },
              select: flightSelect,
            },
          },
        },
      },
    });
    const flightRows = buildFlightTable(trip.guests, trip);
    const flightByGuest = new Map(flightRows.map((row) => [row.id, row]));
    const guests = trip.guests.map((guest) => ({
      id: guest.id,
      firstName: guest.firstName,
      lastName: guest.lastName,
      displayName: guest.displayName,
      hasFlights: Boolean(flightByGuest.get(guest.id)?.inbound || flightByGuest.get(guest.id)?.outbound),
      paid: guest.tasks[0]?.done ?? false,
    }));
    return {
      guests,
      guestCount: guests.length,
      paidCount: guests.filter((guest) => guest.paid).length,
    };
  });
}

/** The chalet page: the property, and the Link rows that are its listings. One read. */
export async function getChalet(tripKey = DEFAULT_TRIP_KEY) {
  return withReadDatabase(async (db) => db.trip.findUniqueOrThrow({
    where: { seedKey: tripKey },
    select: { property: true, links: { where: { group: "Chalet" }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
  }));
}

export async function getLinks(tripKey = DEFAULT_TRIP_KEY) {
  return withReadDatabase(async (db) => (await db.trip.findUniqueOrThrow({
    where: { seedKey: tripKey }, select: { links: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
  })).links);
}

export type TripOverview = Awaited<ReturnType<typeof getTripOverview>>;
export type Schedule = Awaited<ReturnType<typeof getSchedule>>;
export type FlightTable = Awaited<ReturnType<typeof getFlightTable>>;
export type FlightRecommendations = Awaited<ReturnType<typeof getFlightRecommendations>>;
export type Shuttles = Awaited<ReturnType<typeof getShuttles>>;
export type Chalet = Awaited<ReturnType<typeof getProperty>>;
export type RoomsByFloor = Awaited<ReturnType<typeof getRoomsByFloor>>;
export type OpenSpots = Awaited<ReturnType<typeof getOpenSpots>>;
export type ChefSummary = Awaited<ReturnType<typeof getChefSummary>>;
export type GuestTasks = Awaited<ReturnType<typeof getGuestTasks>>;
export type Links = Awaited<ReturnType<typeof getLinks>>;
