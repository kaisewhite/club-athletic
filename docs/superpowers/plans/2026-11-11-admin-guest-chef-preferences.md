---
plan_id: 2026-11-11-admin-guest-chef-preferences
status: COMPLETE
mode: IMPLEMENT
owner: orchestrator
---

# Admin Guest Roster and Chef Preferences

## Goal and architecture

Make the admin guest roster easy to scan on desktop and usable on phones, keep desktop columns sized to their contents without wrapping, and simplify the current Méribel 2027 dietary and cocktail values in the shared database into concise chef-ready preference lists. Preserve the existing database as the source of truth and the current React Router/Prisma architecture.

The desktop roster will remain a real data table, following the open, ruled style in Group Flights. Its columns will be individually sized from content and horizontally scrollable where the viewport cannot show all fields. At the existing 859px breakpoint, it will use one guest card per row, with every field shown as a labeled value. This follows the Flights page's existing desktop-table/mobile-card strategy.

No schema, migration, new dependency, or new UI framework is needed. The current trip and guest records already hold the fields, and the admin loader already supplies all values.

## Existing patterns and discovery
- Relevant files/patterns inspected:
  - `apps/web/app/components/flight-table.tsx`: `GroupFlightTable` selects its desktop table vs mobile cards at `(max-width: 859px)` using `useSyncExternalStore`; its table uses transparent backgrounds, no outer/cell borders, and a single subtle horizontal rule per row.
  - `apps/web/app/routes/admin.tsx` and `apps/web/app/components/admin.css`: current guest data/markup and styles; desktop data fields are present, but mobile currently retains the oversized table and is not adapted.
  - `apps/web/tests/routes/admin.test.tsx`: admin rendering assertions, including the guest fields and empty-value text that must be updated for spreadsheet cells.
  - `apps/web/app/routes/chef.tsx` and `apps/web/app/components/trip-details.css`: chef-facing dietary/cocktail table reads those strings from the database and already has responsive table treatments.
  - `apps/web/src/lib/db/repository.server.ts`: `getAdminGuests` reads guest details from the database; `getChefSummary` reads confirmed guest food preferences from the same database.
  - `apps/web/prisma/schema.prisma`: `Guest.dietaryNotes` and `Guest.favoriteCocktails` are nullable text fields; no schema change is needed.
  - `apps/web/prisma/seed.ts`: seed defaults are only applied when creating guests, so normalizing the defaults prevents verbose values from reappearing if seeded guest records are recreated; it does not update current records.
  - `apps/web/scripts/with-env.sh`: supported env loader for Prisma CLI/scripts. The configured endpoint is Neon `ep-quiet-night-b5ubm879-pooler.c-7.us-east-2.aws.neon.tech`, database `neondb`.
- What the plan reuses:
  - The Flights page's exact 860px desktop/mobile seam and `useSyncExternalStore` rendering pattern.
  - The Flights desktop table's transparent, flat style: no cell borders or filled columns; one subtle horizontal divider between rows; normal-weight, subdued column headings.
  - Existing admin row data and existing `FlightLeg`, `GuestInstagramLink`, date formatter, and guest task fields.
  - The existing trip key `meribel-2027`; a read-only database query confirmed its exact record name `Méribel 2027` and listed the existing preference values before planning changes.
- Any proposed new pattern and why existing ones do not meet a requirement:
  - No new pattern. The admin page will adapt the Flights page strategy to the admin-specific read-only field set, using compact guest cards on phones because a 10-column sheet cannot be read at phone width.

## Ordered tasks

### Task 0: Review this plan and obtain the execution choice
**Files:** `docs/superpowers/in-progress/2026-11-11-admin-guest-chef-preferences.md`.
- [x] Dispatch the plan reviewer, reconcile the review, and repeat review after revisions. Reviewer approved the revised plan with no open issues.
- [x] Present this exact plan to the operator and receive explicit approval plus an execution method. Operator approved and selected inline execution.

