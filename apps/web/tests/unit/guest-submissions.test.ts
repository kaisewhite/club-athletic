import { describe, expect, it, vi } from "vitest";
import { saveGuestDetails, GuestDetailsNameMatchError, GuestDetailsRoomFullError } from "../../src/lib/db/guest-submissions.server";
import { guestDetailsSchema } from "../../src/lib/guest-details-schema";

const details = guestDetailsSchema.parse({
  firstName: "Alex", lastName: "Guest", phone: "+14155550132", venmoHandle: "@alex-guest",
  instagramHandle: "alex.guest", dietaryNotes: "None", favoriteCocktails: "Margarita", roomId: "room-1",
});

function dependencies(tx: Record<string, unknown>, options: { existingSubmission?: { guestId: string } | null; ids?: string[] } = {}) {
  const completeTx = { ...tx, spot: tx.spot ?? { findFirst: async () => ({ id: "spot-1" }), updateMany: async () => ({ count: 1 }) } };
  const ids = options.ids ?? ["guest-new", "audit-1"];
  const createId = vi.fn(() => ids.shift() ?? "extra-id");
  const withDatabase = vi.fn(async (operation: (db: unknown) => Promise<unknown>) => operation({
    transaction: (callback: (transaction: unknown) => Promise<unknown>) => callback(completeTx),
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
      guestId: "guest-1", submittedAt: new Date("2026-10-27T12:00:00.000Z"), processedAt: new Date("2026-10-27T12:00:00.000Z"),
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

  it("matches and confirms an existing pending guest even with a new submission id", async () => {
    const guestUpdate = vi.fn(async () => ({ id: "guest-pending" }));
    const guestCreate = vi.fn();
    const tx = {
      guestSubmission: { findUnique: async () => null, create: vi.fn() },
      trip: { findUnique: async () => ({ id: "trip-1" }) },
      guest: {
        findMany: async () => [{ id: "guest-pending", firstName: "Alex", lastName: "Guest", status: "PENDING" }],
        create: guestCreate,
        update: guestUpdate,
      },
      auditLog: { create: vi.fn() },
    };
    const result = await saveGuestDetails({ submissionId: "7c54ef87-76d0-4c5b-87ea-a17b897d8291", details }, dependencies(tx));
    expect(result).toMatchObject({ created: false, guestId: "guest-pending" });
    expect(guestUpdate).toHaveBeenCalledWith({ where: { id: "guest-pending" }, data: expect.objectContaining({ status: "CONFIRMED", preferredRoomId: null }), select: { id: true } });
    expect(guestCreate).not.toHaveBeenCalled();
  });

  it("returns the previous guest for an idempotent retry", async () => {
    const claimSpot = vi.fn();
    const tx = {
      guestSubmission: { findUnique: async () => ({ guestId: "guest-1" }), create: vi.fn() },
      trip: { findUnique: vi.fn() }, guest: { findUnique: async () => ({ status: "CONFIRMED" }), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
      spot: { findFirst: vi.fn(), updateMany: claimSpot }, auditLog: { create: vi.fn() },
    };
    const result = await saveGuestDetails({ submissionId: "7c54ef87-76d0-4c5b-87ea-a17b897d8291", details }, dependencies(tx));
    expect(result).toEqual({ duplicate: true, created: false, guestId: "guest-1" });
    expect(tx.trip.findUnique).not.toHaveBeenCalled();
    expect(tx.guest.update).not.toHaveBeenCalled();
    expect(claimSpot).not.toHaveBeenCalled();
  });

  it("claims one available spot in the selected room", async () => {
    const claim = vi.fn(async () => ({ count: 1 }));
    const tx = {
      guestSubmission: { findUnique: async () => null, create: vi.fn() },
      trip: { findUnique: async () => ({ id: "trip-1" }) },
      guest: { findMany: async () => [], create: async ({ data }: { data: { id: string } }) => ({ id: data.id }), update: vi.fn() },
      spot: { findFirst: async () => ({ id: "spot-open" }), updateMany: claim }, auditLog: { create: vi.fn() },
    };
    await saveGuestDetails({ submissionId: "7c54ef87-76d0-4c5b-87ea-a17b897d8291", details }, dependencies(tx));
    expect(claim).toHaveBeenCalledWith({ where: { id: "spot-open", roomId: "room-1", status: "AVAILABLE" }, data: { status: "ASSIGNED", guestId: "guest-new" } });
  });

  it("refuses a room that has no available spot", async () => {
    const tx = {
      guestSubmission: { findUnique: async () => null, create: vi.fn() }, trip: { findUnique: async () => ({ id: "trip-1" }) },
      guest: { findMany: async () => [], create: async ({ data }: { data: { id: string } }) => ({ id: data.id }), update: vi.fn() },
      spot: { findFirst: async () => null, updateMany: vi.fn() }, auditLog: { create: vi.fn() },
    };
    await expect(saveGuestDetails({ submissionId: "7c54ef87-76d0-4c5b-87ea-a17b897d8291", details }, dependencies(tx))).rejects.toBeInstanceOf(GuestDetailsRoomFullError);
  });

  it("moves an existing assignment and frees the old spot", async () => {
    const lookups: unknown[] = [];
    const updates: unknown[] = [];
    const tx = {
      guestSubmission: { findUnique: async () => null, create: vi.fn() }, trip: { findUnique: async () => ({ id: "trip-1" }) },
      guest: { findMany: async () => [{ id: "guest-1", firstName: "Alex", lastName: "Guest" }], create: vi.fn(), update: async () => ({ id: "guest-1" }) },
      spot: {
        findFirst: async (args: unknown) => { lookups.push(args); return lookups.length === 1 ? { id: "spot-old" } : { id: "spot-new" }; },
        updateMany: async (args: unknown) => { updates.push(args); return { count: 1 }; },
      }, auditLog: { create: vi.fn() },
    };
    await saveGuestDetails({ submissionId: "7c54ef87-76d0-4c5b-87ea-a17b897d8291", details }, dependencies(tx));
    expect(updates).toEqual([
      { where: { id: "spot-old", guestId: "guest-1", status: "ASSIGNED" }, data: { status: "AVAILABLE", guestId: null } },
      { where: { id: "spot-new", roomId: "room-1", status: "AVAILABLE" }, data: { status: "ASSIGNED", guestId: "guest-1" } },
    ]);
  });

  it("allows exactly one concurrent claim for the last spot", async () => {
    let open = true;
    const tx = () => ({
      guestSubmission: { findUnique: async () => null, create: vi.fn() }, trip: { findUnique: async () => ({ id: "trip-1" }) },
      guest: { findMany: async () => [], create: async ({ data }: { data: { id: string } }) => ({ id: data.id }), update: vi.fn() },
      spot: {
        findFirst: async (args: { where?: { guestId?: string } }) => args.where?.guestId ? null : open ? ({ id: "last-spot" }) : null,
        updateMany: async () => { if (!open) return { count: 0 }; open = false; return { count: 1 }; },
      }, auditLog: { create: vi.fn() },
    });
    const submit = (id: string, firstName: string) => saveGuestDetails({
      submissionId: id, details: { ...details, firstName },
    }, dependencies(tx(), { ids: [`guest-${firstName}`, `audit-${firstName}`] }));
    const results = await Promise.allSettled([
      submit("7c54ef87-76d0-4c5b-87ea-a17b897d8291", "Alex"),
      submit("8c54ef87-76d0-4c5b-87ea-a17b897d8291", "Jamie"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected" && result.reason instanceof GuestDetailsRoomFullError)).toHaveLength(1);
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
