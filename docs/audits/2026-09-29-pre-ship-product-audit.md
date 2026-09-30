# Pre ship product audit — 2026-09-29

## Scope and environment

Reviewed the Club Athletic trip site on `main`: homepage chat and weekly schedule ticker, the FAQ route, desktop sidebar, mobile drawer, message sending and retry states, schedule and trip detail pages, Instagram links, and seeded trip data. Runtime checks used the production build against the configured database, Chromium at 320, 375, 390, 414, 768, 859, 860, 1280 and 1920 CSS pixels, and DOM tests for the chat state machine. The live agent provider is currently quota-limited.

## Loading and data flow

- Reproduced `POST /api/chat/conversations` returning 503 on the local server. Server logs showed the upstream provider's 400 response: the configured API usage limit is reached and access returns at `2026-10-01 00:00 UTC`.
- Read flight rules directly from the database: the latest landing cutoff is 09:30, with a target arrival time of 08:30. This confirms the information is present in trip data.
- Updated the agent instructions to name `getFlightRules` and require it for landing and return flight cutoffs. A 5xx is now presented as a temporary assistant outage rather than the misleading “not in the trip notes” answer.
- The upstream quota prevents verification of a successful live model response until the provider limit resets or is raised. UI sends and response rendering were exercised with a successful stubbed API response.

## Cross screen consistency

- The FAQ now lives at `/faq`; the homepage retains the compact schedule ticker and chat introduction. The stay answer is “Les 3 Vallées, France” without lodge name, street address, or an extra subline.
- Removed countdown and trip identity chrome from mobile and desktop shell. Mobile uses a closed-by-default drawer with Home, FAQ, and the trip sections; desktop retains the sidebar.
- Guest Instagram links appear by name on room and chef pages. Seed completed with 12 guests, 12 assigned spots, and 7 open spots; Christie Navarre shares Bedroom 4 with Christine Calvo.

## State transitions and mobile chat

- Verified typed mobile submission reaches `POST /api/chat/conversations`, clears focus from the composer, and leaves the user able to read the transcript after the optimistic message is shown.
- Verified quick options use the same send handler. DOM tests assert the send and closed keyboard state for quick-option and typed sends.
- Failure keeps one transcript bubble with retry/edit actions and does not duplicate the user message in the composer. A known server failure clears the idempotency key before a fresh retry.
- Removed the assistant response's left border/rail. Provider errors no longer render as trip-data misses.

## Navigation and visual checks

- Followed mobile drawer open/close and deep-link active state. Route layout matrix checked horizontal overflow, FAQ rows, 44px touch targets, composer geometry, flights, rooms, chef, task pills, and long trip strings.
- Desktop screenshots were regenerated for all 11 routes at 1280px and 1920px. The visual run passed 22 screenshot checks and the mobile layout checks; an expectation bug for reduced-motion ticker overflow at the 860px seam was corrected and rerun across all seven widths (7/7 passed).
- Full mobile matrix covered both sides of the 860px layout seam, including the keyboard dismissal check and drawer path.

## Verification

- `bun run test`: 528 tests passed across 42 files.
- `bun run typecheck`: passed.
- `bun run lint`: passed with existing warnings in runtime and test helpers.
- `bun run test:visual`: 122 passed before the one corrected desktop seam expectation; the affected seven-width scroller case then passed 7/7. Desktop screenshot checks all passed. A full rerun after that test-only correction was interrupted by the execution server restarting after 22 checks, before Playwright reported a final status.
- `bun run db:seed`: completed; existing rows preserved and counts verified above.

## Remaining findings and gate

- **High, external dependency:** live agent creation still receives a 503 while the upstream API usage limit is exhausted. The database has the flight answer and the prompt now explicitly calls the correct tool, but a successful live model turn remains unverified until quota is restored.
- **Medium, verification:** the corrected browser suite passed its affected seven-width check, but a final full suite run was interrupted by the execution server restart. The complete prior run had one test-only failure, now corrected.
- **Low, local development:** the already-running Vite session on port 4173 reported a stale route HMR update for `routes/chef`. Production build and production route verification passed. Restart that existing local development server to load the updated route manifest; it was not started by this audit.

**Final gate: pass with stated gaps.** The code, data, production build, automated chat coverage, and targeted UI rerun pass. The provider quota and interrupted final visual run remain verification gaps.
