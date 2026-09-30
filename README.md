# club-athletic

A single-page trip hub for one group ski trip: **Méribel (Les 3 Vallées), France —
Chalet Falcon Lodge F, Sat 30 Jan → Sat 6 Feb 2027**. Ten pages of trip facts
(schedule, flights, shuttle, chalet, rooms, spots & pricing, chef, tasks, links)
plus an AI concierge that answers questions from the trip database and can record
a guest's flight from an uploaded booking screenshot.

There is **no authentication**. It is an unlisted link shared with the group, and
that is the whole access model — do not put anything in it you would not hand to
everyone on the trip.

## Not a monorepo

`apps/` holds three standalone projects. Each has its own `package.json`,
lockfile, `node_modules/` and `tsconfig.json`, and you install and run inside
that app's directory:

| app | what it is | install |
| --- | --- | --- |
| `apps/web` | the site: React Router v7 (framework mode) on Bun, Prisma → Neon Postgres, the chat runtime, the ten pages | `cd apps/web && bun install` |
| `apps/managed-agents` | the trip agent, its cloud environment and its memory store, as YAML applied with the `ant` CLI | `cd apps/managed-agents && bun install` |
| `apps/aws` | CDK: ECS Fargate behind the production ALB owned by the `edge` repo | `cd apps/aws && bun install` |

**There is no root `package.json`, and there must never be one.** No workspaces,
no root lockfile, no cross-app imports. All three apps are Bun projects
(`bun.lock`; `apps/web` pins `bun@1.4.0` in `packageManager` and `engines`);
`apps/aws` uses Bun for the CDK CLI.

## apps/web

React Router 7.18 in framework mode (`react-router.config.ts` is just
`{ ssr: true }`), React 19, Tailwind 4 via `@tailwindcss/vite`, Prisma 7 with the
`@prisma/adapter-pg` driver adapter. `index.ts` is the entry point for both
modes: Express 5 + `node:http`, Vite middleware in development, the built
`build/server/index.js` in production. It starts the chat runtime before it
listens and stops it on `SIGINT`/`SIGTERM`.

Routes: `/` plus `/schedule`, `/flights`, `/shuttle`, `/chalet`, `/rooms`,
`/spots`, `/chef`, `/tasks`, `/links` (ten pages), `/health`, and seven
`/api/chat/*` resource routes for conversations, messages, SSE stream, status,
cancel and uploads.

```sh
cd apps/web
bun install
bun run db:generate        # prisma generate
bun run db:migrate:deploy  # apply migrations
bun run db:seed            # insert the Méribel snapshot (existing rows preserved)
bun run dev                # development, port 4173
```

| script | what it does |
| --- | --- |
| `bun run dev` | `NODE_ENV=development bun --watch index.ts` — Vite middleware, HMR |
| `bun run build` | `react-router build && tsc --noEmit` |
| `bun run start` | `bun index.ts` — serves the build; needs `bun run build` first |
| `bun run typecheck` | `react-router typegen && tsc --noEmit` |
| `bun run lint` | oxlint over `app src server tests` and the config files |
| `bun run test` | vitest: the `unit` project (node) and `dom` project (happy-dom) |
| `bun run test:visual` | Playwright: the desktop baseline and the mobile-layout assertions |
| `bun run test:visual:update` | re-records the baseline PNGs — a diff is a bug, so do not reach for this |
| `bun run db:generate` / `db:migrate:deploy` / `db:migrate:dev` / `db:seed` / `db:studio` | Prisma, each wrapped in `scripts/with-env.sh` |

`PORT` defaults to **4173** (`WEB_PORT` is accepted as a fallback).

### `scripts/with-env.sh`

Every `db:*` script runs through it. It loads `apps/web/.env` (override with
`CLUB_ATHLETIC_WEB_ENV_FILE`), exports the keys and `exec`s your command from the
`apps/web` directory. The file is parsed as data, never sourced, so a stray
backtick in a secret cannot execute; malformed lines fail the run rather than
being skipped, and AWS credential keys are on a deny-list that is never exported.
Use it for any ad-hoc Prisma command too:

```sh
bash scripts/with-env.sh bunx prisma migrate status
```

### Why dev sets `CHOKIDAR_USEPOLLING`

`index.ts` sets `CHOKIDAR_USEPOLLING=1` and `CHOKIDAR_INTERVAL=300` (only if
unset, only in development, only on macOS under Bun) *before* Vite is imported.
Bun on macOS deadlocks chokidar's native FSEvents backend: the watcher the React
Router dev plugin starts inside Vite's `configResolved` never settles, so
`createViteServer` never resolves and **the dev server hangs before it ever
listens**. Vite's own `server.watch.usePolling` does not help — it configures a
different watcher than the plugin's. This is not an environment variable you set;
it is not read in production or off macOS.

