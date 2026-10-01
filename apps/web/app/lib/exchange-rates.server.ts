export type EurUsdRate = { rate: number; date: string };

// Frankfurter serves the ECB's latest published daily EUR/USD reference rate.
export async function getEurUsdRate(): Promise<EurUsdRate | null> {
  try {
    const response = await fetch("https://api.frankfurter.dev/v2/providers/ecb/rate/eur/usd", {
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    if (!value || typeof value !== "object") return null;
    const { base, quote, rate, date } = value as Record<string, unknown>;
    if (base !== "EUR" || quote !== "USD" || typeof rate !== "number" ||
      !Number.isFinite(rate) || rate <= 0 || typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const observedAt = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(observedAt.getTime()) || observedAt.toISOString().slice(0, 10) !== date) return null;
    return { rate, date };
  } catch {
    return null;
  }
}
