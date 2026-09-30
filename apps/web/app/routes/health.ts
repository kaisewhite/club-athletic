/**
 * ALB target-group health check.
 *
 * `apps/aws` points `club-athletic-<stage>-web-tg` at `/health` over HTTP :4173
 * and probes it every 10 seconds with a 5 second timeout, so this has to be cheap
 * — and it still has to mean something.
 *
 * It is deliberately a process-liveness check: no database round-trip, no
 * Anthropic call, not even a cached dependency probe. Three reasons, in order:
 *
 *  1. A database probe would add no information. The container's CMD runs
 *     `prisma migrate deploy` before `bun run start`, and that step aborts
 *     startup on failure. A task that is listening at all has therefore already
 *     proved it can reach Postgres and that its schema matches this code. On top
 *     of that, `server.listen()` only happens after `startChatRuntime()` resolves
 *     (see index.ts), so reaching this route means the boot sequence completed.
 *  2. A dependency probe would invert the failure. Neon is serverless and the
 *     pooler blips. The service runs a single task, so one bad probe window
 *     deregisters the only target and turns a recoverable database hiccup into a
 *     hard 503 for the entire site — or rolls back a deploy that was fine.
 *  3. Cost. One probe every 10 seconds, forever, is ~8.6k probes a day. A query
 *     per probe is Neon compute bought for nothing.
 *
 * So the 200 here claims exactly one thing, truthfully: this process booted and
 * can serve a request. Dependency health is reported where it belongs — the
 * alarms `apps/aws` creates for database connection errors, agent failures and
 * target 5xx, which observe real traffic rather than synthetic probes.
 *
 * Returning 200 while the app is unusable would be worse than failing, so if the
 * server cannot serve at all the probe gets no response and fails on its own.
 */
export function loader() {
  return Response.json(
    { status: "ok", service: "club-athletic-web", uptime: Math.round(process.uptime()) },
    { headers: { "cache-control": "no-store" } },
  );
}
