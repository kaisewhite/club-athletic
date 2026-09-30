# Agent and test-suite evidence audit — 2026-09-29

The browser failure had two separate causes. Anthropic rejected session creation while the project's API usage limit was reached; a fresh production request returned 503 and the server recorded Anthropic's exact limit response. After the limit was raised, a real session answered the landing question, called `getFlightRules`, and persisted the 09:30 answer. Suggestion buttons also stopped accepting clicks during an active answer even though the server supports queued messages. A browser test reproduced that disabled button before the UI change and passed afterward. A later live check caught a wrong departure-coach answer: the model treated a UTC database instant as local time. The shuttle tool now supplies the local date and clock time explicitly.

## Test inventory

Inventory was taken with `vitest list --json --project unit --project dom`, `playwright test --list`, and `playwright test --config playwright.live.config.ts --list`. Counts include parameterized cases. Paths in the tables are relative to `apps/web/tests/`. A means a real runtime boundary is exercised, B means isolated unit or component behavior only, and C means the test can be mistaken for workflow evidence because its database, provider, network, or browser behavior is fabricated. Mixed rows give the exact split. An A classification is limited to the boundary named in the scope; it does not imply the entire agent works.

| File | Cases | Scope and evidence | Class |
| --- | ---: | --- | --- |
| `components/chat-attachment-flow.test.tsx` | 3 | Attachment/send flow with mocked chat API | C |
| `components/chat-attachment.test.tsx` | 14 | Local selection and validation in Happy DOM | B |
| `components/chat.test.tsx` | 32 | Chat send, stream, retry, and presentation with mocked API/frames | C |
| `components/dietary-cell.test.tsx` | 3 | Local editor behavior in Happy DOM | B |
| `routes/chat-overview.test.tsx` | 7 | Selected conversation and loader with mocked data/API | C |
| `routes/detail-pages.test.tsx` | 9 | Route markup from a fabricated trip database result | C |
| `routes/flights.test.tsx` | 8 | Flight page markup from mocked repository calls | C |
| `routes/trip-pages.test.tsx` | 2 | Homepage/FAQ from mocked repository calls | C |
| `unit/chat-bookkeeping.test.ts` | 15 | Reservation and ownership logic against a fake transaction | B |
| `unit/chat-boundary.test.ts` | 9 | Import and client lifetime boundaries | B |
| `unit/chat-contracts.test.ts` | 5 | Wire serialization and cursors | B |
| `unit/chat-persistence.test.ts` | 10 | Row allocation and lifecycle rules against a fake transaction | B |
| `unit/chat-projection.test.ts` | 10 | Event projection | B |
| `unit/chat-rate-limit.test.ts` | 4 | Token bucket arithmetic | B |
| `unit/chat-repository.test.ts` | 15 | Read query shapes with fake client results | B |
| `unit/chat-resource-routes.test.ts` | 14 | SSE route/recovery logic with fake runtime and repository | B |
| `unit/chat-runtime.test.ts` | 36 | Pump and state logic with fake provider; one test only asserts its fixture's shape | 35 B, 1 C |
| `unit/chat-sources.test.ts` | 8 | Source parsing | B |
| `unit/chat-sse-client.test.ts` | 21 | Browser protocol parsing with controlled fetch/streams | B |
| `unit/chat-tool-boundary.test.ts` | 7 | Static read/write boundary checks | B |
| `unit/chat-tool-factories.test.ts` | 6 | SDK request construction with mocked SDK | B |
| `unit/chat-tool-runner.test.ts` | 11 | Runner cancellation and lifetime with fake provider | B |
| `unit/chat-tools.test.ts` | 12 | Registry/schema and tool logic with fake database | B |
| `unit/chat-turn-continuity.test.ts` | 7 | Pump ordering with synthetic provider events | B |
| `unit/chat-upload-maintenance.test.ts` | 2 | Maintenance timer logic with fake cleanup | B |
| `unit/chat-upload-provider.test.ts` | 4 | SDK upload request shapes with mocked SDK | B |
| `unit/chat-upload-route.test.ts` | 17 | Request parsing and listener cleanup with fake provider | B |
| `unit/chat-upload.test.ts` | 27 | Two cases execute native Bun image processing on real bytes; remaining upload/provider/storage paths are harnessed | 2 A, 25 B |
| `unit/env.test.ts` | 10 | Environment parsing | B |
| `unit/favicon.test.ts` | 6 | Asset and SVG checks without HTTP serving | B |
| `unit/flight-intake.test.ts` | 25 | Consent state machine against in-memory tables | B |
| `unit/flight-writes.test.ts` | 72 | Flight mutation rules against fake transactions | B |
| `unit/flights.test.ts` | 28 | Flight projection with supplied cutoff fixtures | B |
| `unit/guest-writes.test.ts` | 2 | Dietary write rules against fake transaction | B |
| `unit/health.test.ts` | 5 | Route config and direct loader response, without a running server | B |
| `unit/managed-agents-client.test.ts` | 1 | SDK retry option with mocked SDK | B |
| `unit/mobile-css-convention.test.ts` | 17 | Static stylesheet conventions, not rendered layout | B |
| `unit/projections.test.ts` | 7 | Section count projections | B |
| `unit/public-frame-redaction.test.ts` | 5 | Secret redaction | B |
| `unit/read-client.test.ts` | 3 | Client close semantics with mock client | B |
| `unit/repository.test.ts` | 16 | Repository projections from mocked rows; one test calls its fabricated rows “the seed” | 15 B, 1 C |
| `unit/schedule-display.test.ts` | 7 | Day display projection | B |
| `unit/server-error-logging.test.ts` | 8 | Error logging classification | B |
| `visual/desktop-frozen.spec.ts` | 22 | Real production pages in Chromium, compared with visual baselines; visual evidence only | A |
| `visual/mobile-layout.spec.ts` | 196 listed, 98 one-project cases | Real production page geometry at seven widths; the second project is deliberately skipped | A for the one-project cases |
| `visual/mobile-tables.spec.ts` | 36 listed, 18 one-project cases | Real production table layouts; the second project is deliberately skipped | A for the one-project cases |
| `live/chat-agent.spec.ts` | 4 | Real Chromium → production app → Anthropic session → trip tool/database → persisted answer/reload, including queued suggestions, mobile typed send, and departure shuttle time | A |
| `integration/live-trip-read-tools.ts` | 1 script, 13 tools | Every registered trip read tool executes against the configured database, with no mocks | A |

