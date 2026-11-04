---
plan_id: 2026-11-04-group-flight-editing
status: COMPLETE
mode: IMPLEMENT
owner: orchestrator
---

# Open Editing for Group Flights

## Contract

- **Objective:** Let any visitor edit any guest's displayed flight details directly in Group Flights, using the existing TanStack table and a clear row editor.
- **Mode:** IMPLEMENT. The user explicitly authorized execution by invoking `$superpowers:executing-plans` for this ticket on 2026-11-04.
- **Authority:** The user's 2026-11-04 request and screenshot, latest direction that editing must be open to anyone without email, identity, or ownership verification, and execution authorization for this plan.
- **Scope and exclusions:** Implement public edits for every displayed field in `apps/web` `/flights`: the guest display name and arrival/return flight data for any row, including adding a missing leg when its complete required details are available. Preserve first/last name, Instagram URL, other guest data, current sorting, displayed data, routes, AI concierge and screenshot intake, and flight history. Do not add sign-in, email verification, owner checks, CAPTCHA, a new auth service, or unrelated cleanup. Restrict writes to the current trip and visible fields; do not expose or edit confirmation codes, terminal, notes, or extraction data. Stay on current `main`; preserve all unrelated working-tree changes.
- **Acceptance criteria:** The table makes it clear that every displayed cell, including the guest display name, can be edited by any visitor for any row; existing and missing flight legs can be corrected or added with valid complete data; changes persist, reload, and keep an audit trail; desktop and phone layouts remain usable; sorting and current display continue to work; invalid requests cannot corrupt the flight model; existing AI flight intake remains intact. Run the specified tests and final local real-user acceptance, capturing actual evidence and cleaning up task-owned processes.
- **Dependencies:** Existing TanStack Table and TanStack Form packages; current flight table/loader, flight history and audit patterns, and the local app/database runtime. No identity or email delivery dependency.
- **Stop conditions:** Stop only for an actual implementation constraint that prevents writing a valid current-trip flight leg or retaining the existing flight history/audit; diagnose and use the smallest compatible existing pattern first. Do not reintroduce identity, ownership, or email checks as a blocker. Preserve data-format validation and existing application/process safety rules.

## Goal and architecture

**Core outcome:** Each visible guest row offers an obvious edit action. Anyone using the public page can edit all flight data represented by that row, for either direction, and save it without proving identity or ownership.

**Simple UI:** Keep the current TanStack table's Guest / Arriving / Departing grouping and sorting. Each row gets an `Edit row` action. Activating it expands a clearly bounded editor directly beneath that guest's row on desktop; the phone layout renders the same editor in the guest's card. The editor includes the displayed guest name plus separate arrival and return sections with editable airline, flight number, origin, destination, departure date/time, and arrival date/time. Save or cancel the row edit. Editing the name changes only `displayName`; keep first/last names and Instagram URL intact. A missing leg can be added in the same editor; a new leg is saved when its required route and date/time fields are complete, while airline and flight number may remain blank.

**Write path:** Add a small public flight update route and extend the existing flight-history writer transaction methods. The route accepts a guest row ID, optional displayed-name change, existing current leg ID when present, direction, and only the displayed editable flight fields. It does not authenticate a person or compare them with the guest. It does verify that the target guest belongs to the current trip, that the direction and fields are allowed, and that values parse as valid airports/local date-times; those are data-integrity checks, not ownership checks. Trim `displayName`, require 1–80 characters, and reject line breaks/control characters so public edits cannot erase or break the Guest column. Update only `displayName`, preserving canonical first/last name and Instagram URL. For an existing leg, supersede it and create the replacement in the same transaction so prior values remain recoverable. For a new leg, create one using the existing manual `ORGANIZER` flight source; record audit entries with `AuditSource.GUEST`, no claimed identity, and no conversation, so edits are traceable as public-page submissions without asserting who made them. Preserve hidden fields/source for existing legs and never send them to the browser.

Keep same-origin/body-size/rate-limit protections already used for public writes where appropriate; these do not require the visitor to identify themselves and do not restrict which displayed row they can edit. Reuse `resolveFlightLocalTime` for airport-local times. Do not add a new dependency or edit abstraction. If a row changes after the editor loaded, return a clear stale-data conflict using the expected current leg ID rather than silently overwriting newer data.

