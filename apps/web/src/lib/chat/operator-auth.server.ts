import { timingSafeEqual } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../prisma/generated/client";
import type { ConversationScope } from "./repository.server";

const AUTH_ACTION = "OPERATOR_AUTHORIZED";

function configuredPassphrase() {
  const value = (process.env.CLUB_ATHLETIC_OPERATOR_PASSPHRASE ?? process.env.PASSPHRASE)?.trim();
  if (!value) throw new Error("An operator passphrase is required for operator authorization.");
  return value;
}

function matches(expected: string, supplied: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function withDatabase<T>(run: (db: PrismaClient) => Promise<T>) {
  const connectionString = process.env.DATABASE_URL_POOLED;
  if (!connectionString) throw new Error("DATABASE_URL_POOLED is required for operator authorization.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 5_000 }) });
  try { return await run(db); } finally { await db.$disconnect(); }
}

export async function isOperatorAuthorized(scope: ConversationScope) {
  return withDatabase(async (db) => !!await db.auditLog.findFirst({
    where: { conversationId: scope.conversationId, action: AUTH_ACTION, entity: "Conversation", entityId: scope.conversationId, source: "ORGANIZER" },
    select: { id: true },
  }));
}

export async function authorizeOperator(scope: ConversationScope, passphrase: string) {
  if (!matches(configuredPassphrase(), passphrase)) return false;
  await withDatabase(async (db) => {
    await db.auditLog.create({ data: {
      id: createId(), action: AUTH_ACTION, entity: "Conversation", entityId: scope.conversationId,
      source: "ORGANIZER", conversationId: scope.conversationId,
      after: { authorized: true },
    } });
  });
  return true;
}