### Task 1: Prepare an isolated local database for acceptance
**Files:** outside-repository temporary env file `/tmp/club-athletic-admin-20261111.env`; task-owned local PostgreSQL database `club_athletic_admin_20261111`.
- [x] Confirm the task database name is absent, then create it on the already-running local PostgreSQL service at `127.0.0.1:5432` as the current `kaisewhite` role. Do not stop or reconfigure the existing PostgreSQL process.
- [x] Create the temporary env file with a nonfunctional placeholder `ANTHROPIC_API_KEY` and both `DATABASE_URL` and `DATABASE_URL_POOLED` set to the loopback database only, including `sslmode=disable`. Do not copy any Neon credential into it.
- [x] Run `CLUB_ATHLETIC_WEB_ENV_FILE=/tmp/club-athletic-admin-20261111.env bash scripts/with-env.sh bun run db:migrate:deploy` from `apps/web`. Verify both URLs still resolve to loopback before any app/browser run. Seed after Task 2 updates the creation defaults.

### Task 2: Normalize chef preference seed defaults
**Files:** `apps/web/prisma/seed.ts`.
- [x] Update only entries already present in `GUEST_NAMES` and the two existing seed maps to the matching concise values from this source-of-truth list. Do not add production-only guest profiles to the seed roster:

  | Guest | Dietary restrictions / preferences | Cocktail and drink preferences |
  | --- | --- | --- |
  | Alexandra Findleton | Keep blank | `Champagne; wine; Aperol Spritz; Hazy IPA; gin drinks` |
  | Ana Renner | `Avoid lactose` | `Espresso Martini; Aperol Spritz` |
  | Christie Navarre | `Gluten-free preference (not an allergy)` | Keep blank |
  | Jacqueline Herrera | `No red meat or pork; limits dairy; prefers eggs, fish, chicken, and tofu; cashew milk for matcha` | `Rarely drinks; prefers non-alcoholic beer; may have one cocktail (bartender's choice)` |
  | Kaise | `Pescatarian; lactose intolerant` | Keep blank |
  | Kristy Khoury | `Dairy-sensitive; limit milk, cream, and soft cheese; cooked dairy is better tolerated` | Keep blank |
  | Laura Hardwick | `Vegan` | `Espresso Martini; Aperol Spritz; Manhattan; French 75; whiskey` |
  | Marisa Moolsiri | Keep blank | `Hugo Spritz` |
  | Natalie Moine | Keep blank | `Margarita; French 75` |
  | Natalie Northup | Keep blank | `Campari Spritz` |
  | Olajuwon Jones | `No pork` | `Espresso Martini; Margarita; Old Fashioned` |
  | Ted Delcima | `Avoid parsley` | Keep blank |
  | Valeriia Stobolva | `Peanut sensitivity (avoid peanuts)` | `Mezcal Negroni` |

- [x] Keep the seed maps in sync with the values above. Seed data remains creation-only per the existing `ensure` helper; it is not the live-record write path.
- [x] Seed the isolated local database using `CLUB_ATHLETIC_WEB_ENV_FILE=/tmp/club-athletic-admin-20261111.env bash scripts/with-env.sh bun run db:seed` from `apps/web`; read back local preferences and confirm they match the table.

### Task 3: Match the desktop roster to the Flights table and fit content without wrapping
**Files:** `apps/web/app/routes/admin.tsx`; `apps/web/app/components/admin.css`.
- [x] Render each guest as one `<tr>` in a semantic table with these individual columns in this order: `Guest`, `Status`, `Room / spot`, `Venmo`, `Phone`, `Instagram`, `Dietary`, `Cocktails`, `Tasks`, `Flights`. Preserve all current data and links. Show an em dash for absent contact/preferences, `None` for an empty task list, and `No flights yet` for an empty flight list.
- [x] Keep the desktop table's style aligned to `flight-table` in `apps/web/app/components/flight-table.tsx`: transparent wrapper/background; no wrapper border, radius, cell borders, sticky columns, zebra fills, or tinted header cells; header has only the same subtle bottom rule; each body row has only one subtle top rule; 14px horizontal/vertical cell padding; 11px subdued header type and 13px body type; row hover uses the same subtle `color-mix` as Flights.
- [x] Replace fixed column widths and `overflow-wrap:anywhere` with content-sized desktop columns: `width: max-content; min-width: 100%; table-layout: auto` on the table and `white-space: nowrap; overflow-wrap: normal` on header and data cells. Keep the wrapper horizontally scrollable at narrow desktop/tablet widths so long content stays visible rather than wrapping or clipping. Do not truncate preference, task, or flight text. On desktop, the table—not each cell—is allowed to exceed the viewport width.
- [x] Reuse `FlightLeg`, `GuestInstagramLink`, task completion formatting, and airport-local flight date/time formatting. Keep the ten column headings and values associated for screen readers using `scope="col"` and `scope="row"`.

