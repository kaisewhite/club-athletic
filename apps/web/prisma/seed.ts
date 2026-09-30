// Canonical seed snapshot copied verbatim from docs/meribel-source-decoded.html.
// No runtime import of docs or static facts in the application. Postgres is canonical.
import { createId } from "@paralleldrive/cuid2";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient, type RoomType, type Meal } from "./generated/client";

const TRIP_START = new Date(2027, 0, 30);
const SECTIONS = [
  ['overview','Home'],['schedule','Schedule'],['flights','Flights'],['shuttle','Shuttle'],
  ['chalet','Chalet'],['rooms','Rooms'],['spots','Spots & pricing'],['chef','Chef'],['tasks','Tasks'],['links','Links']
];
const SCHEDULE: {dow:string;num:string;short:string;event:string;breakfast:string;dinner:string;at?:string}[] = [
  {dow:'Sat',num:'30',short:'Sat 30',event:'Arrival — shuttle from GVA, settle in',breakfast:'—',dinner:'Chef',at:'13:00'},
  {dow:'Sun',num:'31',short:'Sun 31',event:'Chill drinks at Le Rond Point des Pistes',breakfast:'Chef',dinner:'Chef'},
  {dow:'Mon',num:'1',short:'Mon 1',event:'La Folie Douce, Méribel–Courchevel',breakfast:'Chef',dinner:'Chef'},
  {dow:'Tue',num:'2',short:'Tue 2',event:'TBD',breakfast:'Chef',dinner:'Chef'},
  {dow:'Wed',num:'3',short:'Wed 3',event:'Le Cap Horn, Courchevel 1850',breakfast:'Chef',dinner:'—'},
  {dow:'Thu',num:'4',short:'Thu 4',event:'Final night out',breakfast:'Chef',dinner:'—'},
  {dow:'Fri',num:'5',short:'Fri 5',event:'Open — last ski day',breakfast:'Chef',dinner:'Chef'},
  {dow:'Sat',num:'6',short:'Sat 6',event:'Departure — shuttle to GVA',breakfast:'—',dinner:'—',at:'04:00'},
];
// /flights recommendations, content and shape from the Notion "Flight & Shuttle
// Guide" (owner, 2026-09-29): a table per option with a one-line verdict per
// flight. `fitsShuttle` is against the trip's cutoffs (land by 09:30, depart
// 10:00 or later); a flight outside them stays listed and says so.
const FLIGHT_RECOMMENDATIONS = [
  { id: 'seed_flightrec_sat', title: 'Option 1 — Fly Friday night, arrive Saturday',
    intro: 'Two nonstops from New York land in time for the group shuttle. Be on the ground at GVA by 9:30 AM.',
    outro: 'If your flight is scheduled to arrive after 9:30 AM, arrange separate transportation to the chalet.',
    options: [
      { id: 'seed_flightopt_ewr_sat', carrier: 'United UA956', route: 'EWR → GVA', departs: '5:30 PM Fri', arrives: '7:30 AM Sat', fits: true, note: 'Best buffer' },
      { id: 'seed_flightopt_jfk_sat', carrier: 'SWISS LX23', route: 'JFK → GVA', departs: '7:25 PM Fri', arrives: '9:15 AM Sat', fits: true, note: 'Fits the window; less buffer' },
    ] },
  { id: 'seed_flightrec_fri', title: 'Option 2 — Arrive Friday for extra buffer',
    intro: 'Optional, but the usual plan: fly Thursday, sleep by the airport Friday, meet the shuttle Saturday morning. A full day of cover for weather or delays. The organizer is on this one.',
    outro: 'Airport hotels with free shuttles are listed above.',
    options: [
      { id: 'seed_flightopt_ewr_fri', carrier: 'United UA956', route: 'EWR → GVA', departs: '5:35 PM Thu', arrives: '7:25 AM Fri', fits: true, note: 'Stay near GVA, shuttle Saturday' },
    ] },
  { id: 'seed_flightrec_home', title: 'Return — Saturday 6 February',
    intro: 'Pickup is 4:00 AM, about 2.5 hours to GVA. Book a flight departing GVA at 10:00 AM or later.',
    outro: 'Schedules change — confirm exact times when booking.',
    options: [
      { id: 'seed_flightopt_jfk_home', carrier: 'SWISS LX22', route: 'GVA → JFK', departs: '11:40 AM', arrives: '2:20 PM', fits: true,  note: 'Room to spare' },
      { id: 'seed_flightopt_ewr_home', carrier: 'United UA957', route: 'GVA → EWR', departs: '9:15 AM', arrives: '12:20 PM', fits: false, note: 'Separate transfer required' },
    ] },
];
const FLOORS = [
  {name:'Upper floor',code:'R11 / F21',rooms:[{name:'Bedroom 1',type:'Master double',rate:1465,allIn:2185,description:'Master double — terrace, dressing room, en-suite bath + shower',ensuite:true,balcony:true,spots:['Kaise',null]}]},
  {name:'Middle floor',code:'R10 / F21',rooms:[
    {name:'Bedroom 2',type:'Double room',rate:1340,allIn:2060,description:'Double — shared balcony, en-suite shower',ensuite:true,balcony:true,spots:['Amelia Drake','Kristy Kelly']},
    {name:'Bedroom 3',type:'Twin room',rate:1290,allIn:2010,description:'Twin — shared balcony, en-suite shower',ensuite:true,balcony:true,spots:['Kristy Khoury','Valeriia Stobolva']},
    {name:'Bedroom 4',type:'Quad bunk room',rate:1090,allIn:1810,description:"Women's quad bunk · Sleeps 4 people · 2 sets of bunk beds · shared balcony, shared shower",ensuite:false,balcony:true,spots:['Christine Calvo','Christie Navarre','','']},
    {name:'Bedroom 5',type:'Bunk cabin',rate:970,allIn:1690,description:"Men's bunk cabin · Sleeps 2 people · 1 set of bunk beds · shared shower",ensuite:false,balcony:false,spots:['Pete F.','']}]},
  {name:'Lower floor',code:'R9 / F12',rooms:[
    {name:'Bedroom 6',type:'Double room',rate:1305,allIn:2025,description:'Double — shared terrace, en-suite shower',ensuite:true,balcony:true,spots:['Augustus Shewchuck','Wayne Martindale']},
    {name:'Bedroom 7',type:'Double room',rate:1305,allIn:2025,description:'Double — shared terrace, en-suite shower',ensuite:true,balcony:true,spots:['Olajuwon Jones','Ted Delcima']},
    {name:'Bedroom 8',type:'Quad bunk room',rate:1140,allIn:1860,description:"Women's quad bunk · Sleeps 4 people · 2 sets of bunk beds · en-suite bathroom",ensuite:true,balcony:false,spots:['','','','']}]},
];
const LINKS: Array<{ group: string; label: string; href: string; note: string | null }> = [
  {group:'Chalet',label:'Falcon Lodge F — Ski in Luxury',href:'https://www.skiinluxury.com/france/meribel/falcon-lodge-f',note:'The whole chalet: photos, layout and what it comes with.'},
  {group:'Chalet',label:'Apartment F12 — Ski in Luxury',href:'https://www.skiinluxury.com/france/meribel/falcon-lodge-f12',note:'The lower apartment on its own (sleeps 4–8). Ours is F12 and F21 combined.'},
  {group:'Chalet',label:'Apartment F21 — Ski in Luxury',href:'https://www.skiinluxury.com/france/meribel/falcon-lodge-f21',note:'The upper apartment on its own (sleeps 6–12).'},
  {group:'Chalet',label:'Falcon residence — Alpine Resorts',href:'https://www.alpine-resorts.fr/en_US/winter/resort/falcon',note:'The residence the chalet is in: the shared pool, hammam, spa and ski shop.'},
  {group:'Ski pass',label:'Méribel / 3 Vallées ski pass',href:'https://www.skipass-meribel.com/en/',note:'Buy your lift pass before you go — Méribel only, or the whole 3 Vallées.'},
  {group:'Ski pass',label:'Epic Pass — Les 3 Vallées access',href:'https://www.epicpass.com/regions/europe/france/les-3-vallees.aspx',note:'Epic Pass holders: how your pass covers days in Les 3 Vallées.'},
  {group:'Mountain',label:'Méribel webcams',href:'https://www.meribel.net/informations-pratiques/webcams/',note:'Live pictures of the slopes and weather before you head out.'},
  {group:'Wellness',label:'Spa Falcon',href:'https://www.alpine-resorts.fr/en_US/destination/alpes-fr/meribel/spa/spa-falcon',note:'The residence spa for treatments and massages.'},
  {group:'Hotels',label:'Geneva Marriott (Friday night)',href:'https://www.marriott.com/en-us/hotels/gvamc-geneva-marriott-hotel/overview/',note:'Airport hotel if you fly in a day early — free shuttle, under 5 min.'},
  {group:'Hotels',label:'Hilton Geneva (Friday night)',href:'https://www.hilton.com/en/hotels/gvacchi-hilton-geneva-hotel-and-conference-centre/',note:'Airport hotel if you fly in a day early — free shuttle every ~20 min, 4:20 AM–11:40 PM.'},
];
const KB = `TRIP: Méribel (Les 3 Vallées), France. Chalet Falcon Lodge F, 269 Rte de l'Altiport, 73550 Les Allues. Dates Sat 30 Jan – Sat 6 Feb 2027.
SHUTTLE: Out Sat 30 Jan departs GVA 10:30–11:00 AM. Back Sat 6 Feb chalet pickup 4:00 AM, confirmed with Alps2Alps 2026-09-24. 49-seat bus for passengers, luggage, ski equipment. ~2 h to the chalet, ~2.5 h back to GVA. Meeting point at GVA: right outside baggage claim. Return pickup at the chalet.
FLIGHTS: To catch the shuttle land at GVA by 9:30 AM Saturday (aim 8:30 or earlier). Landing after 9:30 → arrange own transport. Return: book from GVA at 10:00 AM or later, never earlier. Optional: arrive Friday, stay near GVA (Geneva Marriott — free shuttle, <5 min; Hilton Geneva — free shuttle every ~20 min, 4:20 AM–11:40 PM). Example early flight EWR→GVA Thu 5:35 PM → Fri 7:25 AM.
ROOMS: Upper floor (R11/F21) Bedroom 1 master double: Kaise (spot 2 N/A). Middle floor (R10/F21): Bedroom 2 double: Amelia Drake, Kristy Kelly. Bedroom 3 twin: Kristy Khoury, Valeriia Stobolva. Bedroom 4 quad bunk: Christine Calvo, Christie Navarre, 2 available. Bedroom 5 bunk cabin: Pete F., 1 available. Lower floor (R9/F12): Bedroom 6 double: Augustus Shewchuck, Wayne Martindale. Bedroom 7 double: Olajuwon Jones, Ted Delcima. Bedroom 8 quad bunk: 4 available. 12 confirmed guests, 7 open spots.
REMAINING SPOTS: Bedroom 4: women's quad bunk, shared balcony and shared shower, 3 open spots, €1,810 per person all-in. Bedroom 5: men's bunk cabin, shared shower, 1 open spot, €1,690 per person all-in. Bedroom 8: women's quad bunk, en-suite bathroom, 4 open spots, €1,860 per person all-in. All-in = room rate + €33.60 taxes + €178 shuttle + €100 incidentals + €408 chef. Not flights/ski pass/rentals. Contact the organizer to claim.
CHEF: 6 breakfasts (Sun 31 Jan – Fri 5 Feb), 5 dinners (Sat 30 Jan – Tue 2 Feb, plus Fri 5 Feb). No chef dinner Wed 3 (Le Cap Horn) or Thu 4 Feb (final night out).
EVENTS: Sat 30 arrival. Sun 31 chill drinks at Le Rond Point des Pistes, Méribel. Mon 1 Feb La Folie Douce Méribel–Courchevel. Tue 2 open. Wed 3 Le Cap Horn, Courchevel 1850. Thu 4 final night out. Fri 5 open. Sat 6 departure.
CHALET: Central Méribel ~200 m from slopes, 326 m², 3 levels, 8 bedrooms, sleeps 10–20. Two apartments combined: F12 (sleeps 4–8) + F21 (sleeps 6–12). Lounges, two fireplaces, main kitchen + kitchenette, private outdoor hot tub, two saunas, fitness room, shared indoor pool/hammam/sauna/massage rooms, on-site ski shop and rental, ski lockers with boot warmers, underground parking, laundry. Most rooms en-suite with balcony/terrace; some bunk rooms share a shower room, may lack balcony.
LINKS: ski pass skipass-meribel.com and Epic Pass 3 Vallées; Méribel webcams; Spa Falcon.`;

