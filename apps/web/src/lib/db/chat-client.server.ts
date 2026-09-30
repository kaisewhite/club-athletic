import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../../../prisma/generated/client";

/** One database, one credential. The boundary here is the capability type, not a
 * role: chat bookkeeping cannot reach Flight and chat reads expose no mutation,
 * and the write helpers live in their own modules so the import graph shows it. */
export type ChatTransaction = Pick<Prisma.TransactionClient, "conversation" | "message" | "upload" | "pendingExtraction" | "$queryRaw">;
export type ChatDatabase = ChatTransaction & {
  $transaction<T>(run: (tx: ChatTransaction) => Promise<T>): Promise<T>;
};
export type ChatReadDatabase = {
  conversation: Pick<PrismaClient["conversation"], "findFirst" | "findMany">;
  message: Pick<PrismaClient["message"], "findFirst" | "findMany">;
  upload: Pick<PrismaClient["upload"], "findFirst">;
  pendingExtraction: Pick<PrismaClient["pendingExtraction"], "findFirst">;
};

async function withClient<T>(run: (db: PrismaClient) => Promise<T>): Promise<T> {
  // The same pooled connection the accepted trip read helper uses.
  const connectionString = process.env.DATABASE_URL_POOLED;
  if (!connectionString) throw new Error("DATABASE_URL_POOLED is required for chat database access.");
  const db = new PrismaClient({adapter: new PrismaPg({connectionString, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 5_000})});
  try { return await run(db); } finally { await db.$disconnect(); }
}
export function withChatDatabase<T>(write: (db: ChatDatabase) => Promise<T>): Promise<T> {
  return withClient(write);
}
export function withChatReadDatabase<T>(read: (db: ChatReadDatabase) => Promise<T>): Promise<T> {
  return withClient(read);
}