### Task 4: Adapt the complete roster for mobile
**Files:** `apps/web/app/routes/admin.tsx`; `apps/web/app/components/admin.css`.
- [x] Follow `GroupFlightTable` at `apps/web/app/components/flight-table.tsx`: use the same `(max-width: 859px)` media query with `useSyncExternalStore`, desktop server snapshot `false`, and a mobile guest-card renderer. Keep server and first hydration render on the desktop renderer, as in the established Flights component.
- [x] On mobile render one flat, full-width guest card per person, with the guest name first and every existing field shown as a compact label/value pair: status, room/spot, Venmo, phone, Instagram, dietary, cocktails, tasks, and flights. Preserve em dash/empty-state text and all links. Long values may wrap within the card at phone widths; the desktop no-wrap rule must not leak into the card renderer.
- [x] Match the Flights mobile visual treatment: transparent background, square corners, no card border/background, and one subtle top rule between guest entries. Keep text readable at 320px and avoid page-level horizontal overflow; no information is hidden behind hover or disclosure.

### Task 5: Update route assertions and pass local build gates
**Files:** `apps/web/tests/routes/admin.test.tsx`; changed implementation files above.
- [x] Update the existing admin fixture assertions so empty fields show `—`, while `No flights yet`, existing guest/status/room/contact/preferences/tasks/flights, refund names, and no-email behavior remain correct.
- [x] Add assertions that the table has the ten column headers in the specified order and each guest row contains the corresponding independent cells. The route test uses SSR and covers the desktop markup; mobile rendering is checked at actual browser viewports in the acceptance step below because the established mobile hook uses a desktop server snapshot.
- [x] Run `CLUB_ATHLETIC_WEB_ENV_FILE=/tmp/club-athletic-admin-20261111.env bash scripts/with-env.sh bun run build` and `bunx vitest run tests/routes/admin.test.tsx` from `apps/web`; expect successful production build/typecheck and all admin route assertions to pass. The build must use the loopback-only test env.

### Task 6: Validate the local product path against local PostgreSQL
**Files:** `apps/web/tests/visual/admin-responsive.spec.ts`; temporary screenshot output under `/tmp/club-athletic-admin-acceptance/`.
- [x] Add a Playwright browser check using the existing `tests/visual` config and `openFrozen` helper. At 1440px, assert the ten headings, at least one row, `white-space: nowrap` on desktop cells, and that cell content does not overflow its own column. Capture a desktop screenshot outside the repository.
- [x] At 390px and 320px, assert each guest is rendered as a mobile card with all nine labeled field groups, verify `document.documentElement.scrollWidth <= window.innerWidth`, and capture both screenshots outside the repository. Use local seed data only; do not connect the browser server to Neon.
- [x] Run only this spec with `CLUB_ATHLETIC_WEB_ENV_FILE=/tmp/club-athletic-admin-20261111.env bun run test:visual --project=desktop-1280 tests/visual/admin-responsive.spec.ts`. All four checks passed: desktop at 1440px, local chef preferences, mobile at 390px and 320px. Screenshots were captured at `/tmp/club-athletic-admin-acceptance/admin-desktop-1440.png`, `/tmp/club-athletic-admin-acceptance/admin-mobile-390.png`, and `/tmp/club-athletic-admin-acceptance/admin-mobile-320.png`; removed during cleanup after recording these locations. The Playwright server on port 47317 stopped after the run.

### Task 7: Apply reviewed preference updates to Neon after all local gates pass
**Files:** shared Neon database, trip key `meribel-2027`.
- [x] After Tasks 5 and 6 pass, use `bash scripts/with-env.sh bun -e '…'` from `apps/web` for one Prisma transaction on the verified trip. For each guest with a changed field, locate exactly one row by the exact trip and `displayName`; run `guest.updateMany` with `id`, `tripId`, and both exact original preference values in the `where` predicate. Require `count === 1` for every update, otherwise throw and roll back. Change only the two preference columns. Keep blank values null and do not rewrite non-preference fields.
- [x] Read back all 13 guest rows with at least one preference and verify every value against Task 2's exact table; verify null fields remain null and the overall guest count is unchanged. Record only names, changed fields, and counts in evidence; do not serialize connection strings.

