import { afterEach, describe, expect, it, vi } from "vitest";
import { createUploadMaintenance } from "../../src/lib/chat/upload-maintenance.server";
afterEach(() => { expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); });
describe("upload expiry maintenance lifetime", () => {
  it("starts once, retries failures, and removes timers/controllers on stop", async () => {
    vi.useFakeTimers(); const signals: AbortSignal[] = [];
    const cleanup = vi.fn(async (signal: AbortSignal) => { signals.push(signal); throw new Error("retry"); });
    const maintenance = createUploadMaintenance(cleanup);
    try {
      maintenance.start(); maintenance.start();
      await vi.advanceTimersByTimeAsync(60_000); expect(cleanup).toHaveBeenCalledTimes(2);
    } finally { await maintenance.stop(); }
    expect(signals.every(signal => signal.aborted)).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000); expect(cleanup).toHaveBeenCalledTimes(2);
  });
  it("never overlaps cleanup and aborts/awaits an active sweep during shutdown", async () => {
    vi.useFakeTimers(); let finished = false;
    const cleanup = vi.fn((signal: AbortSignal) => new Promise<void>(resolve => {
      const abort = () => { signal.removeEventListener("abort", abort); finished = true; resolve(); };
      signal.addEventListener("abort", abort, { once: true });
    }));
    const maintenance = createUploadMaintenance(cleanup, 1000);
    try {
      maintenance.start(); await vi.advanceTimersByTimeAsync(5000); expect(cleanup).toHaveBeenCalledTimes(1);
    } finally { await maintenance.stop(); }
    expect(finished).toBe(true);
  });
});