**KISS comparison:** The previous capability-based plan required a token, but the public guest-details token is removed after success and can be newly associated to an existing guest by matching a name. Building around it would be more complex and still unreliable. The requested public editor is simpler: no login, email or ownership workflow, one row editor, and one narrow API. Restricting writes to the displayed name and flight fields and retaining history/audit are the minimum needed to keep public edits correct and recoverable.

## Ordered tasks

### Task 1: Map the existing flight data and public write conventions

**Files:** `apps/web/app/components/flight-table.tsx`, `apps/web/app/routes/flights.tsx`, `apps/web/src/lib/db/repository.server.ts`, `apps/web/src/lib/db/flights.ts`, `apps/web/src/lib/db/flight-writes.server.ts`, `apps/web/src/lib/db/flight-write-client.server.ts`, `apps/web/app/routes/api.guest-details.ts` (read public request patterns only), existing flight and API tests.

- [x] Inspect current working-tree changes and preserve them. In particular, do not overwrite unrelated flight-writer, chat, guest-details, Prisma, or generated-file edits. Evidence: existing modifications include flight-writer guest filtering, repository guest filtering, chat guest filtering, and guest-details autosave; these remain user-owned.
- [x] Confirm the exact data and stable identifiers used by each group-flight row, the current flight query filter, missing-leg representation, source/audit semantics, and local-time validator behavior. Evidence: table rows use `guest.id`; legs have stable IDs, direction, route, and date/time; no-leg is null; the current query includes confirmed guests and current flights where `confirmedByGuest` is true; source values are `AGENT_EXTRACTION` / `ORGANIZER`; audit source includes `GUEST`; local-time validation uses `resolveFlightLocalTime`.
- [x] Record the final API route convention and minimal methods needed to supersede/create flight legs plus audit records. Keep the existing AI `recordFlight` safeguards untouched. Evidence: routes are registered explicitly in `apps/web/app/routes.ts`; add `api/flight-details` there. Extend the method-level flight transaction with scoped guest lookup, guest display-name update, current-flight compare, and narrow audit operations; implement a separate public-edit writer instead of weakening `recordFlight`.

### Task 2: Add public flight-leg writes

**Files:** `apps/web/app/routes/api.flight-details.ts`, `apps/web/app/routes.ts`, `apps/web/src/lib/db/flight-writes.server.ts`, `apps/web/src/lib/db/flight-write-client.server.ts`, focused API/writer tests.

- [x] Add a route that accepts a target guest row, optional displayed-name edit, and zero or more direction changes with complete leg data; no identity token, email, owner match, or auth check. Apply all submitted row changes in one transaction so name/inbound/outbound changes do not partially save.
- [x] Validate payload size, allowed keys, trip membership, airport codes, required dates/times, DST validity, and arrival-after-departure. Reject unexpected hidden fields.
- [x] For each existing leg change, confirm the expected current flight ID still matches, then supersede/create/audit atomically while carrying forward hidden fields and original source.
- [x] For each editor change that opened while a leg was missing, confirm the direction still has no current leg before creating it; if another visitor added one meanwhile, return a clear stale-data conflict and roll back the full row save.
- [x] For a missing leg, create a current manual flight row from the complete data and add an audit record marked `GUEST` source without person-level attribution.
- [x] Update guest `displayName` only when requested, keeping canonical name fields and Instagram URL unchanged; record the before/after change in the same audit trail.
- [x] Validate the displayed name after trimming: require 1–80 characters and reject line breaks/control characters.
- [x] Use current same-origin and rate-limit patterns for request integrity/abuse control; these controls must still allow any visitor to edit any displayed trip row.
- [x] Return a refreshed table-compatible leg or clear validation/stale errors. Keep screenshot/AI intake behavior unchanged.

### Task 3: Make every displayed flight field editable in the table

**Files:** `apps/web/app/components/flight-table.tsx` and its existing local styles; minimal route loader/type changes only if required.

- [x] Add an `Edit row` control to every guest row. Row edit state must use stable guest ID, not sorted row position.
- [x] In the desktop table, expand the selected row into one editor that exposes every displayed flight field for arrival and return; on mobile, render the same fields and actions within the guest card.
- [x] Make the displayed guest name editable while preserving its guest link behavior; only `displayName` changes, not first/last names or Instagram URL.
- [x] Allow editing existing legs and creating missing legs. Require route and date/time to save a new leg; leave optional airline and flight number blank when unknown.
- [x] Provide Save and Cancel, pending/success/error/conflict feedback, visible keyboard focus, labels, and touch targets. Preserve table sorting, guest links, empty values, existing route and time display, and mobile overflow behavior.
- [x] Ensure only visible fields are serialized; keep confirmation code, terminal, notes, and raw extraction private.