// A reviewed migration map, not whitespace-based name inference. Retain the
// exact original display names and spellings. Kaise has no supplied surname.
// Group flights on record (owner, 2026-09-29, from the flight sheet). Times are the
// airport's local clock, stored as instants: New York airports are UTC-5 in
// January/February, Geneva is UTC+1. A guest whose sheet entry is incomplete or
// blank has no row for that direction; the table shows "—" for it.
const GROUP_FLIGHTS: Array<{ guest: string; direction: "INBOUND" | "OUTBOUND"; airline: string; flightNumber: string; origin: string; destination: string; departs: string; arrives: string }> = [
  // Flight numbers: UA956 and UA749 are the only nonstops on their routes. The
  // Miami trips connect in Zurich onto SWISS LX64; the 10:35 GVA→ZRH feeder's own
  // number was not published in what could be found, so the long-haul is recorded.
  { guest: "Olajuwon Jones",    direction: "INBOUND",  airline: "United", flightNumber: "UA956", origin: "EWR", destination: "GVA", departs: "2027-01-28T17:35:00-05:00", arrives: "2027-01-29T07:25:00+01:00" },
  { guest: "Olajuwon Jones",    direction: "OUTBOUND", airline: "United", flightNumber: "UA749", origin: "GVA", destination: "IAD", departs: "2027-02-06T11:20:00+01:00", arrives: "2027-02-06T14:55:00-05:00" },
  { guest: "Augustus Shewchuck", direction: "OUTBOUND", airline: "SWISS", flightNumber: "LX64 via ZRH", origin: "GVA", destination: "MIA", departs: "2027-02-06T10:35:00+01:00", arrives: "2027-02-06T17:30:00-05:00" },
  { guest: "Valeriia Stobolva", direction: "OUTBOUND", airline: "SWISS", flightNumber: "LX64 via ZRH", origin: "GVA", destination: "MIA", departs: "2027-02-06T10:35:00+01:00", arrives: "2027-02-06T17:30:00-05:00" },
  { guest: "Kaise",             direction: "INBOUND",  airline: "United", flightNumber: "UA956", origin: "EWR", destination: "GVA", departs: "2027-01-28T17:35:00-05:00", arrives: "2027-01-29T07:25:00+01:00" },
];

