# Club Athletic web

Standalone Bun **1.4.0** project using React Router 7 framework mode, React 19,
SSR, and a custom Express server. Run every command from this directory:

```sh
cd /Volumes/Sandisk/repositories/kaisewhite/club-athletic/apps/web
bun install
bun run dev
```

Development starts Express at `http://localhost:4173` with Vite middleware and
React Router HMR, and prints `Club Athletic running on http://localhost:<port>`
once it is listening. `PORT` overrides the port; `WEB_PORT` is the reference app's
fallback. Both modes close the HTTP server and any Vite resources on SIGINT/SIGTERM.

On macOS under Bun, `index.ts` sets `CHOKIDAR_USEPOLLING=1` (interval 300ms)
before importing Vite. Bun deadlocks chokidar's native FSEvents backend, which
hangs the watcher the React Router dev plugin starts during Vite config
resolution: `createServer` never resolves, so dev never reaches `listen` and no
port is bound. Polling avoids the native backend. Both variables are only set if
unset, so you can override them, and neither is set in production or off macOS.
Do not replace this with Vite's `server.watch.usePolling` — that configures
Vite's own watcher, not the plugin's, and does not fix the hang.

For a production build and server:

```sh
bun run build
PORT=4317 bun index.ts
# Equivalent startup: PORT=4317 bun run start
```

`start` and direct `bun index.ts` use the production build unless
`NODE_ENV=development` is explicitly set. Production serves `build/client` and
loads the Express handler from `build/server/index.js`. Stop with Ctrl-C.

## Environment

Bun loads this directory's `.env` automatically. The existing file contains real
credentials and is append-only: do not replace it or copy `.env.example` over it.
For a fresh checkout without `.env`, create it using the empty keys in `.env.example`.

| Key | Required value |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `DATABASE_URL` | Direct PostgreSQL URL |
| `DATABASE_URL_POOLED` | Pooled PostgreSQL URL |
| `VAULT_ID` | Managed Agents vault identifier |

The server validates these keys before listening. Errors name the invalid fields
without printing values. No database or Anthropic request is made by this scaffold.
`PORT` is optional and can be passed on the command line; no new `.env` key is needed.

## Checks

```sh
bun run typecheck
bun run lint
bun run test
bun run build
```

Vitest uses the reference app's `unit` (Node) and `dom` (happy-dom) project split.
The unit tests cover environment validation and credential-safe errors. DOM tests
can be added when there is section content; there are no UI components to test yet.
`--passWithNoTests` allows the empty DOM project. Browser tests are deferred until
the actual screens exist.

## Visual regression — the desktop-frozen baseline

TODO §2.15 asks for a locked desktop baseline **before** any mobile work, and §7
makes it the gate: the 1280/1920 baseline must show zero diff on every PR. That is
what lets the mobile pass change components without fear. Decision D19 names
Playwright's `toHaveScreenshot` for it.

```sh
bun run test:visual          # assert against the committed baseline
bun run test:visual:update   # re-record it (see "When to re-record" below)
```

Kept out of `bun run test` on purpose: the vitest `unit`/`dom` suite stays a
three-second loop, and nothing in `tests/visual/` is collected by either project.

`playwright.config.ts` builds the app and starts it in production mode on port
**47317** (`bun run build && NODE_ENV=production PORT=47317 bash scripts/with-env.sh
bun index.ts`) through Playwright's `webServer`, so the baseline photographs the
built assets against the real database. No new environment variable is introduced —
`with-env.sh` supplies the existing one. `reuseExistingServer` is on, so a server you
already have on 47317 is reused; if it predates your last `bun run build` its asset
hashes are stale and every page will fail to hydrate, so restart it.

### What is captured

Ten routes × two widths × two framings = **40 PNGs** in
`tests/visual/__screenshots__/` (the folder name mirrors
`edge/apps/web-platform`). Names are `{page}-{viewport|full}-{project}-{platform}.png`.

- `*-viewport` — 1280×800 and 1920×1080 exactly: the design as a visitor sees it,
  sticky sidebar and sticky composer included.
- `*-full` — the whole document, which is the only coverage below-the-fold content
  (Rooms, Chef, Tasks) gets. `.sidebar { height: 100vh }` stays at its real viewport
  height in these, leaving bare background beside long pages. That is the capture,
  not a design bug.

`{platform}` is in the filename deliberately: pixel output is OS-specific, so these
darwin PNGs are not a Linux baseline. A Linux CI job must record and commit its own
set — Playwright fails on a missing snapshot rather than inventing one.

### How the capture is made deterministic

The hard part, and the whole value: a baseline that diffs every day gets abandoned
within a week. Handled in `tests/visual/prepare.ts` and `playwright.config.ts`:

