import { createId } from "@paralleldrive/cuid2";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../../../prisma/generated/client";
import type { TypeformGuestUpdate } from "../typeform/guest-response.server";

const TRIP_KEY = "meribel-2027";

type TypeformWriteTransaction = Pick<Prisma.TransactionClient, "trip" | "guest" | "typeformSubmission" | "auditLog">;
type TypeformWriteDatabase = {
  transaction<T>(operation: (tx: TypeformWriteTransaction) => Promise<T>): Promise<T>;
  findSubmission(responseId: string): Promise<{ guestId: string } | null>;
};
type WithTypeformWriteDatabase = <T>(operation: (db: TypeformWriteDatabase) => Promise<T>) => Promise<T>;
type TypeformWriteDependencies = { withDatabase?: WithTypeformWriteDatabase; createId?: () => string };

export class TypeformGuestMatchError extends Error {
  constructor(readonly matchCount: number) {
    super("Typeform response did not match exactly one trip guest.");
  }
}

function normalizeName(value: string) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

const withTypeformWriteDatabase: WithTypeformWriteDatabase = async (operation) => {
  const connectionString = process.env.DATABASE_URL_POOLED;
  if (!connectionString) throw new Error("DATABASE_URL_POOLED is required for Typeform guest updates.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 5_000 }) });
  try {
    return await operation({
      transaction: (callback) => db.$transaction((tx) => callback(tx), { maxWait: 10_000, timeout: 20_000 }),
      findSubmission: (responseId) => db.typeformSubmission.findUnique({ where: { responseId }, select: { guestId: true } }),
    });
  } finally {
    await db.$disconnect();
  }
};

export async function applyTypeformGuestUpdate(update: TypeformGuestUpdate, deps: TypeformWriteDependencies = {}) {
  const create = deps.createId ?? createId;
  return (deps.withDatabase ?? withTypeformWriteDatabase)(async (db) => {
    try {
      return await db.transaction(async (tx) => {
        const previous = await tx.typeformSubmission.findUnique({
          where: { responseId: update.responseId }, select: { guestId: true },
        });
        if (previous) return { duplicate: true as const, guestId: previous.guestId };

        const trip = await tx.trip.findUnique({ where: { seedKey: TRIP_KEY }, select: { id: true } });
        if (!trip) throw new Error("Méribel trip not found.");
        const candidates = await tx.guest.findMany({
          where: { tripId: trip.id },
          select: { id: true, firstName: true, lastName: true },
        });
        const firstName = normalizeName(update.firstName);
        const lastName = normalizeName(update.lastName);
        const matches = candidates.filter((guest) => normalizeName(guest.firstName) === firstName && normalizeName(guest.lastName) === lastName);
        if (matches.length > 1) throw new TypeformGuestMatchError(matches.length);

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
        const guest = matches.length === 1
          ? await tx.guest.update({ where: { id: matches[0]!.id }, data, select: { id: true } })
          : await tx.guest.create({ data: {
            id: create(), tripId: trip.id, ...data, status: "CONFIRMED", createdVia: "IMPORT",
          }, select: { id: true } });
        await tx.typeformSubmission.create({ data: {
          responseId: update.responseId,
          formId: update.formId,
          guestId: guest.id,
          submittedAt: update.submittedAt,
        } });
        await tx.auditLog.create({ data: {
          id: create(), action: matches.length === 0 ? "TYPEFORM_GUEST_CREATE" : "TYPEFORM_GUEST_UPDATE", entity: "Guest", entityId: guest.id,
          after: { responseId: update.responseId, fields: Object.keys(data) }, source: "GUEST",
        } });
        return { duplicate: false as const, guestId: guest.id };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await db.findSubmission(update.responseId);
        if (existing) return { duplicate: true as const, guestId: existing.guestId };
      }
      throw error;
    }
  });
}
