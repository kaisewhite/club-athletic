# Owner requests — 2026-09-29

Tracked so nothing said in conversation gets lost. Status is updated as each item is
verified, not when it is claimed. "Live" means visible on the running dev server
(port 4173) against Neon; "baseline" means the Playwright desktop PNGs were re-recorded.

| # | Request | Status | Proof |
|---|---|---|---|
| 1 | Mirror everything the seed pushes to Neon into the Google Sheet, multiple tabs | done, superseded by #2 | 16 tabs written and read back |
| 2 | Make the sheet people-friendly: guest-centric rows, plain-English names and values, admin tabs hidden | done | 7 visible tabs + 3 hidden owner-protected tabs; read back |
| 3 | Flights table: same 12px corner radius as the rest of the app | code done; baseline re-record running | `.flight-table-frame` in app/components/flight-table.tsx |
| 4 | Shuttle: real meeting points (outside baggage claim at GVA; pickup at the chalet), no "TBA" | live | seed pushed; /shuttle shows both; concierge note updated |
| 5 | No underlined links anywhere in the app | code done; baseline re-record running | global `a` rule → `text-decoration: none`; 8 overrides removed |
| 6 | Chalet page: real photos instead of "coming soon" | superseded by #13 | was live 13:25; removed on request |
| 13 | Chalet page: no photo section at all; the listing links are the reference | live | photo block, CSS, public/chalet and seeded paths removed; reseeded; /chalet renders 0 images and the 4 listing links |
| 7 | Pricing from the organizer's sheet: per-room all-in price, what Bedrooms 4/5/8 are, no "not available" | live | Room.pricePerPerson/description/ensuite/balcony seeded; /spots and /rooms show them; migration 20260929130000 |
| 8 | Show the all-in breakdown (room rate, taxes, shuttle, incidentals, chef) as a small readable table | code done; /spots baseline pending | `.price-breakdown` dl in app/routes/spots.tsx |
| 9 | Dietary needs cell on /chef editable in place, saves to the database | live | `/api/guests/dietary` verified: 405 GET, 404 unknown guest, 400 invalid, 200 trims + saves, empty → null; AuditLog rows with source GUEST; migration 20260929140000 applied; D23 in TODO.md |
| 10 | Copy button top-right of the dietary table, copies as text for pasting into a message | code done; /chef baseline pending | `Name: notes` per line via clipboard; happy-dom test; 525 tests pass |
| 11 | Keep the sheet in sync after data changes | done for #4, #7 | Rooms Description column, pricing breakdown rows, shuttle notes read back |
| 12 | Track every request in a to-do list | this file | — |

## Still to run once the code lands

- Re-record Playwright baselines for /spots (breakdown table) and /chef (copy button) after the current re-record finishes; only those PNGs may change.
- Apply migration 20260929140000 and reseed; confirm an inline dietary edit writes an AuditLog row with source GUEST.
- Re-mirror the sheet so the Guests tab shows dietary notes edited on the site.

## Decisions recorded on the way

- Inline edit uses React Router `useFetcher` + a resource-route action. TanStack Query was suggested; D22 (loaders/actions, no client cache library) stands because this is one field. Recorded as D23 in TODO.md.
- Google Sheets CMS: visible tabs use natural keys and words, never database ids or enum codes. The hidden "Admin – Field Map" tab is the contract for the future Neon → Sheets swap.
