import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  publicRow,
  publicDelta,
} from "../../src/lib/chat/runtime/public-frame.server";
import { mapManagedAgentEvent } from "../../src/lib/managed-agents/map-managed-agent-event";
const read = (path: string) => readFileSync(path, "utf8");
describe("Task 5 write boundary", () => {
  it.each([
    "repository.server.ts",
    "flights.ts",
    "projections.ts",
    "airport-timezones.ts",
  ])("keeps %s free of writes", (name) => {
    expect(read(`src/lib/db/${name}`)).not.toMatch(
      /\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw)\s*\(/,
    );
  });
  it("retains the partial live unique index and deferred self-FK without any drop", () => {
    const sql = readdirSync("prisma/migrations", { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => read(`prisma/migrations/${d.name}/migration.sql`))
      .join("\n");
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "Flight_guestId_direction_live_key" ON "Flight"("guestId", "direction") WHERE "supersededById" IS NULL;',
    );
    expect(sql).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(sql).not.toMatch(
      /DROP INDEX[^;]*Flight_guestId_direction_live_key/i,
    );
  });
  it("domain write capability can only mutate Flight, Guest, AuditLog and consume pending bookkeeping", () => {
    const source = read("src/lib/db/flight-write-client.server.ts");
    const tables = [
      ...source.matchAll(
        /tx\.(\w+)\.(?:create|update|updateMany|upsert|delete|deleteMany)\(/g,
      ),
    ].map((m) => m[1]);
    expect(new Set(tables)).toEqual(
      new Set(["flight", "guest", "auditLog", "pendingExtraction"]),
    );
    expect(source).not.toMatch(
      /\.(payment|spot|guestTask|room|scheduleDay|link)\.(create|update|delete)/i,
    );
    for (const file of readdirSync("src/lib/chat/tools").filter((f) =>
      f.endsWith(".ts"),
    ))
      expect(read(`src/lib/chat/tools/${file}`)).not.toMatch(
        /\bPrismaClient\b|\$executeRaw|\$queryRaw|DATABASE_URL_POOLED/,
      );
    const intake = read("src/lib/chat/flight-intake.server.ts");
    expect(intake).not.toMatch(/db\.[\w]+\.(create|update|delete|upsert)\(/);
  });
  it("custom results pair through existing tool_result and redact booking/secrets before public frames", () => {
    const mapped = mapManagedAgentEvent({
      id: "result",
      type: "user.custom_tool_result",
      custom_tool_use_id: "call",
      content: [{ type: "text", text: "booking ABC123 password hidden" }],
    });
    expect(mapped).toMatchObject({
      kind: "display",
      type: "tool_result",
      payload: { invocationId: "call" },
    });
    if (mapped.kind !== "display") throw new Error("fixture");
    expect(
      JSON.stringify(
        publicRow({
          id: "r",
          seq: 1,
          type: mapped.type,
          payload: mapped.payload,
        }),
      ),
    ).not.toMatch(/ABC123|hidden/);
    expect(
      publicDelta({
        blockId: "b",
        variant: "message",
        text: "booking ABC123 sk-secret",
        done: true,
      }).text,
    ).not.toMatch(/ABC123|sk-secret/);
  });
});
