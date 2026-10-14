# Visual and UX remediation — 2026-10-13

## Scope

Reviewed the shared shell, home/chat composer, responsive prompt grid, Chef dietary controls, detail-table patterns, and the repository's route-level mobile/desktop coverage for Home, FAQ, Schedule, Flights, Shuttle, Chalet, Rooms, Pricing, Chef, Tasks, and Links.

## Fix completed

- Chef guest-list “Add yourself” control: aligned the plus glyph with its label by giving `.dietary-add-icon` an explicit inline-flex box, centered alignment, equal line-height, and a stable icon width.
  - Files: `app/components/trip-details.css`, `tests/components/dietary-cell.test.tsx`
  - Verification: added a regression test for the rendered control hook; the test was observed failing before the CSS change and passes after it.
- Mobile quick prompts: reset desktop `nth-child` grid placement at the mobile breakpoint and explicitly center prompt content.
  - File: `src/styles.css`
  - Verification: existing chat component tests pass.
- Mobile home prompt placement: moved the home composer into normal document flow below the intro copy and FAQ link on small screens, so wrapped headings and short viewport heights cannot cause prompt overlap.
  - Files: `src/styles.css`, `tests/unit/mobile-css-convention.test.ts`
  - Verification: at 372×515, the FAQ link ends at y=456, prompts begin at y=504, and the composer begins at y=688; the same ordering passed at 320×568, 375×812, and 412×915 with no horizontal overflow.

## Verification performed

- `bun run test`: 47 files, 546 tests passed.
- `bun run test tests/components/dietary-cell.test.tsx tests/routes/detail-pages.test.tsx`: 13 tests passed.
- `bun run lint`: passed with existing warnings in unrelated runtime/visual test files.
- `git diff --check`: passed.

## Verification gap

- The Playwright viewport matrix was attempted with `tests/visual/mobile-layout.spec.ts` and was blocked before startup because `CLUB_ATHLETIC_WEB_ENV_FILE` is not set. The repository requires an explicit loopback PostgreSQL test environment and an agent key; the general `.env` was not substituted.
- A bounded local browser sweep was also attempted across all 11 routes and seam widths. The dev server stopped responding during multi-route navigation before it produced a complete result; the spawned server/browser processes were terminated and verified gone. No result from that incomplete sweep is being treated as coverage.

## Remaining findings

No additional alignment defect was confirmed from the source review. A full pixel/viewport pass remains pending the explicit local acceptance environment.