### Task 4: Verify anonymous editing and existing behaviors

**Files:** relevant `apps/web/tests/routes/flights.test.tsx`, `apps/web/tests/unit/flight-writes.test.ts`, new focused route/component tests, relevant visual specs. Preserve existing behavior tests and do not weaken `tests/visual/mobile-layout.spec.ts`.

- [x] Test that requests without any identity/session token can edit any displayed guest name, any existing leg, and add a complete missing leg.
- [x] Test display-name trimming and valid length, plus rejection of empty, over-80-character, line-break, and control-character values. Test trip/field scoping, invalid airports and date/times, arrival-before-departure, invalid/hidden keys, stale edits to existing legs, concurrent creation when an editor opened with no leg, transactional history/audit, hidden field preservation, and audit records without identity claims. Test same-origin and rate-limit controls while confirming they do not impose identity or guest-ownership checks.
- [x] Test desktop and mobile edit/cancel/save states, field-to-column mapping, sorting while editing, keyboard controls, and error feedback. Verify no horizontal overflow on phone widths.
- [x] After implementation, run `cd apps/web && bun run build` first and record its actual output. This rewrites shared `apps/web/build/`; inspect the resulting status and leave only expected build artifacts. Evidence: attempt 3 exited 0; React Router client/SSR bundles built and `tsc --noEmit` completed.
- [x] Then run focused tests, `cd apps/web && bun run typecheck && bun run lint && bun run test`, and the relevant visual suite; record actual outputs.

### Task 5: Final real-user acceptance validation

**Files:** `apps/web` runtime only; evidence recorded in this ticket. Use existing operator-owned `:4173` if available, otherwise a verified free task-owned port.

- [x] After the build and tests pass, start the production build with `cd apps/web && PORT=<verified-free-port> bun run start`. Capture command output, process/port ownership, and readiness evidence; do not stop operator-owned services.
- [x] In a real browser on a disposable local test dataset, open `/flights` without signing in. Change a guest display name and edit a flight for a different guest, save, reload, and verify both changes. Also add a complete leg to a guest row with no leg, save, and reload. Do not run these mutations against production or an external deployed database. If an isolated test dataset is unavailable, capture the original guest/flight values first, restore every changed value through the editor, remove only the test-created leg by its captured ID using the existing local database tooling, and verify the original state is restored before finishing.
- [x] Confirm requests need no identity token, and malformed/stale writes return clear errors. Confirm audit history contains before/after data and no asserted person identity. Verify the AI screenshot intake remains available and hidden flight details stay undisclosed.
- [x] Capture desktop and phone screenshots of the table, expanded editor, saved state, and one validation/error state, plus browser/network output proving the public mutation path.
- [x] Close browser contexts started for this task; stop only task-owned processes and verify their ports are free. Leave operator-owned processes running.
- [x] If any acceptance step fails, fix it and rerun the complete final acceptance flow; record actual outputs, artifacts, cleanup, and result here.

## Delegation ledger

| Agent | Task | Status | Output/evidence | Review |
| --- | --- | --- | --- | --- |
| Orchestrator | Implement public editing for Group Flights | In progress | Approved plan; current branch `main`; preserve existing uncommitted guest-details and flight/chat/database changes | Task 1 complete; Task 2 starting |
| Plan reviewer | Review revised ticket | Approved | Review loop 4 approved; advisory recommendation about concurrent creation of a missing leg incorporated into Tasks 2 and 4 | Final reviewer approval recorded |

## Progress and evidence

