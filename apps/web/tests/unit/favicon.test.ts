import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import routeConfig from "../../app/routes";
import { loader as robotsLoader } from "../../app/routes/robots";

const web = (path: string) => resolve(import.meta.dirname, "../..", path);
const rootSource = readFileSync(web("app/root.tsx"), "utf8");

describe("favicon", () => {
  it("exists as a real asset under public/, so /favicon.svg is served statically", () => {
    // Dev serves public/ through Vite; production copies it into build/client and
    // `index.ts` serves that with express.static. Either way the file must exist.
    const stats = statSync(web("public/favicon.svg"));
    expect(stats.isFile()).toBe(true);
    expect(stats.size).toBeGreaterThan(0);
    // A favicon is requested on every cold visit; keep it inline-small.
    expect(stats.size).toBeLessThan(2048);
  });

  it("is a valid standalone SVG carrying the brand mark colours", () => {
    const svg = readFileSync(web("public/favicon.svg"), "utf8");
    expect(svg).toMatch(/^<svg\s/);
    expect(svg.trimEnd()).toMatch(/<\/svg>$/);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("viewBox=");
    // `.brand-mark` in src/styles.css: accent tile, page-background glyph.
    expect(svg.toLowerCase()).toContain("#75cee1");
    expect(svg.toLowerCase()).toContain("#0f0f0e");
    // No external references — a favicon must resolve with no further requests.
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it("is declared in root.tsx, which is what stops browsers probing /favicon.ico", () => {
    expect(rootSource).toMatch(/<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="\/favicon\.svg"\s*\/>/);
  });

  it("points at a path that exists — the href and the file cannot drift apart", () => {
    const href = /href="(\/favicon[^"]*)"/.exec(rootSource)?.[1];
    expect(href).toBe("/favicon.svg");
    expect(statSync(web(`public${href}`)).isFile()).toBe(true);
  });
});

describe("/robots.txt", () => {
  it("is registered as a real route rather than falling through to a 404", () => {
    const entries = routeConfig as Array<{ path?: string; file: string }>;
    const robots = entries.find((entry) => entry.path === "robots.txt");
    expect(robots).toBeDefined();
    expect(robots?.file).toBe("routes/robots.ts");
  });

  it("asks every crawler not to index this unlisted trip page", async () => {
    const response = robotsLoader();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const body = await response.text();
    expect(body).toBe("User-agent: *\nDisallow: /\n");
  });
});
