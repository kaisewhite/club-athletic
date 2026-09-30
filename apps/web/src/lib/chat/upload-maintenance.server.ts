import { cleanupExpiredUploads, withUploadDeadline } from "./upload.server";

/** Owned by the existing server start/stop lifecycle. No timer starts on import.
 * Pending attachments become unusable at 24h; each minute reclaims one expired
 * provider resource and its two copies. Failed deletion stays eligible for retry. */
export function createUploadMaintenance(cleanup: (signal: AbortSignal) => Promise<void>, intervalMs = 60_000) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let controller: AbortController | undefined;
  let pending: Promise<void> | undefined;
  const poll = () => {
    if (pending || !controller || controller.signal.aborted) return;
    pending = withUploadDeadline(controller.signal, 30_000, cleanup)
      .catch(() => { /* Retain row identities for the next bounded retry. */ })
      .finally(() => { pending = undefined; });
  };
  return {
    start() {
      if (controller) return;
      controller = new AbortController();
      timer = setInterval(poll, intervalMs); timer.unref?.();
      poll();
    },
    async stop() {
      if (timer) clearInterval(timer); timer = undefined;
      controller?.abort();
      await pending;
      controller = undefined;
    },
  };
}
const maintenance = createUploadMaintenance(cleanupExpiredUploads);
export const startUploadMaintenance = () => maintenance.start();
export const stopUploadMaintenance = () => maintenance.stop();
