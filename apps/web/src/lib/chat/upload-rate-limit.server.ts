/** Separate D15 upload bucket: burst 3, refill one token per 60 seconds.
 * Bounded keys, no timers; never evict a partially depleted bucket early. */
export function createUploadLimiter(now = Date.now, maxKeys = 10_000) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return {
    take(key: string) {
      const at = now();
      for (const [id, value] of buckets) if (at - value.at >= 180_000) buckets.delete(id);
      let bucket = buckets.get(key);
      if (!bucket) {
        if (buckets.size >= maxKeys) return 60;
        bucket = { tokens: 3, at }; buckets.set(key, bucket);
      }
      bucket.tokens = Math.min(3, bucket.tokens + Math.max(0, at - bucket.at) / 60_000);
      bucket.at = Math.max(at, bucket.at);
      if (bucket.tokens < 1) return Math.ceil((1 - bucket.tokens) * 60);
      bucket.tokens--; return 0;
    },
    clear() { buckets.clear(); },
    size: () => buckets.size,
  };
}
