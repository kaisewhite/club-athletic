import { describe, expect, it } from "vitest";
import { applyTypeformGuestUpdate } from "../../src/lib/db/typeform-writes.server";
import type { TypeformGuestUpdate } from "../../src/lib/typeform/guest-response.server";

const update: TypeformGuestUpdate = {
  responseId: "response-new-guest",
  formId: "s7gvWdIF",
  submittedAt: new Date("2026-10-26T21:37:48Z"),
  firstName: "Ari",
  lastName: "Stobaugh",
  venmoHandle: "ari-stobaugh",
  phone: "+17755550123",
  dietaryNotes: "Dairy",
  instagramUrl: "https://www.instagram.com/ari",
  favoriteCocktails: "Dirty martini",
};

describe("Typeform guest synchronization", () => {
  it("creates a confirmed imported guest when the submission is not on the roster", async () => {
    const calls: unknown[] = [];
    const withDatabase = async (operation: (db: { transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T>; findSubmission: (id: string) => Promise<{ guestId: string } | null> }) => Promise<unknown>) => operation({
      findSubmission: async () => null,
      transaction: (callback) => callback({
        typeformSubmission: {
          findUnique: async (args: unknown) => { calls.push(["receipt", args]); return null; },
          create: async (args: unknown) => { calls.push(["submission", args]); },
        },
        trip: { findUnique: async () => ({ id: "trip-1" }) },
        guest: {
          findMany: async () => [],
          create: async (args: unknown) => { calls.push(["guest", args]); return { id: "guest-new" }; },
        },
        auditLog: { create: async (args: unknown) => { calls.push(["audit", args]); } },
      }),
    });

    const result = await applyTypeformGuestUpdate(update, {
      withDatabase: withDatabase as never,
      createId: (() => { let id = 0; return () => `id-${++id}`; })(),
    });

    expect(result).toEqual({ duplicate: false, guestId: "guest-new" });
    expect(calls).toContainEqual(["guest", { data: {
      id: "id-1", tripId: "trip-1", firstName: "Ari", lastName: "Stobaugh", displayName: "Ari Stobaugh",
      venmoHandle: "ari-stobaugh", phone: "+17755550123", dietaryNotes: "Dairy",
      instagramUrl: "https://www.instagram.com/ari", favoriteCocktails: "Dirty martini",
      status: "CONFIRMED", createdVia: "IMPORT",
    }, select: { id: true } }]);
    expect(calls).toContainEqual(["submission", { data: {
      responseId: "response-new-guest", formId: "s7gvWdIF", guestId: "guest-new", submittedAt: update.submittedAt,
    } }]);
    expect(calls).toContainEqual(["audit", { data: {
      id: "id-2", action: "TYPEFORM_GUEST_CREATE", entity: "Guest", entityId: "guest-new",
      after: { responseId: "response-new-guest", fields: ["firstName", "lastName", "displayName", "venmoHandle", "phone", "dietaryNotes", "instagramUrl", "favoriteCocktails"] },
      source: "GUEST",
    } }]);
  });
});
