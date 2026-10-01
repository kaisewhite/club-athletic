import { afterEach, describe, expect, it, vi } from "vitest";
import { getEurUsdRate } from "../../app/lib/exchange-rates.server";

afterEach(() => vi.unstubAllGlobals());

describe("EUR to USD reference rate", () => {
  it("reads the dated ECB rate", async () => {
    const fetchRate = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ date: "2026-10-01", base: "EUR", quote: "USD", rate: 1.1298 }) });
    vi.stubGlobal("fetch", fetchRate);
    expect(await getEurUsdRate()).toEqual({ date: "2026-10-01", rate: 1.1298 });
    expect(fetchRate).toHaveBeenCalledWith("https://api.frankfurter.dev/v2/providers/ecb/rate/eur/usd", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("never shows a conversion from an invalid or unavailable response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ date: "2026-10-01", base: "USD", quote: "EUR", rate: 1.1298 }) }));
    expect(await getEurUsdRate()).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await getEurUsdRate()).toBeNull();
  });
});
