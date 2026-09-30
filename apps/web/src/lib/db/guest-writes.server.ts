import { createId } from "@paralleldrive/cuid2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../prisma/generated/client";

export class GuestNotFoundError extends Error {}

type GuestWriteTransaction = {
  guest: Pick<PrismaClient["guest"], "findUnique" | "update">;
  auditLog: Pick<PrismaClient["auditLog"], "create">;
};
type GuestWriteDatabase = { transaction<T>(write: (tx: GuestWriteTransaction) => Promise<T>): Promise<T> };
type WithGuestWriteDatabase = <T>(write: (db: GuestWriteDatabase) => Promise<T>) => Promise<T>;
type UpdateDependencies = { withDatabase?: WithGuestWriteDatabase; createId?: () => string };

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
