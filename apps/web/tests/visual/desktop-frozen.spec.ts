// The desktop-frozen baseline: all eleven trip pages, photographed at 1280 and
// 1920 (TODO §7). Any diff here after this commit is a desktop regression, not
// a judgement call — that is the whole point of §2.15's "do this first".
//
// Two captures per page per width:
//   *-viewport  the true design at that viewport, sticky sidebar and all
//   *-full      the whole document, which is the only way below-the-fold
//               content (Rooms, Chef, Tasks) is covered at all
// The full-page capture keeps `.sidebar { height: 100vh }` at its real viewport
// height rather than stretching it, so the space beside long pages is bare
// background. That is the capture, not a design bug — do not "fix" it.
import { expect, test } from "@playwright/test";

import { openFrozen } from "./prepare";

/** The routes, in `app/routes.ts` order. */
const PAGES = [
  ["home", "/"],
  ["faq", "/faq"],
  ["schedule", "/schedule"],
  ["flights", "/flights"],
  ["shuttle", "/shuttle"],
  ["chalet", "/chalet"],
  ["rooms", "/rooms"],
  ["spots", "/spots"],
  ["chef", "/chef"],
  ["tasks", "/tasks"],
  ["links", "/links"],
] as const;

/**
 * Countdown and trip dates were removed from the shell on 2026-09-29 per the
 * guest-facing request to keep them with FAQ content.
 */
const COUNTDOWN_NODES = 0;

test.describe("desktop-frozen baseline", () => {
  for (const [name, path] of PAGES) {
    test(name, async ({ page }) => {
      const frozen = await openFrozen(page, path);
      // Asserted, not assumed: if countdown chrome returns, fail before capture.
      expect(frozen, `countdown nodes frozen on ${path}`).toBe(COUNTDOWN_NODES);

      await expect(page).toHaveScreenshot(`${name}-viewport.png`, { fullPage: false });
      await expect(page).toHaveScreenshot(`${name}-full.png`, { fullPage: true });
    });
  }
});
