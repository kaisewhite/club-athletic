/** Edge's 30s confirmation deadline, now cancellable and drainable. */
export function createStopConfirmationTimeouts() {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Set<Promise<void>>();
  const clear = (id: string) => { const timer = timers.get(id); if (timer) clearTimeout(timer); timers.delete(id); };
  return {
    clear,
    schedule(id: string, check: () => Promise<void>) {
      clear(id);
      const timer = setTimeout(() => {
        timers.delete(id);
        const task = check().catch(() => {}).finally(() => pending.delete(task)); pending.add(task);
      }, 30_000);
      timer.unref?.(); timers.set(id, timer);
    },
    count: () => timers.size,
    async stop() { for (const id of timers.keys()) clear(id); await Promise.allSettled(pending); },
  };
}
