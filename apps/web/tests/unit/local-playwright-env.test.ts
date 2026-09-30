import { describe, expect, it } from "vitest";
import { assertLoopbackDatabaseUrls } from "../visual/local-env";

describe("local Playwright database guard", () => {
  const local = {
    DATABASE_URL: "postgresql://test:test@127.0.0.1/trip",
    DATABASE_URL_POOLED: "postgresql://test:test@localhost/trip",
  };

  it("accepts loopback database URLs", () => {
    expect(() => assertLoopbackDatabaseUrls(local)).not.toThrow();
  });

  it.each(["DATABASE_URL", "DATABASE_URL_POOLED"] as const)("rejects a remote %s without echoing its value", (key) => {
    expect(() => assertLoopbackDatabaseUrls({
      ...local,
      [key]: "postgresql://secret:secret@db.example.invalid/trip",
    })).toThrow(new RegExp(`^Playwright local acceptance requires ${key} to point to loopback PostgreSQL\\.$`));
  });
});