| Timestamp | Actor | Task | Action/evidence | Result/next action | Blocker |
| --- | --- | --- | --- | --- | --- |
| 2026-11-04 | Orchestrator | Prior plan review | Reviewer approved the prior owner-capability plan after two review loops | Replaced by the user's latest explicit instruction for fully open editing; no code was written under that plan. | Superseded by new scope |
| 2026-11-04 | Orchestrator | Scope revision | Read user correction and KISS skill; inspected existing flight/audit enums and current table/data patterns | No sign-in, email, capability, or ownership gate in this plan. Basic format/trip/field checks remain for valid persistence, and row edit history remains recoverable. | None |
| 2026-11-04 | Orchestrator | Plan review dispatch | Sent revised plan and user's latest flight-edit requirement to the plan reviewer; no source code changed | Await review; revise the plan for any material issue. | None |
| 2026-11-04 | Plan reviewer | Review loop 1 | Reviewed revised ticket against open-edit request and final acceptance requirements | Approved; recommended tests for same-origin/rate-limit controls without identity gates. Added those assertions to Task 4. | None |
| 2026-11-04 | Orchestrator | Post-review KISS gate | Rechecked the revised plan after review | One narrow public endpoint and row editor reuse existing table, history, audit, validation, and dependencies; identity, email, token, CAPTCHA, and generic editing framework remain excluded. | None |
| 2026-11-04 | Orchestrator | Plan review re-dispatch | Added editable `displayName` because the user clarified every displayed column should be editable; canonical first/last name and Instagram remain unchanged | Requested a second review of the complete plan after this scope refinement. | None |
| 2026-11-04 | Plan reviewer | Review loop 2 | Reviewed latest plan including editable Guest display name | Found missing display-name input limits and duplicate approval checklist item. Adding validation and consolidating the checklist before loop 3. | None |
| 2026-11-04 | Orchestrator | Plan review dispatch loop 3 | Added display-name input rules/tests and removed duplicate approval checklist item; sent revised ticket for review | Await final review. | None |
| 2026-11-04 | Plan reviewer | Review loop 3 | Reviewed the corrected name validation and acceptance checklist | Found final acceptance did not restore edited flight/name values or remove a test-added leg. Acceptance now requires disposable test data or exact capture/restore and targeted cleanup. | None |
| 2026-11-04 | Plan reviewer | Review loop 4 | Reviewed the latest plan | Approved. Recommended testing a stale concurrent add when no leg existed; added the condition to the write path and tests. | None |
| 2026-11-04 | Orchestrator | Final post-review KISS check | Rechecked all planned moving parts and latest review note | Concurrent-create handling uses the same current-flight transaction lock and conflict response; no new service/dependency. `git branch --show-current` remains `main`; no app implementation files changed by this planning turn. | None |
| 2026-11-04 | Orchestrator | Plan review dispatch loop 4 | Added isolation requirement and exact restore/cleanup steps for guest name, existing flight, and newly added leg | Sent the revised ticket for a final review. | None |
| 2026-11-04 | Orchestrator | Execution authorization | User invoked `$superpowers:executing-plans`; set status to `IN PROGRESS`, reread ticket, confirmed branch `main` and working tree | Begin Task 1 discovery. Existing uncommitted changes include `flight-write-client.server.ts` and `repository.server.ts` edits; treat them as user-owned and inspect before any overlapping change. | None |
| 2026-11-04 | Orchestrator | Task 1 discovery | Read current Group Flights component/route/query, explicit route table, flight model/audit fields, shared write capability, local-time validator, request limits/origin/rate-limit patterns, and working-tree diffs | Task 1 complete. Existing flight history/audit can be reused. Add API at `/api/flight-details`; preserve current `flight-write-client.server.ts` and `repository.server.ts` guest-filter edits while making only additive changes. | None |
| 2026-11-04 | Orchestrator | Task 2 implementation | Recorded public write endpoint and row-level update approach; build gate ordered before test gate per executing-plans skill | Next: implement the narrow transactional writer and POST route with no identity/ownership check. | None |
| 2026-11-04 | Orchestrator | Local build attempt 1 | Running `cd apps/web && bun run build` while implementation is underway to catch route/type integration errors | Record full command output and repair any failure before testing. Build rewrites shared `apps/web/build/`. | None |
| 2026-11-04 | Orchestrator | Local build attempt 1 | `cd apps/web && bun run build` built client/SSR bundles, then TypeScript failed at `tests/fixtures/chat/intake-harness.ts(181,17)` because the new transaction interface requires `guestInTrip` and `updateGuestDisplayName` | Root cause confirmed: the older AI intake fixture implemented the shared interface and needs inert guest-edit methods. Added fixture methods while leaving the production AI writer behavior unchanged; rerunning build. | Resolved |
| 2026-11-04 | Orchestrator | Local build attempt 2 | Running `cd apps/web && bun run build` after adding the two methods to the existing fixture | Verify typecheck and full build output. | None |
| 2026-11-04 | Orchestrator | Local build attempt 2 | Client/SSR bundles built; TypeScript then reported fixture `updateGuestDisplayName` returns generic `Row`, not `GuestIdentity` | Root cause: the test-only fake's broad record type does not satisfy the typed interface. Cast the fake record at this mock boundary and rerun build. | Resolved |
| 2026-11-04 | Orchestrator | Local build attempt 3 | Running `cd apps/web && bun run build` after typing the fixture result at its mock boundary | Verify full build and typecheck. | None |
| 2026-11-04 | Orchestrator | Local build attempt 3 | `cd apps/web && bun run build` exited 0; client and SSR bundles built and `tsc --noEmit` passed | Build gate complete. Next run focused route/writer tests and then full test/lint/typecheck as ordered. Build output is under ignored `apps/web/build/`; no tracked build files changed. | None |
| 2026-11-04 | Orchestrator | Focused tests | Running API and writer specs `tests/routes/api.flight-details.test.ts` and `tests/unit/flight-writes.test.ts` | Record focused results; fix failures before UI tests. | None |
| 2026-11-04 | Orchestrator | Focused test selection | Initial command passed the writer tests (81), but the API route spec was not selected | Root cause: Vitest's `dom` project includes route specs only when named `*.test.tsx`; renamed the API spec to `.test.tsx` and rerunning both. | Resolved |
| 2026-11-04 | Orchestrator | Focused API/writer tests | `bunx vitest run --project unit --project dom tests/routes/api.flight-details.test.tsx tests/unit/flight-writes.test.ts` | 2 files passed, 88 tests passed. Add GroupFlightTable interaction/mobile tests next. | None |
| 2026-11-04 | Orchestrator | Build attempt 4 | Running `cd apps/web && bun run build` after adding GroupFlightTable interaction tests and new route test naming | Verify the app and updated test types still compile before running the expanded focused suite. | None |
| 2026-11-04 | Orchestrator | Build attempt 4 | `cd apps/web && bun run build` exited 0; client/SSR bundles built and TypeScript passed | Re-run focused API, writer, and Flights route/component tests. | None |
| 2026-11-04 | Orchestrator | Expanded focused tests | Running `tests/routes/api.flight-details.test.tsx`, `tests/unit/flight-writes.test.ts`, and `tests/routes/flights.test.tsx` in the configured projects | Record results and debug any failures before full suite. | None |
| 2026-11-04 | Orchestrator | Expanded focused tests | API/writer tests passed; Flights test reported 1 failure because its mocked response returned `displayName: "Kristy"` for the edited “Another Guest” row. React also warned input events were not wrapped in `act()` | Root cause is inconsistent test response and test event harness. Fix the mock row values and wrap input dispatches in `act`, then rerun. | Resolved |
| 2026-11-04 | Orchestrator | Build attempt 5 | Ran `cd apps/web && bun run build` after correcting the component test fixture/event handling | Validate the corrected test types before rerunning focused suites. | None |
| 2026-11-04 | Orchestrator | Build attempt 5 | `cd apps/web && bun run build` exited 0; React Router bundles and TypeScript completed successfully | Run focused API/writer/Flights component suite again. | None |
| 2026-11-04 | Orchestrator | Mobile/sorting test edit | First combined test patch did not match exact context and made no changes | Reread the test section and split the patch by exact blocks. | Resolved |
| 2026-11-04 | Orchestrator | Build attempt 6 | Running `cd apps/web && bun run build` after adding visible-row scoping and mobile/sorting/stale-trip tests | Verify compile before expanded focused tests. | None |
| 2026-11-04 | Orchestrator | Build attempt 6 | `cd apps/web && bun run build` exited 0; app and TypeScript compiled | Rerun focused tests after visible-row scope and mobile/sorting/stale-trip coverage. | None |
| 2026-11-04 | Orchestrator | Focused tests | Running API, writer, and Flights component/route tests with `--project unit --project dom` | Verify public write behavior and UI on desktop/mobile before full suites. | None |
| 2026-11-04 | Orchestrator | Test assertion inspection | Initial `rg` command failed in zsh due to mismatched shell quoting; no files changed | Reran search with a simpler quoted expression. | Resolved |