### Task 8: Final real-user acceptance validation
**Files:** no additional repository files; record evidence below.
- [x] Run the loopback-only build and focused route test commands from Task 5, then the Playwright command from Task 6. The Playwright command starts the production-mode local server on port 47317 against the task-owned local database; record command output and screenshot locations.
- [x] Verify `/admin` at 1440px: one guest per row, ten individual columns, dynamic no-wrap content, horizontal table scrolling only when necessary, and the same unfilled open row rules as Group Flights.
- [x] Verify `/admin` at 390px and 320px: one guest card per guest with all nine detail groups, no document-level horizontal overflow, visible links and complete long values.
- [x] Verify `/chef` displays the database-backed preferences from the normalized local seed and query Neon again to confirm Task 7's live values and unchanged guest count. Do not run deployed browser smoke tests or deploy code; deployment was not requested.
- [x] Stop/await Playwright's task-owned server cleanup, verify port 47317 is no longer listening, drop only `club_athletic_admin_20261111`, remove `/tmp/club-athletic-admin-20261111.env` and the screenshot directory after recording their locations. Verify the pre-existing PostgreSQL service remains running and the task database is gone.
- [x] If build, tests, rendering, responsive behavior, or data checks fail, repair the issue and repeat the affected local gates and full final acceptance sequence.

## Delegation ledger
| Agent | Task | Status | Output/evidence | Review |
| --- | --- | --- | --- | --- |
| Plan reviewer | Review this plan against the user request | Approved | Second review approved the compare-and-swap update and confirmed browser viewport checks cover mobile rendering. | No open issues |

