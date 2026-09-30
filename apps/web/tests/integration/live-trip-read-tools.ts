/** Local seeded database smoke test. Both endpoints must be explicitly loopback. */
import assert from "node:assert/strict";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { assertLoopbackDatabaseUrls } from "../visual/local-env";
import { createReadTools } from "../../src/lib/chat/tools/read-tools.server";
import { createTripRunnableTools } from "../../src/lib/chat/runtime/tool-runner.server";

// Bun may load the repository .env automatically. Fail closed before the first
// read so this integration script cannot query a configured remote database.
assertLoopbackDatabaseUrls(process.env);

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

// Exercise the exact runnable registered with sessions.events.toolRunner. This
// catches a wiring regression where the repository read succeeds but the agent
// runner receives an empty/fallback result instead of the registered tool value.
const registeredFlightRules = createTripRunnableTools(
  { tripId: "local-seed", conversationId: "local-seed" },
  {} as Anthropic,
).find((tool) => tool.name === "getFlightRules");
assert.ok(registeredFlightRules, "getFlightRules is registered with the session runner");
const registeredOutput = await registeredFlightRules.run({});
assert.equal(typeof registeredOutput, "string", "the read runnable returns its serialized result");
const registeredResult = toolResult.parse(JSON.parse(registeredOutput as string));
assert.equal(registeredResult.ok, true);
assert.equal(flightRules.parse(registeredResult.data).landByLatest, "09:30");
console.log("registered getFlightRules tool: 09:30 result passed");
