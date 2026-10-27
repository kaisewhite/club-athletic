import { createId } from "@paralleldrive/cuid2";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../../../prisma/generated/client";
import { instagramProfileUrl, type GuestDetails } from "../guest-details-schema";

const TRIP_KEY = "meribel-2027";

type SubmissionTransaction = Pick<Prisma.TransactionClient, "trip" | "guest" | "guestSubmission" | "auditLog">;
type SubmissionDatabase = {
  transaction<T>(operation: (tx: SubmissionTransaction) => Promise<T>): Promise<T>;
  findSubmission(submissionId: string): Promise<{ guestId: string } | null>;
};
type WithSubmissionDatabase = <T>(operation: (db: SubmissionDatabase) => Promise<T>) => Promise<T>;
type Dependencies = { withDatabase?: WithSubmissionDatabase; createId?: () => string; now?: () => Date };

export class GuestDetailsNameMatchError extends Error {
  constructor(readonly matchCount: number) {
    super("The name matches more than one guest. Contact the organizer to update your details.");
  }
}

const withSubmissionDatabase: WithSubmissionDatabase = async (operation) => {
  const connectionString = process.env.DATABASE_URL_POOLED;
  if (!connectionString) throw new Error("DATABASE_URL_POOLED is required for guest details submissions.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 5_000 }) });
  try {
    return await operation({
      transaction: (callback) => db.$transaction((tx) => callback(tx), { maxWait: 10_000, timeout: 20_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
      findSubmission: (submissionId) => db.guestSubmission.findUnique({ where: { submissionId }, select: { guestId: true } }),
    });
  } finally {
    await db.$disconnect();
  }
};

function normalizeName(value: string) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function isPrismaCode(error: unknown, code: string) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

export async function saveGuestDetails(
  { submissionId, details }: { submissionId: string; details: GuestDetails },
  deps: Dependencies = {},
) {
  const create = deps.createId ?? createId;
  const now = deps.now ?? (() => new Date());
  const withDatabase = deps.withDatabase ?? withSubmissionDatabase;
  return withDatabase(async (db) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.transaction(async (tx) => {
          const existingSubmission = await tx.guestSubmission.findUnique({ where: { submissionId }, select: { guestId: true } });
          if (existingSubmission) return { duplicate: true as const, created: false, guestId: existingSubmission.guestId };

          const trip = await tx.trip.findUnique({ where: { seedKey: TRIP_KEY }, select: { id: true } });
          if (!trip) throw new Error("Méribel trip not found.");
          const candidates = await tx.guest.findMany({ where: { tripId: trip.id }, select: { id: true, firstName: true, lastName: true } });
          const firstName = normalizeName(details.firstName);
          const lastName = normalizeName(details.lastName);
          const matches = candidates.filter((guest) => normalizeName(guest.firstName) === firstName && normalizeName(guest.lastName) === lastName);
          if (matches.length > 1) throw new GuestDetailsNameMatchError(matches.length);

          const displayName = `${details.firstName} ${details.lastName}`;
          const data = {
            firstName: details.firstName,
            lastName: details.lastName,
            displayName,
            phone: details.phone,
            venmoHandle: details.venmoHandle,
            instagramUrl: instagramProfileUrl(details.instagramHandle),
            dietaryNotes: details.dietaryNotes,
            favoriteCocktails: details.favoriteCocktails,
          };
          const created = matches.length === 0;
          const guest = created
            ? await tx.guest.create({ data: { id: create(), tripId: trip.id, ...data, status: "CONFIRMED", createdVia: "WEBSITE" }, select: { id: true } })
            : await tx.guest.update({ where: { id: matches[0]!.id }, data, select: { id: true } });
          await tx.guestSubmission.create({ data: { submissionId, source: "website", sourceRef: null, guestId: guest.id, submittedAt: now() } });
          await tx.auditLog.create({ data: {
            id: create(), action: created ? "GUEST_DETAILS_CREATE" : "GUEST_DETAILS_UPDATE", entity: "Guest", entityId: guest.id,
            after: { submissionId, fields: Object.keys(data) }, source: "GUEST",
          } });
          return { duplicate: false as const, created, guestId: guest.id };
        });
      } catch (error) {
        if (isPrismaCode(error, "P2002")) {
          const existing = await db.findSubmission(submissionId);
          if (existing) return { duplicate: true as const, created: false, guestId: existing.guestId };
        }
        if (isPrismaCode(error, "P2034") && attempt < 2) continue;
        throw error;
      }
    }
  });
}
