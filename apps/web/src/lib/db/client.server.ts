import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../prisma/generated/client";

/** Narrow capability exposed to the read repository; no mutations are available. */
export type ReadDatabase = {
  trip: Pick<PrismaClient["trip"], "findUniqueOrThrow">;
};

/** Own and close the client even on query/projection failure, including CLI use. */
export async function withReadDatabase<T>(read: (db: ReadDatabase) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL_POOLED;
  if (!connectionString) throw new Error("DATABASE_URL_POOLED is required for trip reads.");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 5_000 }),
  });
  try {
    return await read(db);
  } finally {
    await db.$disconnect();
  }
}