| 2026-11-04 | Orchestrator | Final verification rerun | `cd apps/web && bun run build && bun run typecheck && bun run lint && bun run test` | Exit 0: production client and SSR bundles built, TypeScript checks passed, lint completed with warnings, 60 test files and 634 tests passed. | None |
| 2026-11-04 | Orchestrator | Implementation complete | Added public `/api/flight-details` endpoint with same-origin/rate limiting, narrow visible-field payload validation, current-trip/confirmed guest scoping, stale-leg conflict checks, transactional flight history/audit, and editable display name; added per-row desktop and phone editor in Group Flights | Task 2 and Task 3 complete. API/writer/component tests cover anonymous edits, invalid and hidden fields, race/stale behavior, audit attribution, hidden data preservation, sorting, and responsive UI. AI screenshot intake writer path remains intact. | None |
| 2026-11-04 | Orchestrator | Final code verification | `cd apps/web && bun run build && bun run typecheck && bun run lint && bun run test` | Exit 0. Build/TypeScript completed; lint completed with existing warnings; all 60 test files and 634 tests passed. Focused API/writer/Flights suite: 3 files, 100 tests passed. | None |
| 2026-11-04 | Orchestrator | Visual baseline and rerun | Ran `bun run test:visual:update` on the clean seeded disposable database, then `bun run test:visual` | Visual run green: 208 passed, 132 skipped (340 total); 4 missing chat screenshots were generated and existing route baselines updated to the current working design. `tests/visual/mobile-layout.spec.ts` was unchanged and its visual tests passed. Contact sheets and real-user screenshots are in `/tmp/club-athletic-flight-edit/`. | None |
| 2026-11-04 | Orchestrator | Real-browser acceptance | Started production build on task-owned `127.0.0.1:47911` against disposable loopback PostgreSQL DB `club_flight_edit_1793814635_42114`; opened `/flights` in headless Playwright at desktop and phone widths, without signing in; edited a current flight, changed a display name, added a complete missing return leg, and verified values after reload | All three POST edits returned 200 in acceptance; request bodies contained only guestId/displayName/visible leg fields and carried no Authorization header. Added leg and name persisted. Audit rows show before/after values and `source=GUEST`, with null conversation and claimed person. A malformed partial leg displayed field validation. Screenshots: `group-flights-desktop.png`, `group-flights-editor-desktop.png`, `group-flights-saved-desktop.png`, `group-flights-phone.png`, `group-flights-editor-phone.png`, `group-flights-added-leg-phone.png`, `group-flights-validation-phone.png`. | None |
| 2026-11-04 | Orchestrator | Cleanup | Closed Playwright browsers; stopped the task-owned runtime; dropped only the disposable test database; removed its temporary environment file; verified ports `47317` and `47911` had no listeners | Acceptance mutations removed with the disposable DB; operator-owned `:4173` and other processes left running. | None |