const GUEST_NAMES: Record<string, { firstName: string; lastName: string }> = {
  Kaise: { firstName: "Kaise", lastName: "" },
  "Amelia Drake": { firstName: "Amelia", lastName: "Drake" },
  "Kristy Kelly": { firstName: "Kristy", lastName: "Kelly" },
  "Kristy Khoury": { firstName: "Kristy", lastName: "Khoury" },
  "Valeriia Stobolva": { firstName: "Valeriia", lastName: "Stobolva" },
  "Augustus Shewchuck": { firstName: "Augustus", lastName: "Shewchuck" },
  "Wayne Martindale": { firstName: "Wayne", lastName: "Martindale" },
  "Olajuwon Jones": { firstName: "Olajuwon", lastName: "Jones" },
  "Ted Delcima": { firstName: "Ted", lastName: "Delcima" },
  // An initial is the surname as given; Guest.lastName is never invented.
  "Pete F.": { firstName: "Pete", lastName: "F." },
  "Christine Calvo": { firstName: "Christine", lastName: "Calvo" },
  "Christie Navarre": { firstName: "Christie", lastName: "Navarre" },
};

const ROOM_TYPES: Record<string, RoomType> = {
  "Master double": "MASTER_DOUBLE",
  "Double room": "DOUBLE",
  "Twin room": "TWIN",
  "Quad bunk room": "QUAD_BUNK",
  "Bunk cabin": "BUNK_CABIN",
};
const MEALS: Record<string, Meal> = { Chef: "CHEF", "—": "NONE", "On your own": "OWN" };
const SEED_KEY = "meribel-2027";

