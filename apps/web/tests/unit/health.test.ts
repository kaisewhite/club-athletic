import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import routeConfig from "../../app/routes";
import { loader } from "../../app/routes/health";

const healthSource = readFileSync(resolve(import.meta.dirname, "../../app/routes/health.ts"), "utf8");

describe("/health", () => {
  it("is registered at the path the ALB target group probes", () => {
    const entries = routeConfig as Array<{ path?: string; file: string }>;
    const health = entries.find((entry) => entry.path === "health");
    expect(health).toBeDefined();
    expect(health?.file).toBe("routes/health.ts");
  });

  it("answers 200 with an uncacheable JSON body", async () => {
    const response = await loader();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports liveness without leaking anything about the environment", async () => {
    const body = (await (await loader()).json()) as Record<string, unknown>;
    expect(body).toEqual({
      status: "ok",
      service: "club-athletic-web",
      uptime: expect.any(Number),
    });
    expect(body.uptime as number).toBeGreaterThanOrEqual(0);
  });

  it("answers identically in development and in production", async () => {
    const original = process.env.NODE_ENV;
    try {
      for (const mode of ["development", "production"]) {
        process.env.NODE_ENV = mode;
        const response = await loader();
        expect(response.status, mode).toBe(200);
        expect((await response.json()).status, mode).toBe("ok");
      }
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it("stays a pure liveness check — no imports, so no dependency can creep in", () => {
    // The probe runs every 10s against a single task. If someone adds a database
    // or Anthropic call here, this fails and they have to justify it in review.
    const code = healthSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bimport\b/);
    expect(code).not.toMatch(/\brequire\(/);
  });
});