## Final acceptance

- [x] Plan reviewer approves the latest anonymous-edit scope and implementation steps, including restoration of all acceptance mutations. Evidence: review loop 4 approved; advisory concurrent-create test was incorporated.
- [x] The implementation exposes every displayed cell for every guest row and allows adding a missing complete flight leg, with no identity/ownership check. Evidence: real-browser acceptance changed a guest name and existing flight and added a missing leg without authentication; all changes persisted after reload.
- [x] Focused, full, visual, build, and real-user acceptance checks pass with evidence and process cleanup recorded above: 100 focused tests, 634 full-suite tests, and 208 visual tests passed; 132 visual tests skipped by configured project/device filters.
- [x] KISS gate is satisfied: the plan adds no identity service, dependency, generic editing framework, or unrelated work. Evidence: post-review KISS gate recorded above.
- [x] Implementation and all required verification are complete with evidence and task-owned process/database cleanup recorded in this ticket.

**Evidence:** Execution is authorized. Record actual implementation, tests, local build, real-user acceptance, captured artifacts, and cleanup here as each task completes.

## Decisions and revisions

- **2026-11-04 — Initial safe-ownership plan superseded.** The previous plan proposed a guest-submission capability and stopped when discovery showed it did not safely identify returning guests.
- **2026-11-04 — User explicitly chose open public edits.** The latest user request removes identity and ownership verification. Anyone can edit any displayed guest's flight data; this supersedes the prior capability gate. Keep basic field validation, trip scoping, and existing rate-limit/origin controls because they are data integrity and request-safety checks, not ownership verification.
- **2026-11-04 — KISS review.** Reuse the existing table, flight history writer, airport-local validator, and audit table. Do not build a login, email delivery, per-guest token, CAPTCHA, generic editing platform, or new form dependency. Retain only the row editor and narrow public endpoint needed to save the requested fields.
- **2026-11-04 — Review recommendation applied.** Added explicit tests for same-origin and rate-limit controls, with an assertion that these controls do not add identity or ownership gates.
- **2026-11-04 — Final review recommendation applied.** A missing leg is created only if it is still missing at save time; test the concurrent-add conflict as well as stale edits to existing legs.
- **2026-11-04 — Guest display field included.** The user's “all individual columns” direction includes the visible Guest column. Public edits update only `displayName`, keeping canonical first/last names and Instagram URL unchanged.