// Supplementary facts transcribed from the decoded HTML's Chalet and Spots
// markup (not from TODO prose). The source supplies no coordinates,
// per-room prices, per-room ensuite/balcony facts, or venue URLs.
const PROPERTY_FACTS = {
  name: "Falcon Lodge F",
  address: "269 Rte de l'Altiport, 73550 Les Allues, France",
  mapsUrl: "https://maps.google.com/?q=269+Rte+de+l'Altiport,+73550+Les+Allues,+France",
  sizeSquareMeters: 326,
  floorCount: 3,
  bedroomCount: 8,
  sleepsMin: 10,
  sleepsMax: 20,
  externalListingUrls: [
    "https://www.skiinluxury.com/france/meribel/falcon-lodge-f",
    "https://www.skiinluxury.com/france/meribel/falcon-lodge-f12",
    "https://www.skiinluxury.com/france/meribel/falcon-lodge-f21",
    "https://www.alpine-resorts.fr/en_US/summer/resort/falcon/hebergement/chalet-f",
  ],
  // Property photos are supplied by the external listing links below.
  photos: [],
  amenities: {
    private: [
      "Multiple lounges, dining areas, two fireplaces",
      "Main kitchen plus lower-level kitchenette",
      "Private outdoor hot tub, two saunas, fitness room",
      "Ski lockers with boot warmers",
      "Underground parking, private laundry",
    ],
    shared: ["Indoor pool, hammam, sauna, massage rooms", "On-site ski shop and equipment rental"],
  },
};