| Source of drift | How it is settled |
| --- | --- |
| The `{n} days` countdown and the sidebar's `126.` | **Frozen, not masked.** `app/root.tsx`'s loader computes `daysUntil` from the *server* clock, so it arrives already rendered in the SSR markup and embedded in React Router's hydration payload — `page.clock` or a `Date` stub cannot reach it. Instead the two text nodes that print it are overwritten after hydration with the value they held on the capture date (`FROZEN_DAYS_UNTIL`). `daysUntil` is a constant prop for the life of the document, so React never puts the live number back. The glyphs, display font, letter-spacing and accent dot are all still photographed. The test **asserts** the node count it froze (2 on `/`, 1 elsewhere), so if the markup moves this fails loudly instead of silently drifting again. |
| Other date-relative rendering | There is none. Every other date on these pages is a fixed trip date out of the database, formatted with an explicit `timeZone`; the flight status cutoffs in `src/lib/db/flights.ts` compare against trip dates, not `now`. The context still pins `locale: "en-GB"` and `timezoneId: "Europe/Paris"` so the host machine cannot leak in. |
| The `rise` and `blink` animations | `contextOptions.reducedMotion: "reduce"`, which makes `src/styles.css`'s own `prefers-reduced-motion` block switch them off at the source rather than us injecting CSS the real page never sees. `prepare.ts` asserts the media query actually matched. `toHaveScreenshot`'s `animations: "disabled"` is also set, as a backstop for anything added later. |
| Font loading | Every `@font-face` is `font-display: swap`, so an early capture photographs fallback metrics. The capture waits for `document.fonts.status === "loaded"` **and** an explicit `document.fonts.check` for Hanken Grotesk and Maison Neue. |
| Hydration still in flight | Waits until React has stamped `__reactFiber$…` on `.app-shell`. This has to be polled with `page.evaluate`, not `page.waitForFunction` — the latter polls from an isolated world, where a page-set expando is invisible. |
| Images | Waits for every `document.images` entry to be `complete` with a non-zero `naturalWidth` (`/rooms` embeds `public/bedroom-map.png`). |
| Scrollbars | `--hide-scrollbars`. Scrollbar rendering depends on the machine and its OS settings (overlay vs classic, width, "show automatically"), which is pure diff noise. The app's own `.navrow` rule already hides the horizontal ones on the week strip, chip row and suggestions; this covers the document scrollbar. |
| Text rasterisation and colour | `--force-color-profile=srgb`, `--disable-lcd-text`, `--font-render-hinting=none`, `deviceScaleFactor: 1`, `colorScheme: "dark"`, and `workers: 1` (parallel browsers contend for CPU and that shows up as font-raster drift). |
| The chat panel's streaming state | Not frozen — inert. Each test runs in a fresh context with no cookie, so `readConversationSelection` returns `null`, the loader attaches no conversation, and `ChatPanel` subscribes to no SSE stream: zero `/api/` requests fire after load. The composer is photographed in its pre-chat state with an empty draft, nothing focused (`caret: "hide"`, and no element is ever clicked) and a textarea height of exactly 38px, which `useLayoutEffect` derives from the fixed 20px line-height and so does not depend on which font has loaded. |

Nothing is masked. `maxDiffPixels: 0`, so no pixel may differ beyond `threshold`'s
default per-pixel tolerance.

### When to re-record

The one thing deliberately **not** frozen is the trip data itself — the pages render
live rows from Neon, and there is one database. So a genuine content change (a guest
books a flight, a task is ticked, a spot is taken) will diff, correctly. Re-record
with `bun run test:visual:update`, and review the image diff before committing it:
during the mobile pass (§2.15) a desktop diff that is **not** explained by a data
change is the regression this baseline exists to catch.

## Health check

`GET /health` returns `200` with `{"status":"ok","service":"club-athletic-web","uptime":<seconds>}`
and `cache-control: no-store`, in development and in production alike. It is what the
`club-athletic-<stage>-web-tg` target group created by `apps/aws` probes over HTTP
:4173, every 10 seconds with a 5 second timeout.

It is a **process-liveness** check on purpose: `app/routes/health.ts` imports nothing
and touches no database, and a unit test fails if an import ever appears there. The
reasoning, which is the part worth keeping:

- A database probe would add no information. The container applies
  `prisma migrate deploy` **before** `bun run start`, and a failure there aborts
  startup — so a task that is listening has already proved it can reach Postgres with
  a schema matching its code. Reaching this route also means `startChatRuntime()`
  resolved, because `server.listen()` runs after it.
- A database probe would invert the failure. Neon is serverless and its pooler blips.
  The service runs a single task, so one bad probe window deregisters the only target
  and turns a recoverable hiccup into a site-wide 503, or rolls back a good deploy.
