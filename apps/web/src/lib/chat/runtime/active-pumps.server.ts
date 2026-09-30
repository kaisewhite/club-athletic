/** Edge's single-owner registry, with owned aborts and awaited shutdown. */
export function createPumpRegistry() {
  const pumps = new Map<string, { abort: AbortController; done: Promise<void> }>();
  let stopping = false;
  return {
    has: (id: string) => pumps.has(id),
    count: () => pumps.size,
    start(id: string, run: (signal: AbortSignal) => Promise<void>, afterRelease?: () => Promise<void>) {
      if (stopping || pumps.has(id)) return false;
      const abort = new AbortController();
      const entry = { abort, done: Promise.resolve() };
      pumps.set(id, entry);
      entry.done = Promise.resolve().then(() => run(abort.signal)).catch(() => {}).finally(async () => {
        abort.abort();
        if (pumps.get(id) === entry) pumps.delete(id);
        if (!stopping) await afterRelease?.().catch(() => {});
      });
      return true;
    },
    async stop() {
      stopping = true;
      for (const entry of pumps.values()) entry.abort.abort();
      await Promise.allSettled([...pumps.values()].map(entry => entry.done));
    },
  };
}
const processState = globalThis as typeof globalThis & { __clubAthleticPumps?: ReturnType<typeof createPumpRegistry> };
export const activePumps = processState.__clubAthleticPumps ??= createPumpRegistry();

/** Abortable owned backoff. Clears both the timer and listener on every exit. */
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(signal.reason); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
