# Product consistency remediation — 2026-09-29

## Audit scope

Reviewed the primary trip planning workflows in the live web app at `http://127.0.0.1:4173`: Home, Rooms, Pricing, Schedule, Chef, Flights, Shuttle, Tasks, Chalet, and Links. Compared shared trip facts and user guidance across their route components, loaders, database projections, seed snapshot, and existing route/component tests.

## Surfaces and workflows reviewed

- Home summaries against their destination pages: shuttle timing, flight cutoffs, open spots, chef meals, guest count, and week preview.
- Rooms assignments and open-bed counts against Pricing room counts and room descriptions.
- Schedule meal and event rows against Chef's meal table, totals, and milestone dates.
- Flights booking cutoffs and example recommendations against Shuttle windows and meeting points.
- Chef dietary requirement guidance against its inline edit and save controls.
- Navigation labels and the Chalet/Links listing surfaces.
- Tasks status and completion summary against confirmed guest task rows.

## Fix completed

### Chef dietary guidance matched the available action

- **Cause:** The note above the dietary table retained read-only workflow copy after inline dietary editing was introduced.
- **Change:** Replaced “Allergies or dietary needs: tell the organizer before the trip.” with “Add allergies or dietary needs in the table below before the trip.”
- **Files/surfaces:** `apps/web/app/routes/chef.tsx`; `/chef`. Added the expected wording to `apps/web/tests/routes/detail-pages.test.tsx`.
- **Verification:** The route test failed before the copy change because the new instruction was absent. After the change, `bunx vitest run --project dom tests/routes/detail-pages.test.tsx tests/components/dietary-cell.test.tsx` passed (10 tests). The live `/chef` HTML contained the new instruction and no longer contained the old one.

## Cross-surface consistency checks

- Home, Rooms, and Pricing each reported **8 open spots** in the live response.
- Rooms showed **11 confirmed guests**; the named room assignments matched those guests, and available spots plus the one not-offered spot matched the 20-person capacity representation.
- Home and Pricing showed **6 breakfasts and 5 dinners**. The live Chef meal table and Schedule rows agreed on the meal days and the two nights without chef dinner.
- Home flight guidance showed a **09:30** arrival cutoff and **10:00** return cutoff; Flights rules and Shuttle timing/locations agreed with those cutoffs and the booked transfer windows.
- Chalet listing destinations came from the same Chalet link rows shown in Links. The live chalet page displayed listing links and no image section.

## Remaining findings by severity

### Critical

None verified.

### High

None verified.

### Medium

None verified.

### Low

None verified.

## Open questions and verification gaps

- The live pages were checked through their server-rendered HTML over the local running app. I did not submit an inline dietary edit against live trip data, to avoid changing a guest record during this consistency pass. The existing dietary-cell component tests passed, including its edit/save flow.
- No unresolved consistency finding remains from the reviewed primary workflows.
