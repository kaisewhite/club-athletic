/** D15/Q9: one process, burst 10, one text token per six seconds. No timers. */
export function createTextLimiter(now = Date.now, maxKeys = 10_000, capacity = 10, refillMs = 6_000) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return {
    take(key: string) {
      const at = now();
      for (const [key, value] of buckets) if (at - value.at >= 60_000) buckets.delete(key);
      let bucket = buckets.get(key);
      if (!bucket) {
        if (buckets.size >= maxKeys) return Math.ceil(refillMs / 1000);
        bucket = { tokens: capacity, at }; buckets.set(key, bucket);
      }
      bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, at - bucket.at) / refillMs);
      bucket.at = at;
      if (bucket.tokens < 1) return Math.ceil((1 - bucket.tokens) * refillMs / 1000);
      bucket.tokens--; return 0;
    },
    clear() { buckets.clear(); },
    size: () => buckets.size,
  };
}
