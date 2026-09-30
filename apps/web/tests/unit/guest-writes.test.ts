import { describe, expect, it, vi } from "vitest";
import { GuestNotFoundError, updateGuestDietaryNotes } from "../../src/lib/db/guest-writes.server";

describe("guest dietary write boundary", () => {
  it("updates only dietaryNotes and records before/after audit data in the transaction", async () => {
    const calls: unknown[] = [];
    const withDatabase = vi.fn(async (write: (db: { transaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> }) => Promise<unknown>) => write({
      transaction: async (operation) => operation({
        guest: {
          findUnique: async (args: unknown) => { calls.push(["find", args]); return { dietaryNotes: "Old note" }; },
          update: async (args: unknown) => { calls.push(["update", args]); return { id: "guest-1" }; },
        },
        auditLog: { create: async (args: unknown) => { calls.push(["audit", args]); } },
      }),
    }));
    const result = await updateGuestDietaryNotes({ guestId: "guest-1", dietaryNotes: "New note" }, { withDatabase: withDatabase as never, createId: () => "audit-1" });
    expect(result).toBe("New note");
    expect(calls).toEqual([
      ["find", { where: { id: "guest-1" }, select: { dietaryNotes: true } }],
      ["update", { where: { id: "guest-1" }, data: { dietaryNotes: "New note" }, select: { id: true } }],
      ["audit", { data: { id: "audit-1", action: "GUEST_DIETARY_UPDATE", entity: "Guest", entityId: "guest-1", before: { dietaryNotes: "Old note" }, after: { dietaryNotes: "New note" }, source: "GUEST" } }],
    ]);
  });

  it("returns 404 semantics for an unknown guest without updating or auditing", async () => {
    const update = vi.fn(); const audit = vi.fn();
    const withDatabase = async (write: (db: { transaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> }) => Promise<unknown>) => write({
      transaction: (operation) => operation({ guest: { findUnique: async () => null, update }, auditLog: { create: audit } }),
    });
    await expect(updateGuestDietaryNotes({ guestId: "missing", dietaryNotes: null }, { withDatabase: withDatabase as never })).rejects.toBeInstanceOf(GuestNotFoundError);
    expect(update).not.toHaveBeenCalled(); expect(audit).not.toHaveBeenCalled();
  });
});