- ~8.6k probes a day is Neon compute bought for nothing.

Dependency health is reported by the alarms `apps/aws` creates — database connection
errors, agent failures, target 5xx — which watch real traffic instead of a synthetic
probe.

## Container

`Dockerfile` builds on `public.ecr.aws/mostrom/bun:1.4.0` (do not change that base
image), installs from the committed lockfile, generates the Prisma client, runs
`bun run build` as a gate (`react-router build` + `tsc --noEmit`), exposes `4173`, and
starts with:

```
bunx prisma migrate deploy && bun run start
```

Migrations run at **container start**, never at build time: a build must not be able
to mutate a database, and the image has to stay reproducible. `migrate deploy` takes a
Postgres advisory lock, so the overlapping tasks of a rolling deploy are safe — one
applies, the rest no-op. If it fails, the container exits and never serves, so the app
is never live against a mismatched schema.

`DATABASE_URL` appears as a build `ARG` with a `localhost` placeholder for one reason:
`prisma generate` loads `prisma.config.ts`, which resolves a datasource from it. No
connection is opened. It is blanked again after the build, so the runtime image ships
no datasource of its own. **No secret is ever a build argument** — runtime config
comes from the `club-athletic-<stage>-web` Secrets Manager secret, injected by ECS.

Build and run it locally (skipping the migration step, which needs a real database):

```sh
docker build -t club-athletic-web:local .
docker run --rm -p 4173:4173 --env-file .env club-athletic-web:local sh -c "bun run start"
curl -i http://127.0.0.1:4173/health
```

`docker build` pulls from public ECR. If it fails with `403 Forbidden`, the local
Docker credential has expired — re-authenticate and rebuild:

```sh
aws ecr-public get-login-password --profile mostrom_mgmt --region us-east-1 \
  | docker login --username AWS --password-stdin public.ecr.aws
```

## Deploy

Two scripts, both taking the stage as their only argument. Neither has a default
stage, and neither reads or writes anything outside this directory.

```sh
./scripts/push-secrets.sh <dev|stage|prod>     # .env -> Secrets Manager
./scripts/deploy-local.sh <dev|stage|prod>     # build -> ECR -> force new deployment
```

Push the secret **first**: nothing runtime is baked into the image, so the task cannot
start without it. `DRY_RUN=true ./scripts/push-secrets.sh dev` prints the key names and
value lengths and writes nothing. Values are never printed.

`deploy-local.sh` is a by-hand equivalent of a pipeline's build and deploy stages,
ported from `edge/apps/api/scripts/deploy-local.sh`. It resolves the account with
`aws sts get-caller-identity`, logs in to ECR, builds with **no build-args**, pushes
to `club-athletic-<stage>-web:main`, forces a new deployment of the `web` service on
the `club-athletic-<stage>` cluster, and waits for it to stabilize. It pins
`--platform linux/amd64`, because the task definition declares no `RuntimePlatform`
and so runs as X86_64 — an arm64 image built on Apple Silicon would pull and then die
with an exec format error. `AWS_PROFILE` (`mostrom_mgmt`), `AWS_REGION`
(`us-east-1`), `IMAGE_TAG`, `DESIRED_COUNT` and `PLATFORM` are overridable.

If the pushed image cannot serve `/health`, the service's deployment circuit breaker
rolls back and `aws ecs wait services-stable` fails. That is the intended failure.

## Scaffold layout

- `index.ts`: environment validation, Express/Vite startup, static assets, shutdown.
- `server/app.ts`: React Router Express adapter and virtual server build.
- `app/routes.ts`: `/health`, `/`, `/schedule`, `/flights`, `/shuttle`, `/chalet`, `/rooms`,
  `/spots`, `/chef`, `/tasks`, `/links`, in source navigation order.
- `app/routes/*.tsx`: hardcoded loader stubs and an H2 with a cyan period only.
- `src/styles.css`: local fonts, source palette, shadcn semantic tokens, 860px
  `wide:` breakpoint, radii, global styles, and `rise`/`blink` keyframes.
- `components.json`: shadcn configuration; no shadcn components are installed.
- `src/lib/utils.ts`: shadcn's class-name utility. The `@` alias points to `src`.

The `prebuild` hook generates route types under `.react-router/` before the build
and TypeScript check, including on a fresh checkout. The server render entry uses
React's Web ReadableStream API supported by Bun.
The app owns all dependencies and its Bun lockfile. There is no root package or
workspace. The existing `public/` assets are served locally, including fonts;
there is no Google Fonts request. Navigation, section content, database access,
chat, and agents belong to later tasks.