const PRICING = {
  minPerPerson: 1690,
  maxPerPerson: 1860,
  currency: "EUR",
  description: "per person, all-in",
  breakdown: { taxes: 33.6, shuttle: 178, incidentals: 100, chef: 408 },
  note: "All-in = room rate + taxes + shuttle + incidentals + chef",
  includes: [
    "Your bed for 7 nights",
    "Private chef — 6 breakfasts, 5 dinners",
    "Group shuttle GVA ↔ chalet",
    "Taxes, incidentals and tips",
  ],
  excludes: ["flights", "ski pass", "rentals", "nights out"],
};

function kbSection(section: string): string {
  const prefix = `${section}: `;
  const line = KB.split("\n").find((entry) => entry.startsWith(prefix));
  if (!line) throw new Error(`Missing decoded KB section: ${section}`);
  return line.slice(prefix.length);
}

// SQL DATE values use UTC midnight solely as the Prisma date representation.
// TRIP_START was a browser-local Date in the design; never convert that instant
// with toISOString(), which could move the date in a different machine zone.
function scheduleDate(offset: number): Date {
  return new Date(Date.UTC(TRIP_START.getFullYear(), TRIP_START.getMonth(), TRIP_START.getDate() + offset));
}

function validateSnapshot(): void {
  const rooms = FLOORS.flatMap((floor) => floor.rooms);
  const spots = rooms.flatMap((room) => room.spots);
  const names = spots.filter((name): name is string => name !== null && name !== "");
  if (FLOORS.length !== 3 || rooms.length !== 8 || names.length !== 12 ||
      new Set(names).size !== 12 || spots.filter((s) => s === "").length !== 7 ||
      spots.filter((s) => s === null).length !== 1 || SCHEDULE.length !== 8 || LINKS.length !== 10) {
    throw new Error("Decoded seed snapshot counts do not match the reviewed source.");
  }
  if (names.some((name) => !GUEST_NAMES[name]) || Object.keys(GUEST_NAMES).length !== names.length) {
    throw new Error("Every source guest must have exactly one reviewed name mapping.");
  }
  for (const room of rooms) {
    if (!ROOM_TYPES[room.type]) throw new Error("Unmapped source room type.");
  }
  SCHEDULE.forEach((day, offset) => {
    if (!MEALS[day.breakfast] || !MEALS[day.dinner] ||
        scheduleDate(offset).getUTCDate() !== Number(day.num)) {
      throw new Error("Unmapped meal or inconsistent source schedule date.");
    }
  });
}

// Insert-only idempotency preserves organizer edits when the snapshot is rerun.
// Unique seed/natural keys and a transaction-scoped lock prevent duplicate rows.
// Every actual content insert has an audit row; an unchanged rerun writes none.
async function ensure<T extends { id: string }>(
  tx: Prisma.TransactionClient,
  entity: string,
  find: () => Promise<T | null>,
  create: () => Promise<T>,
): Promise<T> {
  const existing = await find();
  if (existing) return existing;
  const row = await create();
  await tx.auditLog.create({
    data: {
      id: createId(), action: "SEED", entity, entityId: row.id, source: "ORGANIZER",
      after: JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue,
    },
  });
  return row;
}

