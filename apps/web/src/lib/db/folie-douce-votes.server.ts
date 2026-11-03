import { createId } from "@paralleldrive/cuid2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../prisma/generated/client";
import type { FolieDouceVoteInput } from "../folie-douce-vote-schema";

const TRIP_KEY = "meribel-2027";

function normalizeName(value: string) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export async function saveFolieDouceVote(input: FolieDouceVoteInput) {
  const connectionString = process.env.DATABASE_URL_POOLED;
  if (!connectionString) throw new Error("DATABASE_URL_POOLED is required for La Folie Douce votes.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 5_000 }) });
  try {
    const trip = await db.trip.findUniqueOrThrow({ where: { seedKey: TRIP_KEY }, select: { id: true } });
    const nameKey = [input.firstName, input.lastName].map(normalizeName).filter(Boolean).join(" ");
    await db.folieDouceVote.upsert({
      where: { tripId_nameKey: { tripId: trip.id, nameKey } },
      create: { id: createId(), tripId: trip.id, ...input, nameKey },
      update: { firstName: input.firstName, lastName: input.lastName, choice: input.choice },
    });
  } finally {
    await db.$disconnect();
  }
}