## Progress and evidence
| Timestamp | Actor | Task | Action/evidence | Result/next action | Blocker |
| --- | --- | --- | --- | --- | --- |
| 2026-11-11 | Orchestrator | Execution start | Operator approved this exact plan and selected inline execution. Confirmed branch `main`; prior admin route/CSS edits remain uncommitted. | Moved the same plan to `in-progress/`; implementation and local-first gates underway. | None |
| 2026-11-11 | Orchestrator | Discovery | Read local instructions, project schema, seed defaults, admin route/tests, chef consumer, and Flights desktop/mobile implementation. Read-only Prisma query confirmed exactly one trip (`Méribel 2027`, key `meribel-2027`) and 13 guests with at least one preference. | Plan exact scope and transformation values. The worktree already contains uncommitted admin table changes from the preceding guest-roster request; no code or database writes were made after the operator asked for a plan. | None |
| 2026-11-11 | Orchestrator | Database discovery | Initial read with an assumed key and a second query with a nonexistent `createdAt` field both failed before returning data; corrected query used the schema-supported `seedKey`, `id`, and `name`, then fetched the exact trip preferences successfully. | No database writes occurred. | None |
| 2026-11-11 | Plan reviewer | Plan review | Reviewer identified that transaction reads needed an atomic old-value compare-and-swap, and SSR assertions could not guarantee the mobile branch. | Revised Task 1 to use conditional `updateMany` row-count checks; mobile viewport coverage remains in real-browser acceptance, while SSR tests cover table markup. Request a second review. | None |
| 2026-11-11 | Plan reviewer | Plan re-review | Confirmed exact-value `updateMany` predicates scoped by guest ID and trip ID plus `count === 1` prevent overwriting concurrent edits; confirmed 390px and 320px browser acceptance covers the mobile render. | Approved with no open issues. Re-ran KISS gate: retain only existing React/Prisma patterns, no schema/dependency/migration, use existing responsive split. Awaiting operator approval and execution choice. | None |
| 2026-11-11 | Orchestrator | Local-first adjustment | Found the default `.env` points to shared Neon for both Prisma endpoints. Found local PostgreSQL 14 already running on `127.0.0.1:5432`, `kaisewhite` has CREATEDB, and existing Playwright config requires explicit loopback DB URLs. | Reordered execution to finish local build/tests/browser validation against an isolated local DB before the approved Neon write. Existing PostgreSQL process will be preserved. | None |
| 2026-11-11 | Orchestrator | Task 1 | Created previously absent `club_athletic_admin_20261111`, wrote `/tmp/club-athletic-admin-20261111.env` with placeholder API key and loopback-only DB URLs, and applied all 19 repository migrations successfully. Verified both app DB variables resolve to loopback; existing PostgreSQL process was untouched. | Task 1 complete; next update applicable seed entries. Local DB is empty and remains task-owned for acceptance. | None |
| 2026-11-11 | Orchestrator | Task 2 | Replaced verbose seed values for the six existing guest profiles with the approved concise dietary labels and cocktail lists; seeded the isolated database, which reported 11 guests, 8 rooms, 11 assigned spots, 8 available spots, 1 not offered, 9 schedule days, and 16 links. An assertion query confirmed all six local preference values. | Task 2 complete; next update admin desktop table, then mobile rendering. | None |
| 2026-11-11 | Orchestrator | Task 3 | Starting the desktop table alignment and content-sizing pass after comparing the live `flight-table` CSS directly. | Replace fixed widths and every-cell borders with the established open table rules; render full field values without wrapping. | None |
| 2026-11-11 | Orchestrator | Tasks 3–4 | Reviewed the Admin route/CSS diff: ten individual columns share the exact Flight table open rules, intrinsic-width no-wrap behavior, and horizontally scrollable wrapper. The mobile branch reuses the established 859px `useSyncExternalStore` seam and displays all fields in flat labeled guest cards. `git diff --check` passed. | Marked implementation tasks 3 and 4 complete; next update route assertions, then run local build and tests. | Browser/TS verification remains in later tasks. |
| 2026-11-11 | Orchestrator | Task 5 | Loopback-only `bun run build` passed. Focused route test failed one old expectation: actual task cell text is `Payment · Done Sun 1 Nov`, while test still expects `Payment Done Sun 1 Nov`. The rendered output confirms intended separate task label/status formatting; all other 4 tests passed. | Root cause is stale assertion after moving tasks into their own labeled cell; update the expected visible string and rerun the focused test. | None |
| 2026-11-11 | Orchestrator | Task 5 | Updated the stale task-cell expectation to `Payment · Done Sun 1 Nov`; reran `bunx vitest run tests/routes/admin.test.tsx`, all 5 tests passed. Build had already passed on the exact implementation code using loopback env. | Task 5 complete; next add desktop/mobile browser assertions and validate the real local app with Playwright. | None |
| 2026-11-11 | Orchestrator | Task 6 | New Playwright acceptance run: mobile cards passed at 390px and 320px with zero document overflow. Desktop test found at least one header/data cell did not satisfy computed `white-space: nowrap` or its content width. Playwright shut down its server; port 47317 is no longer listening. | Added diagnostic data (text, tag, client/scroll width, computed white-space) to the failing assertion and will rerun only the desktop case to locate the exact offending cells. | None |
| 2026-11-11 | Orchestrator | Task 6 | Diagnostic rerun proved all 10 body cells fit, but every table header computed `white-space: normal`; the body selector intentionally excluded `<thead>`. | Added `white-space: nowrap; overflow-wrap: normal` to desktop header cells. Rerun build, route assertions, and the complete 1440/390/320 acceptance suite. | None |
| 2026-11-11 | Orchestrator | Task 6 | After the header fix, computed no-wrap/cell-fit checks pass. Mobile passes at 390px and 320px. Desktop reveals document-level horizontal overflow of 383px even though the roster is inside an `overflow-x:auto` wrapper. Playwright stopped its server; port cleanup verified after investigation. | Added element geometry diagnostics to identify which ancestor is allowing the roster's max-content width to expand the page. | None |
| 2026-11-11 | Orchestrator | Task 6 | DOM geometry shows the final guest row extends to x=2028 at a 1440px viewport; overflow is exactly 383px. Cell widths fit their content, so the remaining defect is table-wrapper/ancestor sizing. | Expanded diagnostics to record wrapper-to-root width, scroll width, and computed `overflow-x`; no layout fix applied yet. | None |
| 2026-11-11 | Orchestrator | Task 6 | Ancestor diagnostics: the table wrapper is 1100px wide with `overflow-x:auto` and `scrollWidth=1858`; its parent route/content widths remain bounded, but the root document still reports 1823px scroll width. | Added a route-scoped `overflow-x:clip` boundary to prevent the table's scrollable overflow from propagating to the document, while preserving the nested wrapper scroller; added an assertion that the wrapper remains horizontally scrollable. Validate this hypothesis in Chromium. | None |
| 2026-11-11 | Orchestrator | Task 6 | The app-shell and body overflow boundaries did not constrain Chromium's document scroll width. Applied `contain: paint` to the bounded horizontal roster scrollport; the focused desktop Playwright test then passed while the inner table remained scrollable. | Added a local `/chef` browser assertion for normalized seeded dietary/cocktail values. | None |
| 2026-11-11 | Orchestrator | Task 6 | Strengthened the mobile browser assertions to verify at least one guest link remains visible and none of the field values are ellipsized or clipped. Recreated and reseeded the isolated local database after cleanup, reran the final full Playwright spec, and all 4 checks passed. | Repeated final cleanup; task DB and env file are absent, screenshot directory is removed, port 47317 is closed, and existing PostgreSQL PID 13405 remains running. | None |
| 2026-11-11 | Orchestrator | Tasks 5–8 | Loopback build passed; focused admin route tests passed 5/5. Final Playwright spec passed all 4 checks: desktop `/admin` at 1440px, `/chef` values from local PostgreSQL, and `/admin` guest cards at 390px/320px. Desktop asserted all ten headers, no-wrap and content fit, and a horizontally scrollable table wrapper; both phone widths had all nine field groups, a visible link, no clipped/ellipsized fields, and no page overflow. Screenshots captured under `/tmp/club-athletic-admin-acceptance/` (three paths in Task 6) and removed in cleanup. | Neon guarded transaction checked all 13 exact guest matches on `Méribel 2027`; 10 records had rewritten values, while 3 already matched the concise form. Transaction readback matched all 13 reviewed rows and kept nulls null. Guest count remained 18 before and after. Dropped only the task-owned local database; removed its env file and screenshots; confirmed the existing PostgreSQL PID 13405 remains running and port 47317 is closed. | None |

