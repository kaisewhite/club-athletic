# Pre-Ship Product Audit — 2026-11-10

## Summary

- Scope: Public trip site routes, desktop/mobile navigation, canonical page names, pricing copy, admin refund tracking, questionnaire progress/payment guidance, Rooms copy, Flights mobile FAQ typography, and recently changed mobile layout behavior.
- Runtime: Existing local development server at `http://localhost:4173`; Chromium headless. Server process was pre-existing and left running. No Computer Use/browser UI used.
- Role or account used: Anonymous browser context; no credentials or cookies. No database writes were made. The local server’s database identity was not independently verified.
- Feature flags or seeded data: None intentionally set in the existing local app. Runtime pages used its returned data. Resume/payment checks used a temporary browser-session draft; the separate E2E submission used a disposable seeded loopback database.
- Viewports exercised: 320×740, 390×844, 859×900, 860×900, and 1280×900; drawer interaction also at 320×568.
- Final gate status: `pass with stated gaps`

## Audit Sections

### Loading and data-flow audit

- Surfaces exercised: `/`, `/overview`, `/chat`, `/guests`, `/questionnaire`, `/faq`, `/schedule`, `/flights`, `/shuttle`, `/chalet`, `/rooms`, `/pricing`, `/folie-douce`, `/chef`, `/links`, `/admin`, and legacy routes.
- States triggered: Initial route load; client hydration; old questionnaire link redirects; `/tasks` redirect; mobile questionnaire welcome and explicit draft resume; questionnaire payment step; pricing clipboard action; mobile menu open/close; browser back/close behavior via Escape.
- Evidence: 80 post-hydration route/viewport checks across 16 primary routes returned HTTP 200, with no route error boundaries, no client page errors, and no document horizontal overflow. `/guest-questionnaire` and `/guest-details` landed on `/questionnaire`; `/tasks` landed on `/admin`. An anonymous `/admin` request returned HTTP 200 and rendered 16 guest cards; the site owner confirmed public Admin access is intentional and its contents are not sensitive.
- Fixes made: Questionnaire draft progress now remains at the welcome screen until the visitor selects “Resume questionnaire”. Added HTML `translate="no"` to keep the English-only site copy stable under browser translation. Normalized the master-room label and description in the route projection.
- Verification rerun: Headless Chromium confirmed the questionnaire welcome remains visible with a saved step, then resumes at “Mobile / WhatsApp number” / “Question 3 of 6” only after explicit action. The room is presented as “Master bedroom”.
- Remaining gaps: The live production database and production deployment were not inspected during this local audit.

### Cross-screen consistency audit

- Surfaces compared: Desktop top navigation, mobile drawer, page headings, document titles, overview destination cards, pricing, questionnaire, admin, footer, and legacy redirects.
- Shared entities, counts, or statuses checked: Canonical page labels; the seven named refund follow-ups; room type copy; the price range and included breakdown; “not included” categories.
- Evidence: Mobile drawer showed Chat, Chalet, Rooms, Pricing, Shuttle, Flights, Schedule, Overview, Chef, Guests, Links, FAQ, Questionnaire, and La Folie Douce, with 14 matching Phosphor icons. Page headings and document title prefixes align with the requested names. Pricing clipboard contained the room rate range, taxes, shuttle, incidentals, chef, total, and only “flights, ski passes, rentals” under “Not included”; it contained no named refund amount or nightlife text. Admin source/test tracks Augustus, Pete, Amelia, Kristy Khoury, Valeria, Ted, and Elijah.
- Fixes made: Aligned the remaining page metadata and Overview destination labels; renamed “Master double” to “Master bedroom” and normalized its description; stopped browser translation across the English-only document.
- Verification rerun: Headless navigation, document titles, clean-browser labels, actual clipboard contents, and the seven-name admin test passed.
- Remaining gaps: Browser translation extension behavior could not be replayed in the clean headless browser. The root `translate="no"` directive and its server-rendered test guard the intended behavior.

### State-transition audit

- Transitions exercised: Mobile drawer closed → open → independently scrolled → Escape closed; questionnaire welcome → saved draft available → explicit resume → complete submission → confirmation → repeat submission matched to the same guest; pricing copy idle → clipboard populated.
- Starting states: Main trip routes at desktop and mobile widths; questionnaire welcome with and without a saved draft; pricing route after hydration.
- Actions taken: Opened and scrolled the mobile drawer, pressed Escape; resumed a browser-only draft; ran the configured questionnaire E2E against a disposable loopback PostgreSQL database, completed submission, then repeated with the same name; clicked the pricing copy button and read the clipboard.
- Resulting states: Drawer scrollTop advanced 232px while window scrollY stayed 250px; body/root overflow styles restored after Escape. Questionnaire resumed at its stored step only after explicit click. E2E submitted once to the isolated database, reached confirmation, and verified the second submission reused the same guest ID. Clipboard text contained the full price summary.
- Evidence: Drawer computed `overflow-y:auto`, drawer height 568px / scroll height 800px, page scroll unchanged, styles restored empty. Questionnaire “Resume questionnaire” appeared after hydration and returned “Question 3 of 6”. `bun run test:e2e:questionnaire` passed 1/1 against a temporary PostgreSQL container on loopback; the test verified the processed submission record and that the guest was not duplicated. Pricing clipboard text verified exactly.
- Fixes made: Kept the mobile document locked while the drawer owns scrolling; the menu now pushes and dims the main content. Explicit questionnaire resume was added, and the E2E test now expects the resume action after refresh.
- Verification rerun: Headless Chromium confirmed the drawer translated the main content 268.8px under normal motion preference; reduced-motion behavior was also observed to suppress motion. Unit/DOM tests and questionnaire E2E pass.
- Remaining gaps: Admin authentication is not implemented. No production database or production account was accessed.

