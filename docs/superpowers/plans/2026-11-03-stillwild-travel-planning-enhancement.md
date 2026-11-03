---
plan_id: 2026-11-03-stillwild-travel-planning-enhancement
status: IN PROGRESS
mode: IMPLEMENT
owner: orchestrator
---

# Stillwild-Inspired Travel Planning Enhancement

## Contract
- **Objective:** Produce a buildable implementation plan to evolve the existing Club Athletic trip hub into an editorial, end-to-end travel planning guide for the Méribel ’27 trip, taking layout and interaction ideas from Stillwild while preserving the current design tokens, palette, data accuracy, routes, and behaviors.
- **Mode:** PLAN. This task ends with an implementation-ready plan and its review; it does not implement or deploy changes.
- **Authority:** User request dated 2026-11-03 to study the Stillwild Framer marketplace/live preview and the supplied Framer preview, then plan travel-planning enhancements without changing the current design tokens or color scheme. Existing repository README/CLAUDE instructions, current route/data implementation, tests, and app README remain authoritative for technical and behavioral constraints.
- **Scope and exclusions:** Plan work only; create this ticket at `docs/superpowers/plans/2026-11-03-stillwild-travel-planning-enhancement.md`. Future implementation scope is `apps/web/app/**`, `apps/web/src/**`, `apps/web/public/**` only for derivatives of existing imagery, relevant `apps/web/tests/**`, and the apps/web documentation. Preserve all current user routes (`/`, `/chat`, `/schedule`, `/flights`, `/shuttle`, `/chalet`, `/rooms`, `/spots`, `/chef`, `/tasks`, `/links`, `/guests`, `/faq`, `/guest-details`) and `/api/*`. Do not alter server behavior, Prisma, env files, entrypoint, unrelated apps, color values, or design tokens. No deployment or branch switch is in scope.
- **Acceptance checks:** The plan names concrete changes for every current page; identifies existing data, behaviors, shared shell, styling and verification surfaces; keeps the palette/tokens fixed; includes motion and reduced-motion guidance; gives ordered, independently verifiable work; includes production-like build/start, real-user route journeys, runtime evidence, screenshots, and cleanup in its final acceptance task; and receives an advisory plan review with all serious findings reconciled in this ticket.
- **Dependencies:** Repository inspection; public Stillwild marketplace and preview pages; existing local trip data, real local image/video assets, test suite, and a local development/runtime path available to the future implementer. The supplied `impartial-goal-555890.framer.app` preview returned inaccessible in web inspection and search did not surface it; the marketplace and `stillwild.framer.website` provide sufficient evidence. Recheck that URL only if access becomes available; do not block the plan on it.
- **Stop conditions:** Stop and record a decision if a proposed design requires unsupported trip facts, new secrets, data exposure, schema/server/API changes, or a palette/token change. Surface any such proposal to the user before broadening implementation scope.

## Goal and architecture

Turn the single-trip hub into a coherent travel guide that answers, in order: what the trip is, how to prepare and arrive, how the week unfolds, where everyone stays, what is available, and where to act or ask questions. Apply Stillwild’s editorial hierarchy, destination storytelling, legible availability, itinerary sequencing, and restrained motion to Club Athletic’s real existing content. Treat it as one trip with multiple planning chapters, not a retreat marketplace: no multi-destination carousel, booking funnel, member-only promises, invented testimonials, or invented ratings.

Keep the existing `:root` color and spacing values, font faces, and Tailwind theme tokens intact. Recompose route layouts, typography usage, whitespace, image crops, separators, page intros, and responsive behavior using those values. Use only already bundled local visual assets after inspecting them; reuse or crop local media only where it adds context and never create a photo grid just to imitate the reference. The existing app shell and route components remain the shared architecture; add only the smallest reusable editorial primitives needed across pages (for example, a page masthead/metadata row and a timeline/list section), rather than a new design system or dependency.

Motion should clarify navigation and state: short route/content transitions, restrained section reveals that never hide SSR content, navigation/menu feedback, disclosure/form/chat feedback, and reduced-motion support. Reuse existing CSS and animation patterns where possible, consolidate their timings behind a small motion custom-property layer, keep reveal staggering at or under 500 ms, and make `prefers-reduced-motion: reduce` collapse durations at `:root`. Keep the 859/860 JS/CSS seam: mobile-only overrides stay under `@media (max-width: 859px)` and the mobile CSS convention test remains unchanged in intent.

### Reference findings and translation

