import { describe, expect, it } from "vitest";
import { createFlightIntake } from "../../src/lib/chat/flight-intake.server";
import {
  args,
  inbound,
  outbound,
  intakeHarness,
  scope,
  NOW,
} from "../fixtures/chat/intake-harness";
import type { RecordFlightArguments } from "../../src/lib/chat/tools/flight-schema";

function setup() {
  const h = intakeHarness();
  let call = 0;
  const run = (
    input: Partial<RecordFlightArguments> = {},
    toolCallId = `call-${++call}`,
  ) =>
    createFlightIntake(h.deps).run(args({ ...input }), {
      scope,
      toolCallId,
      signal: new AbortController().signal,
    });
  const next = (
    action: RecordFlightArguments["action"],
    extra: Partial<RecordFlightArguments> = {},
  ) =>
    run({
      action,
      legs: null,
      documentKind: null,
      pendingExtractionId: h.pending.id,
      version: h.pending.version,
      ...extra,
    });
  const readback = async () => {
    await h.user("Here is my flight");
    await run();
    await h.user("Kaise");
    await next("identify", { firstName: "Kaise", lastName: "" });
    return next("readback");
  };
  return { ...h, run, next, readback };
}
describe("durable flight intake using the real accepted writers", () => {
  it("stages incomplete extraction and refuses commit with a missing-field question", async () => {
    const h = setup();
    const r = await h.run({ legs: [{ ...inbound, flightNumber: null }] });
    expect(r).toMatchObject({ committed: false, phase: "collecting" });
    expect(r.followUp).toMatch(/flight number/i);
    expect(h.tables.pendingExtraction).toHaveLength(1);
    expect(h.tables.flight).toHaveLength(0);
  });
  it("refuses confirmedByGuest:true without persisted server confirmation", async () => {
    const h = setup();
    await h.readback();
    const r = await h.next("commit", { confirmedByGuest: true });
    expect(r.committed).toBe(false);
    expect(h.deps.recordFlight).not.toHaveBeenCalled();
    expect(h.tables.flight).toHaveLength(0);
  });
  it("unknown IATA asks for clarification without guessing an instant", async () => {
    const h = setup();
    const r = await h.run({ legs: [{ ...inbound, origin: "ZZZ" }] });
    expect(r.followUp).toMatch(/timezone|airport/i);
    expect(h.tables.flight).toHaveLength(0);
    expect(JSON.stringify(h.tables.pendingExtraction)).not.toContain(
      "scheduledDeparture",
    );
  });
  it("image passenger names never resolve identity and the mononym remains a mononym", async () => {
    const h = setup();
    const first = await h.run();
    expect(first.followUp).toMatch(/first and last name/i);
    expect(h.tables.pendingExtraction![0]!.guestId).toBeNull();
    await h.user("Kaise");
    await h.next("identify", { firstName: "Kaise", lastName: "" });
    expect(h.tables.pendingExtraction![0]).toMatchObject({
      guestId: "guest",
      claimedFirstName: "Kaise",
      claimedLastName: "",
    });
  });
  it("returns multiple matching guests instead of selecting either Kristy", async () => {
    const h = setup();
    h.tables.guest = [
      {
        id: "k1",
        tripId: "trip",
        firstName: "Kristy",
        lastName: "Kelly",
        displayName: "Kristy Kelly",
      },
      {
        id: "k2",
        tripId: "trip",
        firstName: "Kristy",
        lastName: "Khoury",
        displayName: "Kristy Khoury",
      },
    ];
    await h.run();
    await h.user("Kristy");
    const r = await h.next("identify", { firstName: "Kristy", lastName: "" });
    expect(r.candidates).toHaveLength(2);
    expect(h.tables.pendingExtraction![0]!.guestId).toBeNull();
  });
  it("does not accept an agent-invented claim that is absent from the guest message", async () => {
    const h = setup();
    await h.run();
    await h.user("That name is from the image");
    const r = await h.next("identify", { firstName: "Kaise", lastName: "" });
    expect(r.committed).toBe(false);
    expect(h.tables.pendingExtraction![0]!.nameMessageId).toBeNull();
  });
  it("persists exact local dates and zones in a readback, omitting private extraction fields", async () => {
    const h = setup();
    const r = await h.readback();
    expect(r.phase).toBe("awaiting_confirmation");
    const row = h.tables.message!.find((m) => m.payload.intakeReadback);
    expect(row!.content).toContain("Europe/Zurich");
    expect(row!.content).toContain("2027-01-30 07:25");
    expect(row!.content).not.toMatch(/PRIVATE|Image Name/);
    expect(row!.payload.intakeReadback.version).toBe(
      h.tables.pendingExtraction![0]!.version,
    );
  });
  it("a correction invalidates consent and a stale confirmed version cannot commit", async () => {
    const h = setup();
    await h.readback();
    await h.user("Yes");
    await h.next("confirm");
    const old = { ...h.tables.pendingExtraction![0] };
    await h.user("Actually LX99");
    await h.next("extract", {
      documentKind: "flight_confirmation",
      legs: [{ ...inbound, flightNumber: "LX99" }, outbound],
    });
    expect(h.tables.pendingExtraction![0]).toMatchObject({
      confirmedAt: null,
      confirmationMessageId: null,
      readbackVersion: null,
      phase: "collecting",
    });
    const r = await h.run({
      action: "commit",
      legs: null,
      pendingExtractionId: old.id,
      version: old.version,
      confirmedByGuest: true,
    });
    expect(r.committed).toBe(false);
    expect(h.tables.flight).toHaveLength(0);
  });
  it("an extraction cannot be confirmed at the exact 24-hour expiry", async () => {
    const h = setup();
    await h.readback();
    await h.user("Yes");
    h.setNow(new Date(NOW.getTime() + 86400000));
    const r = await h.next("confirm");
    expect(r.phase).toBe("expired");
    expect(h.tables.flight).toHaveLength(0);
  });
  it("commits both directions and exactly one audit per insert with the claimed name, then dedupes replay", async () => {
    const h = setup();
    await h.readback();
    await h.user("Yes");
    await h.next("confirm");
    const input = args({
      action: "commit",
      legs: null,
      documentKind: null,
      pendingExtractionId: h.tables.pendingExtraction![0]!.id,
      version: h.tables.pendingExtraction![0]!.version,
      confirmedByGuest: true,
    });
    const a = await h.run(input, "commit-id");
    expect(a.committed).toBe(true);
    expect(h.tables.flight).toHaveLength(2);
    expect(h.tables.auditLog).toHaveLength(2);
    expect(
      h.tables.auditLog!.every((a) => a.claimedGuestName === "Kaise"),
    ).toBe(true);
    expect(await h.run(input, "commit-id")).toEqual(a);
    expect(h.tables.auditLog).toHaveLength(2);
  });
  it("supersedes a rebooking while enforcing one live row and auditing both mutations", async () => {
    const h = setup();
    h.tables.flight!.push({
      id: "old",
      guestId: "guest",
      direction: "INBOUND",
      flightNumber: "OLD",
      supersededById: null,
      supersededAt: null,
    });
    await h.readback();
    await h.user("Yes");
    await h.next("confirm");
    await h.next("commit", { confirmedByGuest: true });
    expect(h.tables.flight![0]).toMatchObject({
      flightNumber: "OLD",
      supersededById: expect.any(String),
      supersededAt: NOW,
    });
    expect(
      h.tables.flight!.filter(
        (f) => f.direction === "INBOUND" && !f.supersededById,
      ),
    ).toHaveLength(1);
    expect(h.tables.auditLog).toHaveLength(3);
  });
  it("a second-leg audit failure rolls back both legs and pending consumption", async () => {
    const h = setup();
    await h.readback();
    await h.user("Yes");
    await h.next("confirm");
    h.options.failAuditAt = 2;
    const r = await h.next("commit", { confirmedByGuest: true });
    expect(r.committed).toBe(false);
    expect(h.tables.flight).toHaveLength(0);
    expect(h.tables.auditLog).toHaveLength(0);
    expect(h.tables.pendingExtraction![0]!.consumedAt).toBeNull();
  });
  it("refuses multiple selected legs in one direction and preserves unselected segments", async () => {
    const h = setup();
    const r = await h.run({
      legs: [inbound, { ...inbound, flightNumber: "OTHER" }],
    });
    expect(r.followUp).toMatch(/multiple|which/i);
    expect(h.tables.flight).toHaveLength(0);
  });
  it("declines non-flight uploads without promoting purpose or staging data", async () => {
    const h = setup();
    const r = await h.run({ documentKind: "other" });
    expect(r.followUp).toMatch(/doesn't look like a flight/i);
    expect(h.tables.pendingExtraction).toHaveLength(0);
    expect(h.tables.upload![0]!.purpose).toBe("OTHER");
  });
  it("offers guest creation and requires explicit persisted consent", async () => {
    const h = setup();
    await h.run();
    await h.user("New Guest");
    let r = await h.next("identify", { firstName: "New", lastName: "Guest" });
    expect(r.followUp).toMatch(/add|confirmed list/i);
    expect(h.tables.guest).toHaveLength(1);
    await h.user("Yes, please add me");
    r = await h.next("identify", { firstName: "New", lastName: "Guest" });
    expect(h.tables.guest).toHaveLength(2);
    expect(h.tables.guest![1]).toMatchObject({
      status: "INVITED",
      createdVia: "AGENT",
    });
    expect(h.tables.auditLog).toHaveLength(1);
    expect(h.tables.auditLog![0]!.claimedGuestName).toBe("New Guest");
  });
});

it("does not let the model silently select one of multiple same-direction candidates", async () => {
  const h = setup();
  await h.run({
    legs: [
      inbound,
      { ...inbound, flightNumber: "LX99", selectedForTrip: false },
    ],
  });
  await h.user("Kaise");
  await h.next("identify", { firstName: "Kaise", lastName: "" });
  const r = await h.next("readback");
  expect(r.phase).not.toBe("awaiting_confirmation");
  expect(r.followUp).toMatch(/which|multiple/i);
});
it("an explicit guest segment choice permits a readback and preserves other segments", async () => {
  const h = setup();
  const legs = [
    inbound,
    { ...inbound, flightNumber: "LX99", selectedForTrip: false },
  ];
  await h.run({ legs });
  await h.user("Use LX23");
  await h.next("extract", { documentKind: "flight_confirmation", legs });
  await h.user("Kaise");
  await h.next("identify", { firstName: "Kaise", lastName: "" });
  expect((await h.next("readback")).phase).toBe("awaiting_confirmation");
  await h.user("Yes");
  await h.next("confirm");
  expect((await h.next("commit", { confirmedByGuest: true })).committed).toBe(
    true,
  );
  expect(h.tables.flight![0]!.rawExtraction.legs).toHaveLength(2);
});
it("rejects cancellation before any intake bookkeeping or write", async () => {
  const h = intakeHarness();
  const controller = new AbortController();
  controller.abort();
  await expect(
    createFlightIntake(h.deps).run(args(), {
      scope,
      toolCallId: "c",
      signal: controller.signal,
    }),
  ).rejects.toBeDefined();
  expect(h.tables.pendingExtraction).toHaveLength(0);
  expect(h.tables.upload![0]!.purpose).toBe("OTHER");
});
it("a newer guest correction after yes prevents commit even before re-extraction", async () => {
  const h = setup();
  await h.readback();
  await h.user("Yes");
  await h.next("confirm");
  await h.user("Actually change the time");
  expect((await h.next("commit", { confirmedByGuest: true })).committed).toBe(
    false,
  );
  expect(h.tables.flight).toHaveLength(0);
});
it("restart after receipt loss reuses consumed IDs without duplicating Flight or AuditLog", async () => {
  const h = setup();
  await h.readback();
  await h.user("Yes");
  await h.next("confirm");
  const p = h.tables.pendingExtraction![0]!;
  const input = args({
    action: "commit",
    legs: null,
    documentKind: null,
    pendingExtractionId: p.id,
    version: p.version,
    confirmedByGuest: true,
  });
  const first = await h.run(input, "restart-commit");
  h.tables.message = h.tables.message!.filter(
    (m) => m.providerEventKey !== "flight-intake:restart-commit",
  );
  expect(await h.run(input, "restart-commit")).toEqual(first);
  expect(h.tables.flight).toHaveLength(2);
  expect(h.tables.auditLog).toHaveLength(2);
});
// The redactor no longer eats a plain six-letter capitalised word, so "KRISTY" is
// now returned intact and cannot exercise this guard. The property under test is
// unchanged — an identity the redactor rewrites must not be offered as an exact
// read-back — so the fixture uses a name carrying a reference-shaped token, which
// is still redacted.
it("a redacted identity cannot be offered as an exact read-back", async () => {
  const h = setup();
  h.tables.guest = [
    {
      id: "guest",
      tripId: "trip",
      firstName: "KRISTY",
      lastName: "ABC123",
      displayName: "KRISTY ABC123",
    },
  ];
  await h.run();
  await h.user("KRISTY ABC123");
  await h.next("identify", { firstName: "KRISTY", lastName: "ABC123" });
  const r = await h.next("readback");
  expect(r.phase).not.toBe("awaiting_confirmation");
  expect(r.followUp).toMatch(/read.back|clarify/i);
});
it("a six-character flight number remains visible in the public read-back", async () => {
  const h = setup();
  await h.run({ legs: [{ ...inbound, flightNumber: "LX1234" }] });
  await h.user("Kaise");
  await h.next("identify", { firstName: "Kaise", lastName: "" });
  await h.next("readback");
  const row = h.tables.message!.find((m) => m.payload.intakeReadback);
  expect(row!.content).toMatch(/LX 1234/);
});
it("missing narrow write capability returns the exact fallback and no fabricated success", async () => {
  const h = setup();
  await h.readback();
  await h.user("Yes");
  await h.next("confirm");
  h.deps.recordFlight = async () => {
    throw new Error("DATABASE_URL_POOLED required sk-secret");
  };
  const r = await h.next("commit", { confirmedByGuest: true });
  expect(r).toMatchObject({
    committed: false,
    followUp: "That's not in the trip notes yet — ask the organizer.",
  });
  expect(h.tables.flight).toHaveLength(0);
  expect(JSON.stringify(r)).not.toMatch(/DATABASE_URL|sk-secret/);
});
it("prompt-injection fields cannot widen the write surface", async () => {
  const h = intakeHarness();
  const result = await createFlightIntake(h.deps).run(
    { ...args(), sql: "UPDATE GuestTask SET done=true", table: "Payment" },
    { scope, toolCallId: "injected", signal: new AbortController().signal },
  );
  expect(result.committed).toBe(false);
  expect(h.tables.pendingExtraction).toHaveLength(0);
  expect(h.tables.flight).toHaveLength(0);
  expect(h.tables.guest).toHaveLength(1);
  expect(h.tables.upload![0]!.purpose).toBe("OTHER");
});
it("provider cleanup failure does not undo or repeat a committed flight", async () => {
  const h = setup();
  await h.readback();
  await h.user("Yes");
  await h.next("confirm");
  h.deps.cleanup = async () => {
    throw new Error("provider unavailable");
  };
  expect((await h.next("commit", { confirmedByGuest: true })).committed).toBe(
    true,
  );
  expect(h.tables.flight).toHaveLength(2);
  expect(h.tables.auditLog).toHaveLength(2);
});
