import { describe, expect, it, vi } from "vitest";
import { createChatWrites } from "../../src/lib/db/chat-writes.server";
import type { ChatDatabase } from "../../src/lib/db/chat-client.server";
import {
  createReadTools,
  boundTripData,
  TRIP_FALLBACK,
} from "../../src/lib/chat/tools/read-tools.server";
import { tripToolDefinitions } from "../../src/lib/chat/tools/registry.server";
import { recordFlightSchema } from "../../src/lib/chat/tools/flight-schema";
import { flightExtractionSchema } from "../../src/lib/db/flight-contract";

it("promotes only the owned upload purpose, idempotently, with no other column updates", async () => {
  const upload = {
    id: "upload",
    conversationId: "c",
    purpose: "OTHER",
    fileId: "file",
    status: "mounted",
  };
  const update = vi.fn(async ({ data }: { data: object }) =>
    Object.assign(upload, data),
  );
  const tx = {
    conversation: { findFirst: async () => ({ id: "c" }) },
    $queryRaw: async () => [],
    upload: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; conversationId: string };
      }) =>
        where.id === upload.id && where.conversationId === upload.conversationId
          ? { ...upload }
          : null,
      update,
    },
  };
  const writes = createChatWrites({
    ...tx,
    $transaction: async (run: (t: typeof tx) => unknown) => run(tx),
  } as unknown as ChatDatabase);
  await expect(
    writes.promoteFlightConfirmationUpload({
      conversationId: "other",
      uploadId: "upload",
    }),
  ).rejects.toThrow();
  expect(update).not.toHaveBeenCalled();
  await writes.promoteFlightConfirmationUpload({
    conversationId: "c",
    uploadId: "upload",
  });
  await writes.promoteFlightConfirmationUpload({
    conversationId: "c",
    uploadId: "upload",
  });
  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledWith({
    where: { id: "upload" },
    data: { purpose: "FLIGHT_CONFIRMATION" },
  });
  expect(upload).toEqual({
    id: "upload",
    conversationId: "c",
    purpose: "FLIGHT_CONFIRMATION",
    fileId: "file",
    status: "mounted",
  });
});

describe("bounded trip registry", () => {
  it("has only named trip tools and one domain write", () => {
    expect(tripToolDefinitions.map((t) => t.name)).toEqual([
      "getTripOverview",
      "getSchedule",
      "getFlightRules",
      "getFlightTable",
      "getFlightRecommendations",
      "getShuttles",
      "getProperty",
      "getRoomsByFloor",
      "getOpenSpots",
      "getChefSummary",
      "getGuestTasks",
      "getLinks",
      "getNotes",
      "findGuestByName",
      "readTripAttachment",
      "recordFlight",
    ]);
    expect(tripToolDefinitions.every((t) => t.type === "custom")).toBe(true);
    expect(JSON.stringify(tripToolDefinitions)).not.toMatch(
      /"name":"(?:bash|shell|sql|read_file|createGuest)"/,
    );
  });
  it("uses the existing nullable extraction contract, without accepting widened authority", () => {
    expect(recordFlightSchema.shape.legs).toBe(
      flightExtractionSchema.shape.legs,
    );
    expect(
      recordFlightSchema.safeParse({ sql: "UPDATE GuestTask SET done=true" })
        .success,
    ).toBe(false);
  });
  it("bounds nested output and removes private fields and error/secret text", () => {
    const result = boundTripData({
      confirmationCode: "private-ref",
      bookingReference: "private-ref",
      rawExtraction: { secret: "hidden" },
      rows: Array.from({ length: 1000 }, () => ({
        description: "a".repeat(10000),
        token: "secret",
      })),
      error: "SQLSTATE",
    });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(24000);
    expect(JSON.stringify(result)).not.toMatch(
      /private-ref|hidden|SQLSTATE|"token"/,
    );
  });
  it("calls the existing flight-table helper and keeps its computed status", async () => {
    const getFlightTable = vi.fn(async () => [
      { displayName: "Kaise", status: "Tight" },
    ]);
    const tool = createReadTools({ getFlightTable }).find(
      (t) => t.name === "getFlightTable",
    )!;
    expect(JSON.parse(await tool.run({}))).toEqual({
      ok: true,
      sourceSection: "Flights",
      data: [{ displayName: "Kaise", status: "Tight" }],
    });
    expect(getFlightTable).toHaveBeenCalledTimes(1);
  });
  it("returns the honest fallback on a read failure without leaking diagnostics", async () => {
    const tool = createReadTools({
      getSchedule: async () => {
        throw new Error("postgres://private SQLSTATE booking ABC123");
      },
    }).find((t) => t.name === "getSchedule")!;
    expect(JSON.parse(await tool.run({}))).toEqual({
      ok: false,
      sourceSection: "Events",
      message: TRIP_FALLBACK,
    });
  });
  it("logs the real cause of a read failure server-side while still redacting it from the guest", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const tool = createReadTools({
        getFlightRules: async () => {
          throw new Error("postgres://private SQLSTATE booking ABC123");
        },
      }).find((t) => t.name === "getFlightRules")!;
      const answer = await tool.run({});
      // The guest-facing payload is unchanged: fallback only, no diagnostics.
      expect(JSON.parse(answer)).toEqual({
        ok: false,
        sourceSection: "Flights",
        message: TRIP_FALLBACK,
      });
      expect(answer).not.toMatch(/postgres|SQLSTATE|ABC123/);
      // The operator gets the cause, which is what the bare catch used to eat.
      expect(logged).toHaveBeenCalledTimes(1);
      const [stage, fields] = logged.mock.calls[0]!;
      expect(String(stage)).toContain("readTool.run");
      expect(JSON.stringify(fields)).toContain("getFlightRules");
      expect(JSON.stringify(fields)).toMatch(/SQLSTATE/);
    } finally {
      logged.mockRestore();
    }
  });
});