Stillwild’s marketplace describes retreat detail pages with itinerary, rooms/prices, hosts, place and sticky reservation card; departure dates with live statuses; a four-slide homepage; an “A day here” section; and responsive layouts. Its public preview demonstrates these patterns with strong editorial headings, concise introduction/CTAs, categorized trip previews, time-based itinerary, destination logistics, departures, guide profiles, inclusion lists, FAQ and journal content. Sources: [Stillwild marketplace](https://www.framer.com/marketplace/templates/stillwild/) and [Stillwild live preview](https://stillwild.framer.website/). The extra supplied preview was not accessible during planning, so no claims are based on it.

Translate its planning clarity rather than its commerce model: one memorable Méribel overview, transparent pending values, a chronological week and travel sequence, cross-links between related trip facts, and clear next actions. Use existing content only; show unknown information as “Pending” (or the route’s existing TBD convention) without implying a booking, confirmed activity, price, amenity, room capacity, date, or service that the data does not support.

### Page composition map

| Route | Chapter composition and planning job |
|---|---|
| `/` | Distinctive Méribel ’27 cover: use existing local hero media only after inspection; show Club Athletic, Falcon Lodge F, Méribel / Three Valleys, exact Sat 30 Jan–Sat 6 Feb 2027 dates, a concise trip summary from existing copy, and direct planning links. Below the cover, preview the actual week and the next useful trip chapters; do not add fabricated destination claims. |
| `/chat` | Concierge as the trip’s practical planning desk. Keep conversation history, uploads/flight screenshot flow, suggestions, streaming and composer behavior. Improve message readability, source/context hierarchy, attachment preview and keyboard-safe composer; use restrained state feedback. |
| `/schedule` | The week as a readable day-by-day itinerary, with date, known events/meals, and TBD where unknown. Use a timeline/list rhythm and links to the relevant planning chapter; preserve copy action. |
| `/flights` | Arrival/departure planning page: separate flight recommendations, entered guest flights, booking rules and early-arrival notes into clear editorial sections. Preserve screenshot intake, existing loader data, sorting and links; unknown itinerary details stay pending. |
| `/shuttle` | Transfer plan ordered by date and direction, with time windows, pickup/drop-off stops and relevant flight context. Preserve route data and cross-links; present missing times as pending. |
| `/chalet` | Falcon Lodge F destination profile using confirmed address/map and existing property facts, followed by real inclusions/amenities and existing listing links. Do not add atmospheric copy that asserts unsupported amenities. |
| `/rooms` | Room guide organized by floor/room with the existing room diagram and occupancy data. Pair the visual map with readable, accessible room descriptions and occupied/open state; verify counts against the existing source data. |
| `/spots` | Clear availability and pricing chapter. For each room, label the count as “open spots” (not an unexplained number), show the occupants/remaining availability supported by current data, and explain unknown room pricing as pending. Keep totals and service agreement details sourced from the current loader. |
| `/chef` | Food plan arranged by dated meal/event, with dietary and cocktail preferences easy to scan and update. Preserve dietary/cocktail API writes, status feedback, keyboard controls and real meal data. |
| `/tasks` | Group readiness checklist with distinct arrival/flight and payment states, progress based only on existing values, and obvious links to the relevant page. Preserve sort behavior and current guest visibility. |
| `/links` | Practical resource directory grouped by existing categories (including ski equipment), with recognizable destination/organization, notes, copy/link affordances, and clear external-link treatment. Keep URLs and copy actions unchanged. |
| `/guests` | Guest directory with bundled local avatars where available, clear empty profile state and existing profile links/copy action. Keep the same public data exposure. |
| `/faq` | One consistent FAQ presentation across all content: one table/list pattern with question and answer columns/rows, responsive readable labels, and a single visual grammar. Fold existing `room-sharing-faq` content into that same table pattern or link to the relevant room detail; do not retain a second table/card style. |
| `/guest-details` | Personal details form as a focused trip-preparation chapter. Preserve validation, submission endpoint, confirmation/error states and exact current fields; provide keyboard and touch accessibility. |

## Ordered tasks

### Task 1: Reconfirm constraints, data surfaces, and reference translation
**Files:** `README.md`, `CLAUDE.md`, `apps/web/README.md`, `apps/web/app/routes.ts`, `apps/web/app/components/app-shell.tsx`, `apps/web/app/routes/*.tsx`, `apps/web/app/loaders/**` (read-only inspection), `apps/web/src/styles.css`, `apps/web/tests/**`, `apps/web/public/**` (read-only inspection)
- [x] Verify current branch and working tree; preserve unrelated changes and do not switch branches.
- [x] Inspect actual route loaders, shared layout, relevant tests, current local media and image dimensions; record route/data/behavior mapping in this ticket before implementation.
- [x] Reconcile unavailable preview as inconclusive; base implementation on the two Stillwild references successfully inspected and current app reality.
- [x] Confirm there is no need for server/API/schema/environment changes; if discovery disproves this, stop and obtain revised authority.

### Task 2: Implement shared editorial shell and motion foundation
**Files:** `apps/web/app/components/app-shell.tsx`, `apps/web/app/root.tsx`, `apps/web/src/styles.css`, existing shared components under `apps/web/app/components/**`
- [x] Improve page shell hierarchy, route mastheads, chapter navigation and footer cross-links using existing content and existing responsive navigation behavior.
- [x] Build the smallest shared page-intro/metadata/timeline primitives needed to make route layouts consistent; do not add a UI dependency or parallel abstraction.
- [x] Keep current color, spacing, typography, radius and Tailwind token values unchanged; preserve Hanken Grotesk and Inter only for new layout work.
- [x] Add or consolidate motion custom properties for durations `instant`, `fast`, `normal`, `moderate`, `slow` and easings `standard`, `decelerate`, `accelerate`; reserve `linear` for looping indicators only.
- [x] Apply brief transitions, visible-by-default reveals, reduced-motion duration collapse at `:root`, and total reveal stagger no longer than 500 ms.
- [x] Preserve SSR-visible content, keyboard access, visible focus, 44px minimum touch targets, safe-area spacing and the 859/860 seam; keep mobile-only overrides in `@media (max-width: 859px)`.

### Task 3: Recompose the home and planning chapters
**Files:** `apps/web/app/routes/overview.tsx`, `schedule.tsx`, `flights.tsx`, `shuttle.tsx`, `chalet.tsx`, `rooms.tsx`, `spots.tsx`
- [x] Build an overview with a clear destination cover and paths into trip planning, using only inspected local assets and actual trip copy/data.
- [x] Present schedule and transfers in chronological structures, and flights as an arrival/departure planning chapter.
- [x] Present chalet and room facts as a destination profile/room guide with accessible labels and precise occupancy.
- [x] Restructure availability so “open spots” is explicit, reconcile counts against room assignments, and mark unknown prices as pending.
- [x] Keep all loader outputs, copy and sort controls, flight screenshot processing and external map/listing links working.

### Task 4: Recompose group, dining, resources, FAQ, and form chapters
**Files:** `chef.tsx`, `tasks.tsx`, `links.tsx`, `guests.tsx`, `faq.tsx`, `guest-details.tsx`, relevant components under `apps/web/app/components/**`
- [x] Lay out chef/dining details and editable dietary/cocktail preferences with existing data and working update feedback.
- [x] Make tasks and guest readiness status easy to scan while preserving sorting and privacy boundaries.
- [x] Make existing links and guest profiles a practical, searchable-by-visual-group directory without changing destinations or access.
- [x] Unify every FAQ entry—including room-sharing answers—under the same table/list treatment; update assertions that encode the old two-style visual only, never behavior coverage.
- [x] Restyle guest details without changing fields, validations, submission semantics, API, or confirmation/error states.

### Task 5: Recompose chat and interaction states
**Files:** `apps/web/app/routes/chat.tsx`, `apps/web/app/components/chat/**`, `apps/web/src/styles.css`, `apps/web/tests/components/**`, `apps/web/tests/routes/**`
- [x] Improve visual order of concierge responses, sources, tool activity, errors, history, suggestions and attachments.
- [x] Keep the composer usable above a soft keyboard and safe-area inset on narrow screens; preserve scrolling, focus behavior and a 44px touch target.
- [x] Keep conversation history, streaming/cancel, attachments and flight screenshot flow intact; apply brief useful transitions to state changes without delaying action.
- [x] Keep all content visible during SSR and ensure reduced-motion users receive the same information and actions.

### Task 6: Update targeted assertions and verify the whole app
**Files:** `apps/web/tests/**`, `apps/web/README.md`, root `README.md` only if the Tests paragraph needs updating
- [ ] Update only screenshot/DOM expectations that intentionally encode replaced visual layouts; retain route, loader, API, submission, attachment, copy, sort, accessibility and mobile behavior tests.
- [ ] Keep `apps/web/tests/visual/mobile-layout.spec.ts` unchanged in intent and `tests/unit/mobile-css-convention.test.ts` passing without weakening either.
- [ ] Run `cd apps/web && bun run typecheck && bun run lint && bun run test`; fix in-scope issues and rerun the complete command sequence.
- [ ] Start the production-like local app using the documented build/start path; note that `bun run build` rewrites the shared `build/` directory. Do not stop or overwrite operator-owned server processes.
- [ ] Capture and review screenshots for every current user route at 390, 820 and 1440 CSS pixels wide; check no horizontal overflow at widths from 320 through 1920, keyboard/focus, safe areas, and reduced motion.
- [ ] After visual review, re-record the authorized desktop baselines with `bun run test:visual:update`, then run `bun run test:visual` and record actual output.
- [ ] Update the README Tests paragraph and styles.css baseline banner to describe the new baseline while keeping the 859/860 seam convention clear.
- [ ] Close task-owned browser sessions and processes; verify each started port is free without stopping operator-owned services.

### Task 7: Final real-user acceptance validation
**Files:** Runtime evidence and screenshots stored under `apps/web/docs/design/screenshots/`; this plan ticket records output and cleanup evidence.
- [ ] Run from `apps/web`: `bun run build`, then `bun run start` on a task-owned free port; record process/PID and wait for a successful health response before browser validation.
- [ ] Exercise a real-user path from the overview through schedule, flight entry/attachment, shuttle, rooms and explicit open-spot availability, chef preferences, FAQs, guest details submission and concierge chat; include at least one keyboard-only pass through nav, one table, one dialog/disclosure and one form.
- [ ] Confirm expected page content reflects only current trip data, unknown values are visibly pending, exact trip dates and Falcon Lodge F remain accurate, and all route navigation and actions work.
- [ ] Capture route screenshots at 390, 820 and 1440 widths plus browser console/network summary and relevant server output showing the actual runtime/API path used; include a reduced-motion capture or recorded check.
- [ ] Stop only the process and browser sessions started for this task; verify task-owned ports are free and the operator’s existing ports remain untouched.
- [ ] If any real-user path fails, repair the in-scope issue and rerun this entire acceptance flow; record evidence here.

## Delegation ledger
| Agent | Task | Status | Output/evidence | Review |
| --- | --- | --- | --- | --- |
| Plan document reviewer | Review completeness, scope alignment, decomposition, buildability and final acceptance of this plan | Approved | Round 1: no issues or recommendations (2026-11-03) | Reconciled; no edits required |
| Discovery agent | Task 1: inspect actual route loaders, tests, media and data boundaries; report a concrete implementation map | Complete | Route/data map and behavior test inventory returned 2026-11-03; existing loaders/APIs suffice. Poster is local alpine panorama; chalet image is a 6-panel composite. | Reviewed; spot counts derive from AVAILABLE rows in both room/pricing loaders; investigate visible discrepancy only at presentation/confirmed source data. |
| Shell/motion agent | Task 2: shared editorial shell and motion foundation | Complete | Added keyboard skip link/route target, shared duration/easing properties, reduced-motion collapse, touch-sized navigation controls and `page-masthead` wrapper around existing `PageHeading`. Tests: 1 file/21 mobile CSS convention tests passed; `git diff --check` passed. | Reviewed after rework; existing heading semantics and token values preserved. | None |
| Planning routes agent | Task 3: overview, schedule, flights, shuttle, chalet, rooms, spots | Complete | Implemented route layouts and explicit room availability; focused suite 5 files/23 tests, mobile convention 1/21, typecheck exit 0, `git diff --check` clean. Corrected bunk-photo crop to square frame with natural aspect ratio; mobile convention passed again. | Reviewed all route changes and crop; loader/count logic unchanged. |
| Group routes agent | Task 4: chef, tasks, links, guests, FAQ, guest-details | Complete | Added chapter framing to chef, readiness task links/table, resource groupings, guest directory, one-table FAQ framing and scoped guest-details wrapper. Agent and orchestrator ran 7 files/31 interaction tests, mobile convention 1/21, `git diff --check` clean. | Reviewed six route diffs; external unapproved changes to guest submission/schema/form remain excluded from this task. |
| Chat agent | Task 5: chat interactions and layout | Complete | Refined chat measure and message/source/error hierarchy, motion feedback, and 44px source/composer/attachment controls; 2 component files/37 tests and mobile convention 1/21 passed. Requested combined suite reports one stale overview selector failure (48/49). | Reviewed chat-only diff; Task 6 must update that existing assertion to the new FAQ chapter link without weakening behavior coverage. |
| QA/docs agent | Task 6: assertions, checks, screenshots, baseline and documentation | In progress | Dispatch 2026-11-03; first fix stale `.home-welcome` assertion without dropping FAQ-link behavior check; then run required suite and capture all route screenshots. Baseline re-record waits for orchestrator visual review. | Await tests, screenshots, review, baseline/doc follow-up |

## Progress and evidence
| Timestamp | Actor | Task | Action/evidence | Result/next action | Blocker |
| --- | --- | --- | --- | --- | --- |
| 2026-11-03 | Orchestrator | Contract / discovery | Read repository instructions, route config, shell, CSS, route implementations, app README, local assets and Stillwild marketplace/preview. `git status --short --branch` showed `feature/cinematic-home` and no changes. Web inspection/search could not access the separate `impartial-goal-555890.framer.app` preview. | Create plan based on accessible Stillwild references and current architecture; do not implement. | Supplied preview inaccessible; non-blocking |
| 2026-11-03 | Orchestrator | Plan review | Reviewer returned **Approved** with no issues or recommendations. Re-ran the KISS gate: one existing shell and CSS layer, only the smallest shared editorial primitives, no dependency or data model changes; simpler alternative of only reskinning existing layouts would not deliver route-level travel planning and consistent chapters. | User selected subagent-driven execution; ticket moved to IN PROGRESS. | None |
| 2026-11-03 | Orchestrator | Task 1 dispatch | Confirmed branch `feature/cinematic-home`, read root `CLAUDE.md` delegation/process rules and inspected current route map, shared shell, CSS, FAQ, spots, overview, and bundled media dimensions. Working tree contains only this plan ticket as untracked. | Discovery agent to map all route loaders, behavior tests, local media and existing data boundaries before implementation. | None |
| 2026-11-03 | Discovery agent | Task 1 | Returned actual loader/data map for all 14 user pages, list of component/route/unit/visual test coverage, and confirmed no server/API/schema/env changes are needed. Identified `meribel-peaks-poster.webp` (1600×900 alpine panorama) and `chalet-rooms.webp` (1536×1024 six-panel composite). Existing `getRoomsByFloor` and `getOpenSpots` each derive available counts from AVAILABLE rows; tests expect 10 open across three rooms in fixture. | Accepted. Emphasize counts visually without changing calculation; route groups may now begin. | None |
| 2026-11-03 | Orchestrator | Task 2 review and Task 3 dispatch | Committed reviewed shell/motion changes as `edb490c`. Re-review verified the existing `PageHeading` now wraps a `header.page-masthead[aria-labelledby]` with unchanged props/heading/subtitle; mobile CSS convention test passed (1 file, 21 tests), `git diff --check` clean. After the first clean status, additional unstaged arrow-icon substitutions were observed in chat/flight/chalet/guests/links/overview/schedule components; excluded from Task 2 commit and preserving them. | Planning route agent must work around existing icon-only hunks; review full diff before staging. | Provenance of additional icon edits not confirmed |
| 2026-11-03 | Planning routes agent / Orchestrator | Task 3 review | Added overview chapter navigation, schedule/travel sections, rooms and explicit spot rows, pending room rate, and local bunk-room crop; no loader/count logic changes. Orchestrator ran focused route suite (5 files/23 tests), mobile convention (1 file/21 tests), `bun run typecheck` (exit 0), `git diff --check` (clean). | Rework requested: source bunk-room crop panels are square; current 3:2 crop frame stretches the source. Preserve image aspect ratio and rerun focused checks. | None |
| 2026-11-03 | Planning routes agent | Task 3 rework attempt | Follow-up turn ended as agent failure; inspection confirms `.spots-photo-crop` remains 3:2 with forced `height: 200%`/`object-fit: fill`. | Re-dispatch the bounded CSS correction; keep Task 3 unchecked. | Rework agent turn failed; cause unknown |
| 2026-11-03 | Planning routes agent / Orchestrator | Task 3 re-review | Second rework changed only `.spots-photo-crop` base rules to square frame and natural image height; mobile override retained. Re-ran mobile convention (1 file, 21 tests passed) and `git diff --check` (exit 0). Source review confirms both room and pricing totals use `countOpenSpots` over AVAILABLE spots; total is calculated from the same per-room availability set. | Accepted Task 3; per-room price displays `Price pending` when data is null and cross-links to assignments. | None |
| 2026-11-03 | Orchestrator | Task 3 accepted / Task 4 dispatched | Reviewed route structure, existing totals and pricing list; route suite (5 files/23 tests), mobile convention (1/21), typecheck and diff check passed. Count source uses the same `countOpenSpots` helper for room cards and pricing summaries. | Group routes agent will recompose dining, readiness, resources, FAQ and guest-details while preserving all update/submission/copy/sort behavior and the one-table FAQ. | None |
| 2026-11-03 | Group routes agent / Orchestrator | Task 4 boundary decision | Agent reported additional uncommitted modifications in `apps/web/app/routes/api.guest-details.ts`, `apps/web/src/lib/db/guest-submissions.server.ts`, `repository.server.ts`, `src/lib/guest-details-schema.ts`, and `guest-details-form.tsx`/CSS. These are outside this plan’s authorized route-layout scope. | Do not touch, stage, or restore these paths; continue route-only layout changes and preserve current form contract. | Provenance of these additional edits not confirmed |
| 2026-11-03 | Group routes agent / Orchestrator | Task 4 review | Agent completed route composition; FAQ remains a single `FaqTable` that combines trip and room-sharing rows. Orchestrator reran focused detail/API/form/preference suite: 7 files/31 tests passed; mobile convention 1/21 passed; `git diff --check` clean. Route review confirms meal/preferences, readiness, link directory, guest list and form wrapper use the existing data and controls. | Accepted route presentation work. Leave out-of-scope concurrent API/schema/form changes untouched and uncommitted. | Concurrent changes remain in working tree |
| 2026-11-03 | Chat agent / Orchestrator | Task 5 review | Refined chat message width and hierarchy, sources, status/errors, focus/interaction feedback, and controls. Orchestrator ran combined suite: 3 files, 48 passed, 1 failed; isolated chat components: 2 files/37 passed; mobile convention: 1 file/21 passed. Failure at `chat-overview.test.tsx:119` queries removed `.home-welcome a[href=/faq]` after Task 3 moved it into `.trip-chapters`. | Accepted chat UI work; Task 6 will update only this stale expectation so the route link behavior remains asserted. | Known stale assertion, scoped for Task 6 |
| 2026-11-03 | Orchestrator | Task 5 accepted / Task 6 dispatched | Isolated chat tests pass; one combined test fails solely because the FAQ link selector still targets the replaced overview section. | QA/docs agent will update the selector to the matching FAQ link inside `.trip-chapters`, run the complete checks, capture screenshots at all routes/widths, and prepare docs. Do not update baseline before orchestrator reviews screenshots. | None |
| 2026-11-03 | QA/docs agent / Orchestrator | Task 6 discovery | Agent confirmed current branch and operator server :4173 (PID observed, not started by agent), isolated the stale selector, and noticed new untracked `apps/web/app/lib/room-types.ts` plus previously observed external API/form/schema changes. | Preserve all external changes; QA work limited to explicit test/doc/screenshots, using existing :4173. | Provenance of external files/edits remains unknown |
| 2026-11-03 | Orchestrator | Task 4 accepted / Task 5 dispatched | Confirmed one FAQ table in the route source and focused tests pass. Existing concurrent API/schema/form changes remain untouched. | Chat agent will adjust visual hierarchy and keyboard-safe composer without behavior/API changes. | Concurrent changes remain in working tree |

## Final acceptance
- [x] Plan reviewed and approved; reviewer result recorded in the delegation ledger and progress log.
- [x] Plan explicitly preserves all current routes/API behavior, current palette/tokens, real data boundaries, responsive seam and accessibility requirements.
- [x] User selected `superpowers:subagent-driven-development`; implementation now proceeds under this ticket.

**Evidence:** This ticket is the deliverable. The final acceptance checklist above is for plan completion and handoff. The future implementation ticket’s final real-user acceptance is specified in Task 7 and must be completed before implementation can be called done.

## Decisions and revisions
- Keep this as a plan-only task. Implementation, baseline updates, and deployment are not authorized by the current request.
- Use the Stillwild planning hierarchy and motion concepts, not its CMS/booking system, multi-destination content model, ratings, fabricated marketing copy, or forms.
- Preserve existing visual tokens and palette exactly. Layout and interaction changes can create a more editorial travel guide without changing the identity colors.
- Review round 1: Approved, no issues or recommendations. KISS comparison: route-level editorial composition with a small shared shell foundation costs more than a simple reskin, but the reskin would not provide the requested travel-planning structure; a CMS/booking rebuild adds complexity and scope without serving this single-trip site.