## Final acceptance
- [x] User-approved plan executed with all tasks complete.
- [x] Database values and creation defaults match the reviewed concise preference list; row count unchanged.
- [x] Desktop follows the Flights open-table styling and content fits without wrapping; mobile shows the full roster in responsive guest cards at 390px and 320px.
- [x] Build, route assertions, and final real-user acceptance evidence are recorded above.

**Evidence:** Loopback production build passed; admin route assertions passed 5/5; final Playwright acceptance passed 4/4; reviewed all 13 live guest records (rewrote 10, with 3 already concise) and verified the complete readback with guest count unchanged at 18. Screenshot captures were stored at the three `/tmp/club-athletic-admin-acceptance/` paths recorded above, then removed during cleanup. The task database and env file were removed, port 47317 is closed, and the existing PostgreSQL service remains running.

## Decisions and revisions
- The live preferences are guest-entered values. Rewrites retain meaningful dietary constraints and drink choices while removing narrative. Ambiguous `Lactose` is expressed as the neutral `Avoid lactose`; the peanut value remains a sensitivity, not an allergy; gluten-free remains explicitly a preference, not an allergy.
- The current trip key is verified as `meribel-2027`; no identifiers are inferred for updates. The live write will require exact unique guest matches and unchanged source values inside a transaction so concurrent edits are not overwritten.
- Desktop must stay an open, unfilled Flights-style table; mobile uses the same card adaptation strategy already used by Flights instead of shrinking the 10-column sheet onto a phone.
- KISS review: a static-width, wrapped table would be less code but fails the no-wrap requirement; forcing the full-width sheet on phones fails the mobile usability requirement. The existing Flight table/card split is the smallest established pattern meeting both needs. No new abstractions, dependencies, schema changes, or migration are proposed.
- No production deployment is in scope. The user explicitly requested changes to the live database; after approval of this exact plan, the database update is part of execution and will be verified by reading back the values.
