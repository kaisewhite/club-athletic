import { createId } from "@paralleldrive/cuid2";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../../../prisma/generated/client";
import type { TypeformGuestUpdate } from "../typeform/guest-response.server";

const TRIP_KEY = "meribel-2027";

export class TypeformGuestMatchError extends Error {
  constructor(readonly matchCount: number) {
    super("Typeform response did not match exactly one trip guest.");
  }
}

function normalizeName(value: string) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export async function applyTypeformGuestUpdate(update: TypeformGuestUpdate) {
  const connectionString = process.env.DATABASE_URL_POOLED;
  if (!connectionString) throw new Error("DATABASE_URL_POOLED is required for Typeform guest updates.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 5_000 }) });
  try {
    return await db.$transaction(async (tx) => {
      const previous = await tx.typeformSubmission.findUnique({
        where: { responseId: update.responseId }, select: { guestId: true },
      });
      if (previous) return { duplicate: true as const, guestId: previous.guestId };

      const trip = await tx.trip.findUnique({ where: { seedKey: TRIP_KEY }, select: { id: true } });
      if (!trip) throw new Error("Méribel trip not found.");
      const candidates = await tx.guest.findMany({
        where: { tripId: trip.id, status: { in: ["CONFIRMED", "INVITED"] } },
        select: { id: true, firstName: true, lastName: true },
      });
      const firstName = normalizeName(update.firstName);
      const lastName = normalizeName(update.lastName);
      const matches = candidates.filter((guest) => normalizeName(guest.firstName) === firstName && normalizeName(guest.lastName) === lastName);
      if (matches.length !== 1) throw new TypeformGuestMatchError(matches.length);

      const guest = matches[0]!;
      const displayName = `${update.firstName} ${update.lastName}`;
      const data = {
        firstName: update.firstName,
        lastName: update.lastName,
        displayName,
        venmoHandle: update.venmoHandle,
        phone: update.phone,
        dietaryNotes: update.dietaryNotes,
        ...(update.instagramUrl !== undefined ? { instagramUrl: update.instagramUrl } : {}),
        ...(update.favoriteCocktails !== undefined ? { favoriteCocktails: update.favoriteCocktails } : {}),
      };
      await tx.guest.update({ where: { id: guest.id }, data, select: { id: true } });
      await tx.typeformSubmission.create({ data: {
        responseId: update.responseId,
        formId: update.formId,
        guestId: guest.id,
        submittedAt: update.submittedAt,
      } });
      await tx.auditLog.create({ data: {
        id: createId(), action: "TYPEFORM_GUEST_UPDATE", entity: "Guest", entityId: guest.id,
        after: { responseId: update.responseId, fields: Object.keys(data) }, source: "GUEST",
      } });
      return { duplicate: false as const, guestId: guest.id };
    }, { maxWait: 10_000, timeout: 20_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.typeformSubmission.findUnique({
        where: { responseId: update.responseId }, select: { guestId: true },
      });
      if (existing) return { duplicate: true as const, guestId: existing.guestId };
    }
    throw error;
  } finally {
    await db.$disconnect();
  }
}
