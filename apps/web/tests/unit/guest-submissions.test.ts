import { describe, expect, it, vi } from "vitest";
import { saveGuestDetails, GuestDetailsNameMatchError } from "../../src/lib/db/guest-submissions.server";
import { guestDetailsSchema } from "../../src/lib/guest-details-schema";

const details = guestDetailsSchema.parse({
  firstName: "Alex", lastName: "Guest", phone: "+14155550132", venmoHandle: "@alex-guest",
  instagramHandle: "alex.guest", dietaryNotes: "None", favoriteCocktails: "Margarita",
});

function dependencies(tx: Record<string, unknown>, options: { existingSubmission?: { guestId: string } | null; ids?: string[] } = {}) {
  const ids = options.ids ?? ["guest-new", "audit-1"];
  const createId = vi.fn(() => ids.shift() ?? "extra-id");
  const withDatabase = vi.fn(async (operation: (db: unknown) => Promise<unknown>) => operation({
    transaction: (callback: (transaction: unknown) => Promise<unknown>) => callback(tx),
    findSubmission: async () => options.existingSubmission ?? null,
  }));
  return { createId, withDatabase: withDatabase as never, now: () => new Date("2026-10-27T12:00:00.000Z") };
}

describe("guest details writes", () => {
  it("updates one normalized roster match and stores only the submission identity", async () => {
    const calls: unknown[] = [];
    const tx = {
      guestSubmission: {
        findUnique: async (args: unknown) => { calls.push(["submission-find", args]); return null; },
        create: async (args: unknown) => { calls.push(["submission-create", args]); },
      },
      trip: { findUnique: async (args: unknown) => { calls.push(["trip-find", args]); return { id: "trip-1" }; } },
      guest: {
        findMany: async (args: unknown) => { calls.push(["guest-find", args]); return [{ id: "guest-1", firstName: "Álex", lastName: "Guest" }]; },
        update: async (args: unknown) => { calls.push(["guest-update", args]); return { id: "guest-1" }; },
        create: vi.fn(),
      },
      auditLog: { create: async (args: unknown) => { calls.push(["audit", args]); } },
    };
    const result = await saveGuestDetails({ submissionId: "7c54ef87-76d0-4c5b-87ea-a17b897d8291", details }, dependencies(tx));

    expect(result).toEqual({ duplicate: false, created: false, guestId: "guest-1" });
    expect(calls).toContainEqual(["guest-update", { where: { id: "guest-1" }, data: {
      firstName: "Alex", lastName: "Guest", displayName: "Alex Guest", phone: "+14155550132", venmoHandle: "@alex-guest",
      instagramUrl: "https://www.instagram.com/alex.guest", dietaryNotes: null, favoriteCocktails: "Margarita",
    }, select: { id: true } }]);
    expect(calls).toContainEqual(["submission-create", { data: {
      submissionId: "7c54ef87-76d0-4c5b-87ea-a17b897d8291", source: "website", sourceRef: null,
      guestId: "guest-1", submittedAt: new Date("2026-10-27T12:00:00.000Z"),
    } }]);
    const audit = calls.find((call) => Array.isArray(call) && call[0] === "audit") as [string, { data: { after: { fields: string[] } } }];
    expect(audit[1].data.after.fields).toEqual(["firstName", "lastName", "displayName", "phone", "venmoHandle", "instagramUrl", "dietaryNotes", "favoriteCocktails"]);
    expect(tx.guest.create).not.toHaveBeenCalled();
  });

  it("creates a confirmed guest when there is no roster match", async () => {
    const guestCreate = vi.fn(async ({ data }: { data: { id: string } }) => ({ id: data.id }));
    const tx = {
      guestSubmission: { findUnique: async () => null, create: vi.fn() },
      trip: { findUnique: async () => ({ id: "trip-1" }) },
      guest: { findMany: async () => [], create: guestCreate, update: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const result = await saveGuestDetails({ submissionId: "7c54ef87-76d0-4c5b-87ea-a17b897d8291", details }, dependencies(tx));
    expect(result.created).toBe(true);
    expect(guestCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ id: "guest-new", tripId: "trip-1", status: "CONFIRMED", createdVia: "WEBSITE" }), select: { id: true } });
  });

  it("returns the previous guest for an idempotent retry", async () => {
    const tx = {
      guestSubmission: { findUnique: async () => ({ guestId: "guest-1" }), create: vi.fn() },
      trip: { findUnique: vi.fn() }, guest: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() }, auditLog: { create: vi.fn() },
    };
    const result = await saveGuestDetails({ submissionId: "7c54ef87-76d0-4c5b-87ea-a17b897d8291", details }, dependencies(tx));
    expect(result).toEqual({ duplicate: true, created: false, guestId: "guest-1" });
    expect(tx.trip.findUnique).not.toHaveBeenCalled();
    expect(tx.guest.update).not.toHaveBeenCalled();
  });

  it("rejects an ambiguous duplicate-name match without writing", async () => {
    const guestUpdate = vi.fn();
    const tx = {
      guestSubmission: { findUnique: async () => null, create: vi.fn() },
      trip: { findUnique: async () => ({ id: "trip-1" }) },
      guest: { findMany: async () => [
        { id: "guest-1", firstName: "Alex", lastName: "Guest" },
        { id: "guest-2", firstName: "Alex", lastName: "Guest" },
      ], create: vi.fn(), update: guestUpdate },
      auditLog: { create: vi.fn() },
    };
    await expect(saveGuestDetails({ submissionId: "7c54ef87-76d0-4c5b-87ea-a17b897d8291", details }, dependencies(tx)))
      .rejects.toBeInstanceOf(GuestDetailsNameMatchError);
    expect(guestUpdate).not.toHaveBeenCalled();
    expect(tx.guestSubmission.create).not.toHaveBeenCalled();
  });
});