describe("flight rules are a first-class read, not a shuttle lookup", () => {
  const rules = {
    airport: "Geneva Airport (GVA)",
    timezone: "Europe/Paris",
    landByLatest: "08:30",
    landByTarget: "08:00",
    returnDepartNoEarlierThan: "11:00",
    ifLaterThanLandByLatest: "arrange their own transfer to the chalet.",
  };
  it("exposes the landing cutoff, the target and the return cutoff under the Flights source", async () => {
    const getFlightRules = vi.fn(async () => rules);
    const tool = createReadTools({ getFlightRules }).find(
      (t) => t.name === "getFlightRules",
    )!;
    expect(JSON.parse(await tool.run({}))).toEqual({
      ok: true,
      sourceSection: "Flights",
      data: rules,
    });
    expect(getFlightRules).toHaveBeenCalledTimes(1);
  });
  it("takes no arguments, so the model cannot widen it into a query", async () => {
    const getFlightRules = vi.fn(async () => rules);
    const tool = createReadTools({ getFlightRules }).find(
      (t) => t.name === "getFlightRules",
    )!;
    expect(JSON.parse(await tool.run({ tripKey: "other" })).ok).toBe(false);
    expect(getFlightRules).not.toHaveBeenCalled();
  });
  it("describes itself as the landing-deadline tool and the shuttle tool as the bus, so the two cannot be confused", () => {
    const describe_ = (name: string) =>
      tripToolDefinitions.find((t) => t.name === name)!.description!;
    expect(describe_("getFlightRules")).toMatch(/land/i);
    expect(describe_("getFlightRules")).not.toEqual(describe_("getShuttles"));
    // Each points at the other, so "when must I land" cannot land on the bus.
    expect(describe_("getShuttles")).toMatch(/getFlightRules/);
    expect(describe_("getShuttles")).toMatch(/bus/i);
    expect(describe_("getFlightTable")).toMatch(/getFlightRules/);
    expect(describe_("getFlightRules")).toMatch(/getShuttles/);
  });
  it("stays read-only and is offered identically to both session factories", () => {
    const definition = tripToolDefinitions.find(
      (t) => t.name === "getFlightRules",
    )!;
    expect(definition.type).toBe("custom");
    expect(definition.input_schema).toMatchObject({ type: "object" });
    expect(JSON.stringify(definition)).not.toMatch(/write|update|insert|delete/i);
  });
});
it("preserves database decimal prices as values rather than implementation fields", () => {
  const decimal = { d: [2400], e: 3, s: 1, toJSON: () => "2400" };
  expect(boundTripData({ pricePerPerson: decimal })).toEqual({
    pricePerPerson: "2400",
  });
});
