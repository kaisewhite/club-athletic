// Determinism harness for the desktop-frozen baseline. Everything that can
// differ between two runs of the same unchanged page is settled here, so the
// snapshot assertions themselves stay one line long.
//
// Not a test file: Playwright's default `testMatch` only collects `*.spec.ts`.
import { expect, type Page } from "@playwright/test";

/**
 * Countdown and date details no longer appear in the shell, so there is no
 * clock-derived text to freeze in the visual baseline.
 */
export const FROZEN_DAYS_UNTIL = "";

/**
 * No selectors render `daysUntil` in the shell after the 2026-09-29 FAQ move.
 */
const COUNTDOWN_SELECTORS: string[] = [];

/**
 * Loads `path` and returns only once the page is pixel-stable. The number of
 * countdown nodes actually frozen is returned so the caller can assert it —
 * a silent zero would mean the markup moved and the baseline started drifting
 * daily again.
 */
export async function openFrozen(page: Page, path: string): Promise<number> {
  await page.goto(path, { waitUntil: "load" });

  // 0. Prove the config's `reducedMotion` actually reached the page. This is what
  //    makes `src/styles.css` disable `rise` (`.page-route` / `.overview-content`)
  //    and `blink` (`.chat-dots`) itself, so a config regression must not pass
  //    quietly and leave mid-animation frames in the baseline.
  const reduced = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (!reduced) throw new Error("prefers-reduced-motion is not applied; the rise/blink animations would be live");

  // 1. Readiness, polled in the *main* world. `page.waitForFunction` polls from an
  //    isolated world, where Chromium hands out separate wrappers for DOM nodes —
  //    so an expando the page's own JS set (React's `__reactFiber$…`) is invisible
  //    there. `expect.poll` over `page.evaluate` runs in the page's world instead.
  //
  //    a. Hydration: React stamps `__reactFiber$…` on a host node as it hydrates
  //       it, so its presence on the shell proves the client bundle has run and
  //       that no hydration-time layout pass (the composer's textarea auto-size,
  //       the `useSyncExternalStore` width switch) is still outstanding.
  //    b. Webfonts: every `@font-face` in `src/styles.css` is `font-display: swap`,
  //       so capturing early photographs fallback metrics instead of the design.
  //       `document.fonts.ready` alone can resolve before a lazily-requested face
  //       is in, so the two families actually used are checked by name.
  //    c. Images: `/rooms` embeds `public/bedroom-map.webp` and `/spots`
//       embeds `public/chalet-rooms.webp`.
  await expect.poll(() => page.evaluate(() => {
    const shell = document.querySelector(".app-shell");
    const hydrated = shell !== null && Object.keys(shell).some((key) => key.startsWith("__reactFiber$"));
    const fonts = document.fonts.status === "loaded" &&
      document.fonts.check('700 34px "Hanken Grotesk"') &&
      document.fonts.check('400 15px "Maison Neue"') &&
      // The bedroom map sheet on /rooms is set in Archivo (its own face, shipped
      // with it); a capture before it swaps in photographs the fallback.
      (!document.querySelector(".bm-sheet") || document.fonts.check('800 54px "Archivo"'));
    const images = [...document.images].every((image) => image.complete && image.naturalWidth > 0);
    return { hydrated, fonts, images };
  }), { message: `hydration, webfonts and images settled on ${path}`, timeout: 20_000 })
    .toEqual({ hydrated: true, fonts: true, images: true });

  // 1b. The bedroom-map sheet on /rooms scales itself in an effect + ResizeObserver
  //     and is set in a face that swaps in: a capture between hydration and that
  //     first fit (or that swap) differs by a few thousand pixels, intermittently.
  //     Wait for the scale to be written, every requested face to settle, and two
  //     frames so layout and paint have caught up.
  if (await page.locator(".bm-scale").count()) {
    await expect.poll(() => page.evaluate(() => {
      const box = document.querySelector<HTMLElement>(".bm-scale");
      return box !== null && box.style.getPropertyValue("--bm-scale") !== "";
    }), { message: "bedroom map sheet scaled to its box", timeout: 20_000 }).toBe(true);
    await page.evaluate(() => document.fonts.ready.then(() => new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())))));
  }

  // 2. Freeze the clock-derived countdown, and return to the top of the document
  //    (`AppShell` scrolls there on navigation; `goto` should already be at 0,
  //    but a stable scroll offset is what the viewport capture is framed on).
  return page.evaluate(({ selectors, value }) => {
    // Held for the life of the document, and re-queried on every mutation rather
    // than closed over: a re-render can replace the `.countdown-number` element
    // itself, which leaves an observer bound to the old node watching a detached
    // subtree while the live one drifts back to the real number. Observing the
    // document and re-selecting survives both a rewritten text node and a
    // replaced element. Direct text children only, so the accent dot in the
    // child <span> is still photographed. Re-setting an already-correct value is
    // a no-op, so the observer cannot feed itself.
    const hold = () => {
      let held = 0;
      for (const selector of selectors) {
        for (const host of document.querySelectorAll(selector)) {
          for (const node of [...host.childNodes]) {
            if (node.nodeType !== Node.TEXT_NODE) continue;
            if (node.nodeValue !== value) node.nodeValue = value;
            held += 1;
          }
        }
      }
      return held;
    };
    const frozen = hold();
    new MutationObserver(hold).observe(document.documentElement, {
      childList: true, characterData: true, subtree: true,
    });
    window.scrollTo(0, 0);
    return frozen;
  }, { selectors: COUNTDOWN_SELECTORS, value: FROZEN_DAYS_UNTIL });
}
