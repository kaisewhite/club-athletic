/** Real trip database smoke test. Run with the app's configured read credential. */
import assert from "node:assert/strict";
import { z } from "zod";
import { createReadTools } from "../../src/lib/chat/tools/read-tools.server";

const toolResult = z.object({ ok: z.boolean(), sourceSection: z.string().min(1), data: z.unknown() });

const flightRules = z.object({
  landByLatest: z.string().regex(/^\d{2}:\d{2}$/),
  landByTarget: z.string().regex(/^\d{2}:\d{2}$/),
  returnDepartNoEarlierThan: z.string().regex(/^\d{2}:\d{2}$/),
});

const openSpots = z.object({ openCount: z.number(), spots: z.array(z.unknown()) });
const shuttles = z.array(z.object({
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  departureDateLocal: z.string(),
  departWindowStartLocal: z.string(),
  departWindowEndLocal: z.string(),
  timeZone: z.string(),
}));

const tools = createReadTools();

assert.equal(tools.length, 13, "the trip read tool registry changed");

for (const tool of tools) {
  const output = toolResult.parse(JSON.parse(await tool.run({})));
  assert.equal(output.ok, true, `${tool.name} could not read the trip database`);
  assert.ok(output.sourceSection, `${tool.name} has no source section`);
  assert.notEqual(output.data, null, `${tool.name} returned no trip data`);
  assert.notEqual(output.data, undefined, `${tool.name} returned no trip data`);

  if (tool.name === "getFlightRules") {
    const rules = flightRules.parse(output.data);
    assert.equal(rules.landByLatest, "09:30");
    assert.equal(rules.landByTarget, "08:30");
    assert.equal(rules.returnDepartNoEarlierThan, "10:00");
  }

  if (tool.name === "getOpenSpots") {
    const spots = openSpots.parse(output.data);
    assert.equal(spots.openCount, spots.spots.length);
  }

  if (tool.name === "getShuttles") {
    const rows = shuttles.parse(output.data);
    const outbound = rows.find(row => row.direction === "OUTBOUND");
    assert.equal(outbound?.departureDateLocal, "2027-02-06");
    assert.equal(outbound?.departWindowStartLocal, "04:00");
    assert.equal(outbound?.departWindowEndLocal, "04:00");
    assert.equal(outbound?.timeZone, "Europe/Paris");
    assert.equal(Object.hasOwn(outbound ?? {}, "departWindowStart"), false);
  }

  if (tool.name === "getTripOverview") {
    const overview = z.object({ timezone: z.string(), shuttles }).parse(output.data);
    const outbound = overview.shuttles.find(row => row.direction === "OUTBOUND");
    assert.equal(outbound?.departWindowStartLocal, "04:00");
    assert.equal(Object.hasOwn(outbound ?? {}, "departWindowStart"), false);
  }

  console.log(`${tool.name}: database read passed`);
}
