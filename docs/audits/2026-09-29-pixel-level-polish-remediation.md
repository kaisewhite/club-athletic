# Pixel level polish remediation — 2026-09-29

## Scope

Reviewed the homepage ticker and chat entry, FAQ page, mobile and desktop navigation, chat send/error states, and room/chef guest names on desktop and mobile.

## Fixes completed

- Moved FAQ content off the homepage and into `/faq`; kept the homepage focused on chat and the compact, continuously animated weekly schedule ticker.
- Switched mobile navigation to a conventional menu button and accessible drawer with close, Escape, focus handling, and active route styling.
- Removed the repeated trip icon/name, date and countdown chrome. Kept the stay answer concise and removed the lodge name/address from that FAQ answer.
- Raised the homepage FAQ link to a 44px touch target after the browser sweep found a 20px link.
- Blurred the chat composer at mobile send start so the soft keyboard closes and the optimistic message can be seen. This applies to typed sends, retries, and quick options through the shared send handler.
- Removed the assistant notice's left accent rail. Replaced the misleading trip-notes fallback on server errors with temporary outage copy.
- Added Instagram profile links to guest names in rooms and chef views; reseeded Christie Navarre into Christine Calvo's room.
- Added `getFlightRules` to both copies of the concierge instruction and bound it to landing and return cutoff questions.

## Surfaces and states checked

- Desktop visual baselines for 11 routes at 1280px and 1920px.
- Mobile layout at 320px, 375px, 390px, 414px, 768px, 859px, and 860px, including touch target sizes, horizontal overflow, FAQ rows, drawer navigation and typed-send keyboard dismissal.
- Chat unit/DOM cases for quick-option send, typed send, failure message placement, retry idempotency, attachment retry, and incomplete acknowledgements.
- DB-backed production build routes and post-seed guest/spot counts.

## Verification and remaining gap

`bun run test` passed 528 tests, `bun run typecheck` passed, `bun run lint` exited successfully with existing warnings, and all desktop snapshots passed. The complete production visual run found one test expectation issue at 860px, not a product defect; after correcting the expectation, the affected seven-width horizontal scroller checks passed. The upstream chat provider is over its usage limit until 2026-10-01 00:00 UTC, so successful live model output could not be verified. See the [pre-ship audit](2026-09-29-pre-ship-product-audit.md) for runtime evidence.
