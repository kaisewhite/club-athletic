import { beforeEach, describe, expect, it, vi } from "vitest";

const { disconnect, construct } = vi.hoisted(() => ({ disconnect: vi.fn(), construct: vi.fn() }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class {} }));
vi.mock("../../prisma/generated/client", () => ({
  PrismaClient: class {
    constructor() { construct(); }
    $disconnect = disconnect;
    trip = {};
  },
}));
import { withReadDatabase } from "../../src/lib/db/client.server";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL_POOLED", "postgresql://fixture:fixture@localhost/fixture");
});

describe("read client lifecycle", () => {
  it("disconnects after a successful read", async () => {
    expect(await withReadDatabase(async () => 42)).toBe(42);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
  it("disconnects when reading or projecting throws", async () => {
    await expect(withReadDatabase(async () => { throw new Error("read failed"); })).rejects.toThrow("read failed");
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
  it("rejects a missing pooled URL before opening a client", async () => {
    vi.stubEnv("DATABASE_URL_POOLED", "");
    await expect(withReadDatabase(async () => null)).rejects.toThrow("DATABASE_URL_POOLED");
    expect(construct).not.toHaveBeenCalled();
  });
});