async function seed(tx: Prisma.TransactionClient): Promise<void> {
  // PgBouncer transaction pooling supports transaction-scoped advisory locks.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(20270130, 20270206)`;
  const propertyKey = `${SEED_KEY}:falcon-lodge-f`;
  const property = await ensure(tx, "Property",
    () => tx.property.findUnique({ where: { seedKey: propertyKey } }),
    () => tx.property.create({ data: {
      id: createId(), seedKey: propertyKey, ...PROPERTY_FACTS,
      description: kbSection("CHALET"),
    } }));
  // Keep organizer-managed property content current on existing rows too.
  await tx.property.update({ where: { id: property.id }, data: {
    photos: PROPERTY_FACTS.photos,
    externalListingUrls: PROPERTY_FACTS.externalListingUrls,
    amenities: PROPERTY_FACTS.amenities,
    description: kbSection("CHALET"),
  } });
  const trip = await ensure(tx, "Trip",
    () => tx.trip.findUnique({ where: { seedKey: SEED_KEY } }),
    () => tx.trip.create({ data: {
      id: createId(), seedKey: SEED_KEY, name: "Méribel 2027",
      destination: "Méribel, France", resort: "Les 3 Vallées",
      startDate: scheduleDate(0), endDate: scheduleDate(SCHEDULE.length - 1),
      timezone: "Europe/Paris", currency: "EUR", propertyId: property.id,
      chefBreakfastCount: SCHEDULE.filter((day) => day.breakfast === "Chef").length,
      chefDinnerCount: SCHEDULE.filter((day) => day.dinner === "Chef").length,
      pricing: PRICING, flightArrivalCutoff: "09:30", flightArrivalTarget: "08:30",
      flightReturnCutoff: "10:00",
    } }));
  // The booking rules are edited here and pushed, whatever the row held before.
  await tx.trip.update({ where: { id: trip.id }, data: { flightArrivalCutoff: "09:30", flightArrivalTarget: "08:30", flightReturnCutoff: "10:00", pricing: PRICING } });

  for (const [floorIndex, sourceFloor] of FLOORS.entries()) {
    const floorKey = { propertyId: property.id, code: sourceFloor.code };
    const floor = await ensure(tx, "Floor",
      () => tx.floor.findUnique({ where: { propertyId_code: floorKey } }),
      () => tx.floor.create({ data: {
        id: createId(), ...floorKey, name: sourceFloor.name, sortOrder: floorIndex,
      } }));
    for (const [roomIndex, sourceRoom] of sourceFloor.rooms.entries()) {
      const roomKey = { floorId: floor.id, name: sourceRoom.name };
      const room = await ensure(tx, "Room",
        () => tx.room.findUnique({ where: { floorId_name: roomKey } }),
        () => tx.room.create({ data: {
          id: createId(), ...roomKey, shortName: sourceRoom.name.split(" · ")[0]!,
          type: ROOM_TYPES[sourceRoom.type]!, sortOrder: roomIndex,
          pricePerPerson: sourceRoom.allIn, ensuite: sourceRoom.ensuite,
          balcony: sourceRoom.balcony, description: sourceRoom.description,
        } }));
      // Organizer pricing and room facts are content, so push them on every rerun.
      await tx.room.update({ where: { id: room.id }, data: {
        pricePerPerson: sourceRoom.allIn, ensuite: sourceRoom.ensuite,
        balcony: sourceRoom.balcony, description: sourceRoom.description,
      } });
      for (const [spotIndex, displayName] of sourceRoom.spots.entries()) {
        let guestId: string | null = null;
        if (displayName !== null && displayName !== "") {
          const guestKey = `${SEED_KEY}:guest:${displayName}`;
          const guest = await ensure(tx, "Guest",
            () => tx.guest.findUnique({ where: { seedKey: guestKey } }),
            () => tx.guest.create({ data: {
              id: createId(), seedKey: guestKey, tripId: trip.id,
              ...GUEST_NAMES[displayName]!, displayName, status: "CONFIRMED", createdVia: "SEED",
            } }));
          guestId = guest.id;
          for (const type of ["FLIGHT", "PAYMENT", "DETAILS"] as const) {
            const taskKey = { guestId: guest.id, type };
            await ensure(tx, "GuestTask",
              () => tx.guestTask.findUnique({ where: { guestId_type: taskKey } }),
              () => tx.guestTask.create({ data: { id: createId(), ...taskKey, done: false } }));
          }
        }
        const spotKey = { roomId: room.id, index: spotIndex + 1 };
        const spot = await ensure(tx, "Spot",
          () => tx.spot.findUnique({ where: { roomId_index: spotKey } }),
          () => tx.spot.create({ data: {
            id: createId(), ...spotKey, guestId,
            status: displayName === null ? "NOT_OFFERED" : displayName === "" ? "AVAILABLE" : "ASSIGNED",
          } }));
        // A spot this seed names a guest for, still open in the database, is
        // assigned now: claiming a bed is a seed edit plus a push (owner, 2026-09-29).
        if (guestId && spot.status === "AVAILABLE" && spot.guestId === null) {
          await tx.spot.update({ where: { id: spot.id }, data: { guestId, status: "ASSIGNED" } });
        }
      }
    }
  }

  for (const [index, day] of SCHEDULE.entries()) {
    const dayKey = { tripId: trip.id, date: scheduleDate(index) };
    // Venue names are taken from the schedule itself. No URLs are supplied.
    const venue = index === 1 ? day.event.replace("Chill drinks at ", "")
      : index === 2 || index === 4 ? day.event : null;
    const day_row = await ensure(tx, "ScheduleDay",
      () => tx.scheduleDay.findUnique({ where: { tripId_date: dayKey } }),
      () => tx.scheduleDay.create({ data: {
        id: createId(), ...dayKey, dow: day.dow, dayNumber: Number(day.num),
        eventTitle: day.event, venue, breakfast: MEALS[day.breakfast]!,
        dinner: MEALS[day.dinner]!, isOpen: day.event === "TBD" || day.event.startsWith("Open —"),
        // Standing times (owner, 2026-09-28): breakfast is ready by 07:00 and
        // dinner is around 19:30. A time only exists where the chef actually
        // serves — "on your own" and "—" stay null so the page says so rather
        // than implying a sitting. Event times are TBD for now.
        breakfastAt: MEALS[day.breakfast] === "CHEF" ? "07:00" : null,
        dinnerAt: MEALS[day.dinner] === "CHEF" ? "19:30" : null,
        // Arrival is the inbound shuttle's 11:00 window end + its 120 min; departure
        // is the outbound pickup window opening. Every other event time is genuinely TBD.
        eventAt: day.at ?? null,
      } }));
    // Times and meals are edited here and pushed (owner, 2026-09-29).
    await tx.scheduleDay.update({ where: { id: day_row.id }, data: {
      eventTitle: day.event, breakfast: MEALS[day.breakfast]!, dinner: MEALS[day.dinner]!, isOpen: day.event === "TBD" || day.event.startsWith("Open —"),
      breakfastAt: MEALS[day.breakfast] === "CHEF" ? "07:00" : null, dinnerAt: MEALS[day.dinner] === "CHEF" ? "19:30" : null, eventAt: day.at ?? null,
    } });
  }
  // One live flight per guest and direction. The seed is where the sheet lands, so
  // a changed time updates the live row rather than adding a second one.
  for (const flight of GROUP_FLIGHTS) {
    const guest = await tx.guest.findUniqueOrThrow({ where: { seedKey: `${SEED_KEY}:guest:${flight.guest}` } });
    const fields = {
      airline: flight.airline, flightNumber: flight.flightNumber,
      origin: flight.origin, destination: flight.destination,
      scheduledDeparture: new Date(flight.departs), scheduledArrival: new Date(flight.arrives),
      source: "ORGANIZER" as const, confirmedByGuest: true, confirmedAt: new Date(),
    };
    const live = await tx.flight.findFirst({ where: { guestId: guest.id, direction: flight.direction, supersededById: null } });
    if (live) await tx.flight.update({ where: { id: live.id }, data: fields });
    else await tx.flight.create({ data: { id: createId(), guestId: guest.id, direction: flight.direction, ...fields } });
  }

  // A link dropped from this list is dropped from the database (owner, 2026-09-29:
  // the Notion planning doc went — "the whole point of this website was to move
  // away from Notion").
  await tx.link.deleteMany({ where: { tripId: trip.id, NOT: { OR: LINKS.map((link) => ({ group: link.group, href: link.href })) } } });

  for (const [order, rec] of FLIGHT_RECOMMENDATIONS.entries()) {
    const recKey = { tripId: trip.id, sortOrder: order + 1 };
    // Content, not identity: the seed is where this text is edited, so an existing
    // row is brought up to date rather than left as first written.
    const content = { title: rec.title, intro: rec.intro, outro: rec.outro };
    const row = await tx.flightRecommendation.upsert({ where: { tripId_sortOrder: recKey },
      create: { id: rec.id, ...recKey, ...content }, update: content });
    for (const [i, opt] of rec.options.entries()) {
      const optKey = { recommendationId: row.id, sortOrder: i + 1 };
      const fields = { route: opt.route, carrier: opt.carrier, departs: opt.departs, arrives: opt.arrives, fitsShuttle: opt.fits, note: opt.note };
      await tx.flightRecommendationOption.upsert({ where: { recommendationId_sortOrder: optKey },
        create: { id: opt.id, ...optKey, ...fields }, update: fields });
    }
  }

  for (const [sortOrder, link] of LINKS.entries()) {
    const linkKey = { tripId: trip.id, group: link.group, href: link.href };
    const row = await ensure(tx, "Link",
      () => tx.link.findUnique({ where: { tripId_group_href: linkKey } }),
      () => tx.link.create({ data: { id: createId(), tripId: trip.id, ...link, sortOrder } }));
    // The note is organizer copy, not identity: keep an existing row current with the seed.
    if ((row.note ?? null) !== (link.note ?? null) || row.sortOrder !== sortOrder) await tx.link.update({ where: { id: row.id }, data: { note: link.note ?? null, sortOrder } });
  }

  // Dates/times are from KB and the shuttle markup, explicitly in winter CET.
  // Convert to UTC instants on insert, independent of the machine timezone.
  const shuttles = [
    { direction: "INBOUND" as const, departWindowStart: new Date("2027-01-30T10:30:00+01:00"),
      departWindowEnd: new Date("2027-01-30T11:00:00+01:00"), pickupLocation: "Geneva Airport (GVA)",
      dropoffLocation: PROPERTY_FACTS.name, durationMinutes: 120 },
    // Return pickup 04:00 sharp — Alps2Alps (2026-09-24): "targeting 4:00 AM for
    // pickup would actually be even better than 4:15–4:30". Winter roads: ~2.5 h.
    { direction: "OUTBOUND" as const, departWindowStart: new Date("2027-02-06T04:00:00+01:00"),
      departWindowEnd: new Date("2027-02-06T04:00:00+01:00"), pickupLocation: PROPERTY_FACTS.name,
      dropoffLocation: "Geneva Airport (GVA)", durationMinutes: 150 },
  ];
  for (const shuttle of shuttles) {
    const shuttleKey = { tripId: trip.id, direction: shuttle.direction };
    const notes = shuttle.direction === "INBOUND"
      ? "Meeting point: right outside baggage claim at Geneva Airport (GVA)."
      : `Meeting point: the bus picks up at ${PROPERTY_FACTS.name}.`;
    const fields = { ...shuttle, seats: 49, notes };
    // Timings are edited here and pushed: the operator confirms them by email.
    await tx.shuttle.upsert({ where: { tripId_direction: shuttleKey }, create: { id: createId(), tripId: trip.id, ...fields }, update: fields });
  }
  // Preserve the entire authoritative KB, including optional hotel/flight
  // examples and qualifiers such as approximate duration. No invented flights.
  const sectionMap: Record<string, string> = {
    TRIP: "overview", SHUTTLE: "shuttle", FLIGHTS: "flights", ROOMS: "rooms",
    "REMAINING SPOTS": "spots", CHEF: "chef", EVENTS: "schedule", CHALET: "chalet", LINKS: "links",
  };
  for (const line of KB.split("\n")) {
    const colon = line.indexOf(": ");
    const title = line.slice(0, colon);
    const seedKey = `${SEED_KEY}:kb:${title}`;
    const section = sectionMap[title];
    if (!section || !SECTIONS.some(([id]) => id === section)) throw new Error("Unknown KB section.");
    const note = await ensure(tx, "Note",
      () => tx.note.findUnique({ where: { seedKey } }),
      () => tx.note.create({ data: {
        id: createId(), seedKey, tripId: trip.id, section, title, content: line.slice(colon + 2),
      } }));
    // KB lines are organizer copy: keep their existing rows current with the seed.
    const content = line.slice(colon + 2);
    if (note.content !== content) await tx.note.update({ where: { id: note.id }, data: { content } });
  }
}

