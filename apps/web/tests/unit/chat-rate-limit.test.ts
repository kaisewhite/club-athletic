import { describe, expect, it } from "vitest";
import { createUploadLimiter } from "../../src/lib/chat/upload-rate-limit.server";
import { createTextLimiter } from "../../src/lib/chat/rate-limit.server";
describe("upload token bucket", () => {
  it("bursts three and refills exactly one per 60 seconds", () => {
    let now = 0; const limiter = createUploadLimiter(() => now);
    expect([limiter.take("a"), limiter.take("a"), limiter.take("a"), limiter.take("a")]).toEqual([0, 0, 0, 60]);
    now = 30_000; expect(limiter.take("a")).toBe(30);
    now = 59_999; expect(limiter.take("a")).toBe(1);
    now = 60_000; expect(limiter.take("a")).toBe(0); expect(limiter.take("a")).toBe(60);
    now = 240_000; expect([limiter.take("a"), limiter.take("a"), limiter.take("a"), limiter.take("a")]).toEqual([0, 0, 0, 60]);
  });
  it("isolates clients, bounds memory without evicting depleted keys, and clears without timers", () => {
    let now = 0; const limiter = createUploadLimiter(() => now, 2);
    expect(limiter.take("a")).toBe(0); expect(limiter.take("b")).toBe(0); expect(limiter.take("c")).toBe(60);
    now = 180_000; expect(limiter.take("c")).toBe(0); expect(limiter.size()).toBe(1);
    limiter.clear(); expect(limiter.size()).toBe(0);
  });
  it("does not give tokens for a backwards clock", () => {
    let now = 60_000; const limiter = createUploadLimiter(() => now);
    limiter.take("a"); limiter.take("a"); limiter.take("a"); now = 0;
    expect(limiter.take("a")).toBe(60); now = 60_000; expect(limiter.take("a")).toBe(60);
  });
  it("leaves the accepted text bucket at ten with a six-second refill", () => {
    let now = 0; const text = createTextLimiter(() => now);
    for (let i = 0; i < 10; i++) expect(text.take("a")).toBe(0);
    expect(text.take("a")).toBe(6); now = 6000; expect(text.take("a")).toBe(0);
  });
});
