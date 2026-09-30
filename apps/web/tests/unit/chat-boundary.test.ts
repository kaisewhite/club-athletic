import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ReadDatabase } from "../../src/lib/db/client.server";
import type { ChatReadDatabase, ChatTransaction } from "../../src/lib/db/chat-client.server";

const { disconnect, construct } = vi.hoisted(() => ({disconnect:vi.fn(),construct:vi.fn()}));
vi.mock("@prisma/adapter-pg",()=>({PrismaPg:class{}}));
vi.mock("../../prisma/generated/client",()=>({PrismaClient:class{constructor(){construct();}$disconnect=disconnect;}}));
import { withChatDatabase, withChatReadDatabase } from "../../src/lib/db/chat-client.server";

// Compile-time capability assertions run as part of the mandatory typecheck.
function capabilities(read:ReadDatabase,chat:ChatReadDatabase,write:ChatTransaction) {
  // @ts-expect-error Trip reads expose no create method.
  void read.trip.create;
  // @ts-expect-error Chat reads expose no message mutations.
  void chat.message.create;
  // @ts-expect-error Chat bookkeeping cannot write Flight.
  void write.flight;
}
void capabilities;
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("DATABASE_URL_POOLED","postgresql://trip:fixture@localhost/db");});
afterEach(()=>vi.unstubAllEnvs());
describe("read/write import boundary and client ownership",()=>{
  it.each([withChatDatabase,withChatReadDatabase])("disconnects each owned chat client on success",async withDb=>{
    expect(await withDb(async()=>42)).toBe(42); expect(disconnect).toHaveBeenCalledTimes(1);
  });
  it.each([withChatDatabase,withChatReadDatabase])("disconnects on query/projection failure",async withDb=>{
    await expect(withDb(async()=>{throw new Error("fixture");})).rejects.toThrow("fixture");expect(disconnect).toHaveBeenCalledTimes(1);
  });
  it.each([withChatDatabase,withChatReadDatabase])("fails closed without the one database credential",async withDb=>{
    vi.stubEnv("DATABASE_URL_POOLED","");
    await expect(withDb(async()=>0)).rejects.toThrow("DATABASE_URL_POOLED");expect(construct).not.toHaveBeenCalled();
  });
  it("uses the single trip database credential and no per-role URL",()=>{
    // One database, one role. The boundary is the module split and the capability
    // types below, never a second credential; a reader must not expect roles.
    const sources=["src/lib/db/chat-client.server.ts","src/lib/db/flight-write-client.server.ts","src/lib/db/client.server.ts"]
      .map(path=>readFileSync(resolve(path),"utf8"));
    for(const source of sources){
      expect(source).not.toMatch(/CHAT_(?:READ_|WRITE_)?DATABASE_URL|FLIGHT_WRITE_DATABASE_URL|DIRECT_URL/);
      expect(source).not.toMatch(/distinct database credential|distinct credentials/);
      expect(source).toMatch(/DATABASE_URL_POOLED/);
    }
  });
  it("keeps chat and flight writes in modules the read helpers never import",()=>{
    // The structural boundary that replaced the credential split: writes are
    // reachable only through their own modules, so the import graph shows them.
    const chatWrites=readFileSync(resolve("src/lib/db/chat-writes.server.ts"),"utf8");
    const flightWrites=readFileSync(resolve("src/lib/db/flight-writes.server.ts"),"utf8");
    expect(chatWrites).toMatch(/withChatDatabase/);
    expect(flightWrites).toMatch(/withFlightWriteDatabase|FlightWriteDatabase/);
    for(const reader of ["src/lib/db/repository.server.ts","src/lib/chat/repository.server.ts"])
      expect(readFileSync(resolve(reader),"utf8"),reader).not.toMatch(/chat-writes|flight-writes/);
  });
  it("accepted trip read imports never reach chat or flight write modules",()=>{
    const repository=readFileSync(resolve("src/lib/db/repository.server.ts"),"utf8");
    expect(repository).not.toMatch(/chat-|flight-write|\.create\(|\.update\(|\.delete\(/);
    const chatRead=readFileSync(resolve("src/lib/chat/repository.server.ts"),"utf8");
    expect(chatRead).not.toMatch(/chat-writes|flight-writes|withChatDatabase|\.create\(|\.update\(|\.delete\(/);
    for(const filename of readdirSync(resolve("src/lib/chat")).filter(f=>f.endsWith(".ts")&&!f.endsWith(".server.ts"))){
      const source=readFileSync(resolve("src/lib/chat",filename),"utf8");
      expect(source,filename).not.toMatch(/from\s+["'][^"']*(?:\.server|@prisma|anthropic)/);
    }
  });
});