### Tests

- `tests/unit/` — node: the chat runtime, tools, flight intake, repositories,
  projections, env schema, and `mobile-css-convention.test.ts`, which mechanically
  enforces that mobile CSS stays inside `@media (max-width: 859px)` and that JS
  and CSS switch on the same 860px seam.
- `tests/components/`, `tests/routes/` — happy-dom: chat UI, attachments, the
  route loaders and the app shell's SSR/hydration behaviour.
- `tests/visual/` — Playwright (chromium, 1 worker, `maxDiffPixels: 0`) on its own
  port 47317 against a production build: `desktop-frozen.spec.ts` photographs the
  ten real routes at 1280 and 1920, viewport and full page — **40 baseline PNGs in
  `tests/visual/__screenshots__/`, and a single changed pixel is a bug, not a new
  baseline**. `mobile-layout.spec.ts` asserts the mobile rules at seven widths
  including 859 and 860.

The desktop layout at ≥860px is frozen by that baseline. `src/styles.css` carries
the convention in a banner comment: mobile work goes in `max-width: 859px`
overrides, never into a base style, a token, or a component's desktop branch.

## apps/managed-agents

The concierge as declarative files: `agents/trip-concierge.agent.yaml` (model
`claude-opus-5`, effort `high`, and the system prompt),
`environments/default.environment.yaml` (cloud, `networking: limited`, no allowed
hosts, no package managers), `memory-store.yaml`, and the seed facts in
`memory/*.txt` — one memory per file.

Applied with Anthropic's **`ant` CLI**, which must be on your `PATH`.

```sh
cd apps/managed-agents
bun install
bun run check                                   # lint + typecheck + tests
bun run validate                                # parse and check the YAML
bun run deploy                                  # PREVIEW ONLY — applies nothing
bun --env-file .env scripts/deploy.ts all --apply --create   # first provisioning
bun --env-file .env scripts/deploy.ts all --apply            # update in place
```

`deploy` previews by default and never creates a session. Resource ids are cached
in the ignored `scripts/.state/`. `OPERATIONS.md` covers memory deletion and
redaction, which stay manual.

## apps/aws

Club Athletic's production web service runs in production account `736548610362`
(`mostrom_prod`) on Edge's existing ECS cluster and HTTPS load balancer. CDK
creates the Club Athletic ECS service and target group in that account, imports
Edge's VPC, cluster, and HTTPS listener, and adds the host rule for
`meribel.xn--tshi-l3a.com`. Edge's production infrastructure supplies the ALB
and TLS certificate.

The domain's public hosted zone is in the management account. DNS records there
are managed manually and point the Club Athletic hostname to Edge's existing
production ALB. CDK does not create or update Route 53 records. Club Athletic
has no management-account ECS service, ALB, ACM certificate, or deployment
pipeline.

```sh
cd apps/aws
bun install
cdk synth --profile mostrom_prod
cdk deploy InfraStack --profile mostrom_prod --require-approval never
```

Synthesis with `mostrom_mgmt` is rejected. This CDK app creates no ALB, ACM
certificate, Route 53 record, or CodePipeline. The existing
`club-athletic-web` production secret supplies runtime configuration.

## Environment

`apps/web/.env` (see `.env.example`). Exactly seven keys — adding an eighth has
been ruled out, so if something needs configuring, derive it or hard-code it.
**Never print a value**, in a script, a log line or a commit.

| key | required | what it is |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | Anthropic API key for the concierge and flight extraction |
| `VAULT_ID` | no | present in `.env` and `.env.example` but **read by no code**; a leftover, not a knob |
| `DATABASE_URL` | yes | direct (unpooled) Neon URL — Prisma CLI, migrations, seed |
| `DATABASE_URL_POOLED` | yes | pooled Neon URL — every runtime query via `@prisma/adapter-pg` |
| `CLAUDE_MANAGED_ENVIRONMENT_ID` | yes | the managed environment the agent runs in |
| `CLAUDE_TRIP_AGENT_ID` | yes | the deployed trip agent |
| `CLAUDE_TRIP_MEMORY_STORE_ID` | no | the memory store; unset means the agent answers from its tools only |

There is **one Neon database and no database roles** — the two URLs are the
pooled and direct endpoints of the same database, not two environments and not
two users.

## Deploy

Club Athletic has no `main`-branch CodePipeline. Its CDK stack and deployment
target are in Edge's production account and reuse Edge's existing ALB listener.
Domain DNS remains a manual change in the Route 53 management account.

The container itself (`apps/web/Dockerfile`, Bun 1.4.0, `EXPOSE 4173`) runs
`bunx prisma migrate deploy && bun run start`, so a deploy migrates before it
serves.