`integration/chat-image.ts` is a support harness invoked by the two native image cases, not a separately discovered test. `fixtures/`, `visual/prepare.ts`, and screenshot PNGs are support data, not additional tests. The 116 second-project visual entries are listed by Playwright but skipped by each suite's project guard; some one-project visual cases also skip when their condition does not apply at 860px.

## Findings and refactor plan

The four new live browser tests exercise provider-backed answers for a greeting, the landing cutoff, an availability question, queued follow-ups, and the departure shuttle pickup. The landing and availability turns recorded successful read-tool calls; the landing answer survived a browser reload. The separate database script successfully ran all 13 registered read tools and checks the local 04:00 shuttle pickup as well as the flight cutoffs. These are the workflow claims supported by current real evidence. The 465 B cases check isolated behavior only and must not be cited as proof that a deployed agent can answer.

The deployed managed agent was retrieved from Anthropic: it is the dedicated trip concierge, with no multiagent roster. Its original version 3 system text lacked `getFlightRules`, and five of ten remote memory files diverged from the checked-in trip facts, including the shuttle and flight times. The web app supplies its full instructions as a session override, but those remote memories still needed reconciliation. The managed-agent deployment updated the five divergent memories and saved agent version 4. A fresh SDK read confirmed the deployed system text equals `TRIP_AGENT_INSTRUCTIONS`, includes `getFlightRules`, and all ten remote memory contents match the checked-in seeds. This drift was distinct from the API-limit 503.

The departure-shuttle live test then showed that synchronized memories alone could not prevent a wrong answer when the database tool supplied `2027-02-06T03:00:00.000Z` without a local clock field. The shuttle page rendered that instant correctly as 04:00 in Paris. Both `getShuttles` and the overview's embedded shuttle rows now project a local date, local window start/end, and the trip's timezone, omitting the raw UTC instant from their model-facing results. The direct database script caught the missing local fields before the fix and passed afterward for both tool paths.

The 61 C cases in the six mocked DOM files remain useful for local rendering/state checks. Downgrade their claims to component behavior, and replace any claim about actual send, reload, provider, database, or route behavior with real browser tests. In particular, `components/chat-attachment-flow.test.tsx` needs a real provider upload test; `routes/detail-pages.test.tsx`, `routes/flights.test.tsx`, and `routes/trip-pages.test.tsx` need real page/database checks before their fixture counts can support trip-data claims. The new live chat tests replace the core send/reload claims in `components/chat.test.tsx` and `routes/chat-overview.test.tsx`, but those mocked cases remain classified C until their names/scope are narrowed.

Remove the fixture-shape assertion in `unit/chat-runtime.test.ts`, since it verifies its own input. Replace the “seed” claim in the first `unit/repository.test.ts` case with a direct database check, or rename it as a projection test using supplied rows. The pure `unit/flights.test.ts` fixture still uses the older 08:30 arrival cutoff and 11:00 return cutoff; the live trip database now says 09:30 and 10:00. That fixture is valid for projection arithmetic only and must not be presented as current trip policy. `routes/chat-overview.test.tsx` likewise contains old numbers in mocked data.

The former `visual/mobile-layout.spec.ts` typed-send test returned a fabricated 201 from `page.route`. It was removed after the new live mobile browser test covered the same focus behavior using a real provider-backed request. No existing useful isolated unit test was removed.

## Coverage gaps and counts

The read-only question flow now has direct database checks and representative real agent/browser coverage. Full agent feature coverage still needs real attachment upload/mount, flight intake through consent and commit against an isolated test trip, cancellation, and process restart/recovery tests. These are four distinct new integration workflows; the existing mocked cases cannot supply their evidence. The live tests use the configured Anthropic project and database and will fail when either external service is unavailable.

At this inventory point, Vitest lists 530 cases, the visual runner lists 254, the live runner lists 4, and the direct tool script is one executable check: **789 listed entries**. Of these, 116 are duplicate visual project entries that deliberately skip, leaving **673 one-project cases/checks**: 145 A, 465 B, and 63 C by the classifications above. This change removes one mocked visual test declaration (14 previously listed parameter/project entries), adds four live browser cases and one database script, and does not yet downgrade or remove the remaining C cases. Four further integration workflows remain required for full agent feature coverage.

The final production-backed live suite passed all four browser cases, and the direct database script passed all 13 tool calls after the timezone fix. `bun run test` passed 530/530, `bun run build` and `bun run typecheck` passed, and `bun run lint` passed with 14 warnings in pre-existing files. A temporary experimental Oxlint plugin was subsequently removed because it made the repository lint command fail on thousands of unrelated existing findings; the diagnostic snapshot is retained in `evidence/2026-09-29-mobile-tables/lint-findings.json` for a separate migration. A fresh dev-browser load on port 4173 hydrated without page errors or 5xx responses; the earlier Vite 504s came from an old dependency hash held by the already-open browser tab, so that tab needs a reload.
