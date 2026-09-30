import { describe, expect, it } from "vitest";
import { loadEnv } from "../../server/env";

const valid = {
  ANTHROPIC_API_KEY: "test-key",
  DATABASE_URL: "postgresql://test:test@localhost/trip",
  DATABASE_URL_POOLED: "postgres://test:test@localhost/trip",
};

describe("boot environment", () => {
  it("loads the three required keys and the edge default port", () => {
    expect(loadEnv(valid)).toEqual({ ...valid, PORT: 4173 });
    expect(loadEnv({ ...valid, PORT: "4317", WEB_PORT: "4318" }).PORT).toBe(4317);
    expect(loadEnv({ ...valid, WEB_PORT: "4318" }).PORT).toBe(4318);
  });

  it.each(Object.keys(valid))("rejects a missing %s", (key) => {
    expect(() => loadEnv({ ...valid, [key]: undefined })).toThrow(key);
  });

  it("reports invalid field names without leaking credential values", () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: "https://secret:password@host" }))
      .toThrow(/^Invalid or missing environment variables: DATABASE_URL$/);
    expect(() => loadEnv({ ...valid, DATABASE_URL: "not-a-url-with-secret" }))
      .toThrow(/^Invalid or missing environment variables: DATABASE_URL$/);
  });

  it.each(["", "abc", "0", "65536", "4317.5"])("rejects invalid PORT %j", (PORT) => {
    expect(() => loadEnv({ ...valid, PORT })).toThrow("PORT");
  });
});