async function main(): Promise<void> {
  validateSnapshot();
  const connectionString = process.env.DATABASE_URL_POOLED;
  if (!connectionString) throw new Error("DATABASE_URL_POOLED is required; run through scripts/with-env.sh.");
  const db = new PrismaClient({ adapter: new PrismaPg({
    connectionString, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 5_000,
  }) });
  try {
    const counts = await db.$transaction(async (tx) => {
      await seed(tx);
      return tx.$queryRaw<Array<{ t: string; n: bigint }>>`
        SELECT 'guests' t, count(*) n FROM "Guest"
        UNION ALL SELECT 'rooms', count(*) FROM "Room"
        UNION ALL SELECT 'spots_assigned', count(*) FROM "Spot" WHERE status='ASSIGNED'
        UNION ALL SELECT 'spots_available', count(*) FROM "Spot" WHERE status='AVAILABLE'
        UNION ALL SELECT 'spots_not_offered', count(*) FROM "Spot" WHERE status='NOT_OFFERED'
        UNION ALL SELECT 'schedule_days', count(*) FROM "ScheduleDay"
        UNION ALL SELECT 'links', count(*) FROM "Link"`;
    }, { maxWait: 10_000, timeout: 120_000 });
    console.log("Seed complete: decoded Méribel snapshot inserted; existing rows preserved.");
    // db execute intentionally discards SELECT results; print real database
    // counts here so two successful seed runs have comparable evidence.
    console.log("t | n");
    for (const { t, n } of counts) console.log(`${t} | ${n}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Do not serialize driver errors: they can contain connection details.
  const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "SEED_FAILED";
  console.error(`Seed failed (${code}). Check dependencies, schema, and database connectivity.`);
  process.exitCode = 1;
});