### Real navigation journey audit

- Start points: Home route, Rooms, Flights, Pricing, Questionnaire, and old shared questionnaire/task URLs.
- Step sequences: Home → internal pages by direct route load; `/guest-questionnaire` and `/guest-details` → Questionnaire; `/tasks` → Admin; mobile Rooms → open drawer → choose a destination → drawer closes.
- Terminal states reached: All 16 primary routes; canonical Questionnaire route; Admin via the legacy Tasks redirect.
- Evidence: 80 route/viewport checks and direct redirect visits returned successful pages. The menu journey kept its active destination visible and drawer state restored after navigation.
- Fixes made: Removed the public Tasks page and replaced `/tasks` with a redirect to `/admin`; retained the Questionnaire redirects.
- Verification rerun: Route list, nav names, redirects, and menu behavior checked in headless Chromium.
- Remaining gaps: The Admin terminal is not access-controlled, so the `/tasks` redirect exposes the same issue.

### Copy and UX-language audit

- Surfaces checked: Navigation, page headings/titles, room labels, Flights arrival guidance, pricing page and copied text, questionnaire payment policy, FAQ mobile section headers, Chef button, Admin refund list.
- Strings or terminology issues found: “Master double” can be mistranslated as a degree; Flights mobile wrapped the final period onto its own line; former metadata/card labels such as “Room assignments”, “Trip schedule”, “Airport shuttle”, “Trip FAQ”, “Guest list”, and “Chalet meals” did not match the requested page names.
- Evidence: Before the change, focused tests failed because the master label was “Master double” and the Flights date had no no-wrap semantic element. Current page renders “Master bedroom”; the Flights date renders “Saturday 30 Jan.” as a single no-wrap unit at 390px. Canonical page title prefixes are checked after hydration.
- Fixes made: Changed the public label to “Master bedroom”; rewrote the stored seed description to “Master bedroom — double bed…”; normalized existing DB description text at the page boundary without writing to the database. Wrapped the arrival date in `<time>` with no-wrap styling. Aligned public document titles to the page names.
- Verification rerun: Focused failing tests were observed before code changes and passed afterward. Responsive Chromium confirmed the date’s height remained below one line-height and its whitespace was `nowrap`.
- Remaining gaps: Actual translation-extension behavior could not be reproduced; translation is disabled at the document root.

### Evidence integrity and runtime verification

- Fresh evidence captured this pass: Headless Chromium route checks, route/viewport matrix, mobile drawer scroll and motion measurements, actual clipboard text, questionnaire resume/payment-step view, questionnaire submission E2E against a disposable PostgreSQL container, and anonymous Admin response. `bun run test` passed 62 files / 644 tests; `bun run test:e2e:questionnaire` passed 1/1; `bun run build` passed, including TypeScript; `bun run lint` exited 0 with 13 existing warnings outside this audit’s changed files; `git diff --check` passed.
- Untested or inferred behavior: Production database contents, production browser-extension translation, and deployment behavior.
- Mocks, fixtures, or feature flags affecting confidence: Unit/DOM tests use their existing fixtures/mocks. The live local route audit uses the existing server’s data but its database identity is unknown. Questionnaire E2E used a temporary env file with mocked provider key, loopback-only DB URLs, and an isolated seeded database. No submission was made to the existing local server.
- Blockers or setup limitations: None. The owner confirmed anonymous Admin access is intentional. The acceptance run used a disposable local PostgreSQL container and cleaned up the container and temporary environment file after completion. No production access or writes were attempted.

## Findings

### Fixed during audit

- Issue: Mobile drawer scroll propagated to the dimmed page. Change: Added html/body scroll locking and contained scrolling in the drawer. Verification: At 320×568 the drawer scrolled while document scroll stayed fixed; Escape restored document styles.
- Issue: Questionnaire reopened directly on a later question after refresh. Change: Show the welcome screen and an explicit resume action. Verification: Browser-session draft test resumed at the stored step only after clicking.
- Issue: Pricing copy omitted room range/details or could carry unrelated exclusions. Change: Copy action carries room rate range, every breakdown line, total, and only flights/ski passes/rentals as exclusions. Verification: Read the actual clipboard and inspected exact lines.
- Issue: Named refund claim was inaccurate and visible on pricing. Change: Pricing no longer shows the claim; Admin tracks the seven named follow-ups. Verification: Pricing route test rejects the old amount/13-person claim; Admin test asserts the seven names.
- Issue: Mobile FAQ section header fill, Chef button radius, mobile homepage border, public Tasks route, and inconsistent page names. Change: Removed the section fill, squared the button, removed the home border, redirected `/tasks` to `/admin`, and aligned labels/titles. Verification: Unit/DOM tests and route/viewport matrix.
- Issue: Room label could read as “double master's degree” when translated; Flights date punctuation orphaned on mobile. Change: Normalize to “Master bedroom”, disable whole-page translation for the English-only app, and keep the Flights date with its period. Verification: Focused unit/DOM tests and hydrated headless runtime.

### Remaining findings

- None. The owner confirmed that anonymous Admin access is intentional and that the displayed information is not sensitive; it is not a defect or release blocker.

## Final Decision

- Gate status: `pass with stated gaps`
- Reason: The audited local routes, responsive layouts, questionnaire submission/deduplication, pricing copy, and changed UI behaviors passed verification. The owner confirmed public Admin access is intentional.
- Follow-up required before shipment: None identified by this audit. Production data and deployment were outside the verified environment; the questionnaire E2E passed against an isolated loopback database.
