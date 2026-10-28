import { createId } from "@paralleldrive/cuid2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../prisma/generated/client";

export class GuestNotFoundError extends Error {}
export class GuestAlreadyExistsError extends Error {}

type GuestWriteTransaction = {
  trip: Pick<PrismaClient["trip"], "findUnique">;
  guest: Pick<PrismaClient["guest"], "findFirst" | "findUnique" | "update" | "create">;
  auditLog: Pick<PrismaClient["auditLog"], "create">;
};
type GuestWriteDatabase = { transaction<T>(write: (tx: GuestWriteTransaction) => Promise<T>): Promise<T> };
type WithGuestWriteDatabase = <T>(write: (db: GuestWriteDatabase) => Promise<T>) => Promise<T>;
type UpdateDependencies = { withDatabase?: WithGuestWriteDatabase; createId?: () => string };
type CreateDependencies = { withDatabase?: WithGuestWriteDatabase; createId?: () => string };

const withGuestWriteDatabase: WithGuestWriteDatabase = async (write) => {
  const connectionString = process.env.DATABASE_URL_POOLED;
  if (!connectionString) throw new Error("DATABASE_URL_POOLED is required for guest writes.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 5_000 }) });
  try {
    return await write({ transaction: (operation) => db.$transaction((tx) => operation(tx), { maxWait: 10_000, timeout: 20_000 }) });
  } finally {
    await db.$disconnect();
  }
};

export async function updateGuestDietaryNotes(
  { guestId, dietaryNotes }: { guestId: string; dietaryNotes: string | null },
  deps: UpdateDependencies = {},
): Promise<string | null> {
  return (deps.withDatabase ?? withGuestWriteDatabase)((db) => db.transaction(async (tx) => {
    const existing = await tx.guest.findUnique({ where: { id: guestId }, select: { dietaryNotes: true } });
    if (!existing) throw new GuestNotFoundError("Guest not found.");
    await tx.guest.update({ where: { id: guestId }, data: { dietaryNotes }, select: { id: true } });
    await tx.auditLog.create({ data: {
      id: (deps.createId ?? createId)(), action: "GUEST_DIETARY_UPDATE", entity: "Guest", entityId: guestId,
      before: { dietaryNotes: existing.dietaryNotes }, after: { dietaryNotes }, source: "GUEST",
    } });
    return dietaryNotes;
  }));
}

export async function updateGuestFavoriteCocktails(
  { guestId, favoriteCocktails }: { guestId: string; favoriteCocktails: string | null },
  deps: UpdateDependencies = {},
): Promise<string | null> {
  return (deps.withDatabase ?? withGuestWriteDatabase)((db) => db.transaction(async (tx) => {
    const existing = await tx.guest.findUnique({ where: { id: guestId }, select: { favoriteCocktails: true } });
    if (!existing) throw new GuestNotFoundError("Guest not found.");
    await tx.guest.update({ where: { id: guestId }, data: { favoriteCocktails }, select: { id: true } });
    await tx.auditLog.create({ data: {
      id: (deps.createId ?? createId)(), action: "GUEST_COCKTAILS_UPDATE", entity: "Guest", entityId: guestId,
      before: { favoriteCocktails: existing.favoriteCocktails }, after: { favoriteCocktails }, source: "GUEST",
    } });
    return favoriteCocktails;
  }));
}

export async function createGuestWithDietaryNotes(
  { firstName, lastName, dietaryNotes, instagramUrl, tripKey = "meribel-2027" }: { firstName: string; lastName: string; dietaryNotes: string | null; instagramUrl: string; tripKey?: string },
  deps: CreateDependencies = {},
): Promise<{ id: string; displayName: string }> {
  return (deps.withDatabase ?? withGuestWriteDatabase)((db) => db.transaction(async (tx) => {
    const trip = await tx.trip.findUnique({ where: { seedKey: tripKey }, select: { id: true } });
    if (!trip) throw new Error("Trip not found.");
    const displayName = `${firstName} ${lastName}`;
    const existing = await tx.guest.findFirst({ where: { tripId: trip.id, firstName, lastName }, select: { id: true } });
    if (existing) throw new GuestAlreadyExistsError("A guest with that name already exists.");
    const id = (deps.createId ?? createId)();
    await tx.guest.create({ data: {
      id, tripId: trip.id, firstName, lastName, displayName, status: "CONFIRMED", dietaryNotes, instagramUrl, createdVia: "AGENT",
    }, select: { id: true } });
    await tx.auditLog.create({ data: {
      id: (deps.createId ?? createId)(), action: "GUEST_CREATE", entity: "Guest", entityId: id,
      after: { firstName, lastName, displayName, dietaryNotes, instagramUrl }, source: "GUEST",
    } });
    return { id, displayName };
  }));
}
