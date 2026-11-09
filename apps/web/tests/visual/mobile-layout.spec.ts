// The mobile matrix — TODO §2.15. Added ALONGSIDE the frozen desktop baseline
// in `desktop-frozen.spec.ts`; it records no screenshots of its own and never
// touches `tests/visual/__screenshots__/`.
//
// It asserts geometry rather than pixels, because what §2.15 asks for is
// measurable: no horizontal overflow, single-column rooms, one chef row per
// day, readable task cards, 44px controls, contained overscroll — and, most
// importantly, that all of it switches at 859/860 and nothing leaks upward.
//
// §2.15: "Test the real matrix: 320 (iPhone SE), 375, 390, 414, 768 (iPad
// portrait), 859 (just under the seam), 860 (just over). The two either side of
// 860 are the ones that catch seam bugs." All seven are here.
//
// Runs once, under `desktop-1280` only: the widths come from `test.use`, so
// running it under both projects would just repeat the same measurements.
import { expect, test, type Locator } from "@playwright/test";

import { openFrozen } from "./prepare";

/** The seam. `useWideLayout()` is `>= 860`; the CSS side is `max-width: 859px`. */
const SEAM = 860;
const VIEWPORTS = [
  [320, 568], [375, 812], [390, 844], [412, 915], [768, 1024], [820, 1180], [859, 780], [860, 780],
] as const;

const PAGES = [
  ["home", "/"], ["chat", "/chat"], ["guests", "/guests"], ["faq", "/faq"], ["schedule", "/schedule"], ["flights", "/flights"], ["shuttle", "/shuttle"],
  ["chalet", "/chalet"], ["rooms", "/rooms"], ["spots", "/pricing"], ["chef", "/chef"],
  ["tasks", "/tasks"], ["links", "/links"],
] as const;

/**
 * The longest real strings in the trip database, read from Neon on 2026-09-26.
 * §2.15: "Verify each section at 320px with the longest real data in the DB,
 * not with short seed strings." These are asserted to be *present* so the
 * layout checks below are known to be running against the worst case rather
 * than against whatever happens to be seeded.
 */
/**
 * Confirmed guests on the trip — one flight card each. Moves whenever the
 * organizer assigns an open spot (Pete F. took a Bedroom 5 bunk on 2026-09-28,
 * Christine Calvo a Bedroom 4 bunk on 2026-09-29), so it is named rather than inlined as a magic 9.
 */
const CONFIRMED_GUESTS = 11;

const LONGEST = {
  guest: "Augustus Shewchuck", // 18 chars
  room: "Bedroom 1", // rooms are the bare bedroom number since 2026-09-29
  event: "Chill ski day", // current seeded schedule title
} as const;

// `test.skip`'s condition callback is handed fixtures only, not the project,
// so the one place the project name is reachable before a test body runs is a
// hook. Both configured projects would measure exactly the same widths.
test.beforeEach(({ browserName }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1280", `the mobile matrix sets its own widths; one ${browserName} pass over them is enough`);
});

/**
 * Counts the visual lines an element's text occupies, from its client rects.
 * Takes a Locator rather than a selector string: the elements worth measuring
 * here are found by their text, and `:has-text()` is a Playwright selector that
 * `document.querySelector` cannot parse.
 */
async function lineCount(target: Locator) {
  return target.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0.5).map((r) => Math.round(r.top)));
    return tops.size || 1;
  });
}

for (const [width, height] of VIEWPORTS) {
  const mobile = width < SEAM;

  test.describe(`${width}px (${mobile ? "below" : "at/above"} the 860 seam)`, () => {
    test.use({ viewport: { width, height } });

    test("no page scrolls sideways", async ({ page }) => {
      for (const [name, path] of PAGES) {
        await openFrozen(page, path);
        const { over, worst } = await page.evaluate(() => {
          const doc = document.documentElement;
          const offenders = [...document.querySelectorAll("body *")]
            .map((el) => ({ el, right: el.getBoundingClientRect().right, w: el.getBoundingClientRect().width }))
            .filter((x) => x.w > 0 && x.right > doc.clientWidth + 1)
            .map((x) => `${x.el.tagName.toLowerCase()}.${x.el.className?.toString?.().slice(0, 40)} right=${Math.round(x.right)}`);
          return { over: doc.scrollWidth - doc.clientWidth, worst: offenders.slice(0, 5) };
        });
        expect(over, `${name} overflows horizontally by ${over}px: ${worst.join(" | ")}`).toBeLessThanOrEqual(0);
      }
    });

    test("the shell picks the right navigation for this side of the seam", async ({ page }) => {
      await openFrozen(page, "/");
      // Below the seam: app bar and closed navigation drawer; above it, the top bar.
      await expect(page.locator(".mobile-header")).toHaveCount(mobile ? 1 : 0);
      await expect(page.locator(".top-nav")).toHaveCount(mobile ? 0 : 1);
      if (mobile) await expect(page.locator(".mobile-nav-toggle")).toHaveAttribute("aria-expanded", "false");
    });

    test("a deep-linked mobile page keeps its active navigation item visible", async ({ page }) => {
      test.skip(!mobile, "the wide top bar has no drawer");
      await openFrozen(page, "/rooms");
      await page.locator(".mobile-nav-toggle").click();
      const active = page.locator(".mobile-drawer .side-item[aria-current='page']");
      await expect(active).toHaveCount(1);
      const visible = await active.evaluate((link) => {
        const viewport = link.closest(".mobile-drawer")!.getBoundingClientRect();
        const item = link.getBoundingClientRect();
        return item.left >= viewport.left && item.right <= viewport.right;
      });
      expect(visible, "the active Rooms link is outside the mobile navigation viewport").toBe(true);
    });

    test("flights renders cards below the seam and the table at or above it", async ({ page }) => {
      await openFrozen(page, "/flights");
      // §2.15: "below 860px, render one card per guest instead of the table …
      // Same query, different component. Desktop keeps the table."
      await expect(page.locator(".flight-cards")).toHaveCount(mobile ? 1 : 0);
      await expect(page.locator("table.flight-table")).toHaveCount(mobile ? 0 : 1);
      if (mobile) {
        // Same data either way: one card per guest, longest real name included.
        await expect(page.locator(".flight-guest-card")).toHaveCount(CONFIRMED_GUESTS);
        await expect(page.locator(".flight-guest-card", { hasText: LONGEST.guest })).toHaveCount(1);
      }
    });

    test("rooms stack to one block per room below the seam, and long names stay short", async ({ page }) => {
      await openFrozen(page, "/rooms");
      // Since 2026-11-03 the room guide is the bedroom table under the floor map;
      // below the seam each row becomes its own stacked block instead of a table row.
      const rows = page.locator(".bm-room-table tbody tr");
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);
      const layout = await page.evaluate(() => {
        const table = document.querySelector(".bm-room-table")!;
        return {
          table: getComputedStyle(table).display,
          head: getComputedStyle(table.querySelector("thead")!).display,
          rows: [...table.querySelectorAll("tbody tr")].map((row) => ({ display: getComputedStyle(row).display, right: row.getBoundingClientRect().right })),
        };
      });
      if (mobile) {
        expect(layout.table, `the room table is a stack at ${width}px`).toBe("block");
        expect(layout.head).toBe("none");
        for (const [index, row] of layout.rows.entries()) {
          expect(row.display, `room ${index} is one block at ${width}px`).toBe("grid");
          expect(row.right, `room ${index} fits the viewport at ${width}px`).toBeLessThanOrEqual(width);
        }
      } else {
        expect(layout.table).toBe("table");
      }
      // §2.15 names this string: it must not wrap into three lines.
      const longest = page.locator(".bm-bedroom-name", { hasText: new RegExp(`^${LONGEST.room}$`) });
      await expect(longest).toHaveCount(1);
      const lines = await lineCount(longest);
      expect(lines, `"${LONGEST.room}" wrapped to ${lines} lines at ${width}px`).toBeLessThanOrEqual(2);
    });

    test("the chef meal grid becomes one row per day below the seam", async ({ page }) => {
      await openFrozen(page, "/chef");
      const row = page.locator(".chef-meal-table tbody tr").first();
      const shape = await row.evaluate((el) => ({
        display: getComputedStyle(el).display,
        columns: getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length,
        head: getComputedStyle(document.querySelector(".chef-meal-table thead")!).display,
      }));
      if (mobile) {
        // §2.15: "the day label on the left, breakfast and dinner stacked on the
        // right. Same shape as the Schedule rows (§2.4)" — a 2-column grid.
        expect(shape.display).toBe("grid");
        expect(shape.columns).toBe(2);
        expect(shape.head).toBe("none");
        const cells = await row.locator("td").evaluateAll((els) => els.map((el) => {
          const box = el.getBoundingClientRect();
          return { x: Math.round(box.x), y: Math.round(box.y), label: el.getAttribute("data-meal") };
        }));
        expect(cells).toHaveLength(2);
        // Stacked, not side by side: same left edge, different rows.
        expect(cells[0]!.x).toBe(cells[1]!.x);
        expect(cells[1]!.y).toBeGreaterThan(cells[0]!.y);
        expect(cells.map((c) => c.label)).toEqual(["Breakfast", "Dinner"]);
      } else {
        // The desktop three-column table is untouched.
        expect(shape.display).toBe("table-row");
        expect(shape.head).toBe("table-header-group");
      }
      // Mobile dietary records stack the note below the guest name.
      const dietary = page.locator('[aria-label="Guest food preferences"] tbody tr').first();
      expect(await dietary.evaluate((el) => getComputedStyle(el).display)).toBe(mobile ? "grid" : "table-row");
    });

    test("task statuses use the shared responsive table layout", async ({ page }) => {
      await openFrozen(page, "/tasks");
      const row = page.locator(".task-table tbody tr", { hasText: LONGEST.guest });
      await expect(row).toHaveCount(1);
      const display = await row.evaluate((el) => getComputedStyle(el).display);
      if (mobile) {
        expect(display).toBe("grid");
        await expect(row.locator('td[data-label="Flight"]')).toBeVisible();
        await expect(row.locator('td[data-label="Payment"]')).toBeVisible();
      } else {
        expect(display).toBe("table-row");
      }
    });

    test("all trip and room-sharing FAQs use one question-and-answer table", async ({ page }) => {
      await openFrozen(page, "/faq");
      await expect(page.locator(".faq-table")).toHaveCount(1);
      const entries = await page.locator(".faq-table-row").evaluateAll((els) => els.map((el) => {
        const question = el.querySelector("th[scope='row']");
        const answer = el.querySelector("td[data-label='Answer']");
        return {
          question: question?.textContent?.trim() ?? "",
          answer: answer?.textContent?.trim() ?? "",
          answerWidth: answer?.getBoundingClientRect().width ?? 0,
        };
      }));
      expect(entries).toHaveLength(14);
      expect(entries.every((entry) => entry.question && entry.answer)).toBe(true);
      expect(page.locator(".faq-question-link")).toHaveCount(10);
      for (const entry of entries) {
        if (mobile) expect(entry.answerWidth, `answer measure at ${width}px`).toBeGreaterThan(width * 0.6);
      }
    });

    // The horizontal-scroller check covered the home schedule ticker, which the
    // home page no longer has; the quick prompts wrap rather than scroll.

    test("the composer keeps 44px controls, a 16px input and a safe-area floor", async ({ page }) => {
      await openFrozen(page, "/chat");
      const composer = await page.evaluate(() => {
        const send = document.querySelector(".send")!.getBoundingClientRect();
        const attach = document.querySelector(".chat-attach")!.getBoundingClientRect();
        const area = document.querySelector(".composer textarea")!;
        const shell = getComputedStyle(document.querySelector(".composer-shell")!);
        return {
          send: { w: send.width, h: send.height }, attach: { w: attach.width, h: attach.height },
          font: Number.parseFloat(getComputedStyle(area).fontSize),
          padBottom: Number.parseFloat(shell.paddingBottom),
        };
      });
      // 16px or iOS zooms the page on focus. True at every width; the source
      // already sets it and §2.15 says not to let a polish pass shrink it.
      expect(composer.font).toBeGreaterThanOrEqual(16);
      if (mobile) {
        expect(composer.attach, "attachment is a 44px touch target below the seam").toEqual({ w: 44, h: 44 });
        expect(composer.send, "send is a 44px target below the seam").toEqual({ w: 44, h: 44 });
        // `max(18px, env(safe-area-inset-bottom))` — floored at the design's own
        // 18px, so a device with no inset renders the source spacing exactly.
        expect(composer.padBottom).toBeGreaterThanOrEqual(18);
      } else {
        expect(composer.attach, "desktop attachment control is compact at 32px").toEqual({ w: 32, h: 32 });
        expect(composer.send, "desktop send geometry is compact at 32px").toEqual({ w: 32, h: 32 });
        expect(composer.padBottom).toBe(48);
      }
    });

    test("the chat page centers the composer above its quick prompts", async ({ page }) => {
      await openFrozen(page, "/chat");
      const geometry = await page.evaluate(() => {
        const home = document.querySelector(".overview")!.getBoundingClientRect();
        const composer = document.querySelector(".home-composer .composer")!.getBoundingClientRect();
        const prompts = document.querySelector(".home-composer .suggestions")!.getBoundingClientRect();
        return {
          homeCenter: home.top + home.height / 2,
          groupCenter: (composer.top + prompts.bottom) / 2,
          composerBottom: composer.bottom,
          promptsTop: prompts.top,
        };
      });
      expect(geometry.promptsTop, "quick prompts should sit below the input").toBeGreaterThanOrEqual(geometry.composerBottom);
      expect(Math.abs(geometry.groupCenter - geometry.homeCenter), "landing group should remain centered").toBeLessThan(48);
    });

    test("home lists the week as static rows under its heading", async ({ page }) => {
      await openFrozen(page, "/");
      const geometry = await page.evaluate(() => ({
        headingBottom: document.querySelector(".week-heading")!.getBoundingClientRect().bottom,
        weekTop: document.querySelector(".home-week")!.getBoundingClientRect().top,
        columns: getComputedStyle(document.querySelector(".home-week")!).columnCount,
        rows: document.querySelectorAll(".home-week li").length,
      }));
      expect(geometry.weekTop, "the week list follows its heading").toBeGreaterThanOrEqual(geometry.headingBottom);
      expect(geometry.rows).toBeGreaterThan(0);
      expect(geometry.columns).toBe(mobile ? "1" : "3");
    });

    test("every control §2.15 names is a 44px box below the seam", async ({ page }) => {
      test.skip(!mobile, "44px minimums are a touch requirement, not a pointer one");
      // §2.15: "Minimum 44×44px touch targets for every button: nav chips,
      // tiles, paperclip, and send. Several source controls are smaller
      // than that." Named explicitly so this check cannot be satisfied by the
      // sweep below simply declining to look at something.
      const CONTROLS: [string, string][] = [
        ["/", ".mobile-nav-toggle"], ["/faq", ".faq-question-link"], ["/", ".week-heading a"],
        ["/chat", ".suggestions button"], ["/chat", ".send"], ["/chat", ".chat-attach"],
        ["/links", ".resource-link-title"], ["/chalet", ".chalet-listings a"],
        ["/flights", ".flight-row-edit"], ["/flights", ".flight-guest-card h4 a"],
      ];
      const offenders: string[] = [];
      for (const [path, selector] of CONTROLS) {
        await openFrozen(page, path);
        const boxes = await page.locator(selector).evaluateAll((els) => els.map((el) => {
          const box = el.getBoundingClientRect();
          return { w: Math.round(box.width), h: Math.round(box.height) };
        }));
        expect(boxes.length, `${selector} exists on ${path} at ${width}px`).toBeGreaterThan(0);
        for (const box of boxes) {
          if (box.h < 44 || box.w < 44) offenders.push(`${path} ${selector} ${box.w}x${box.h}`);
        }
      }
      expect([...new Set(offenders)], `named controls under 44px at ${width}px`).toEqual([]);
    });

    test("no unnamed control slips under 44px below the seam", async ({ page }) => {
      test.skip(!mobile, "44px minimums are a touch requirement, not a pointer one");
      const offenders: string[] = [];
      for (const [name, path] of PAGES) {
        await openFrozen(page, path);
        const small = await page.evaluate(() => [...document.querySelectorAll("a, button, [role=button]")]
          .filter((el) => el.getClientRects().length > 0)
          // A link that flows inside running text keeps `display: inline` — the
          // hotel links in a sentence on /flights, the chalet listing sentence.
          // WCAG 2.5.8 exempts those, and padding them to 44px would break the
          // line box around them. Anything this pass deliberately turned into a
          // box (`inline-flex`, `flex`, `grid`, `block`) is NOT exempt, and the
          // named-controls test above covers the ones §2.15 lists by hand.
          .filter((el) => getComputedStyle(el).display !== "inline")
          .map((el) => {
            const box = el.getBoundingClientRect();
            return { id: `${el.tagName.toLowerCase()}.${el.className?.toString?.().trim().slice(0, 40) || "(none)"}`, w: Math.round(box.width), h: Math.round(box.height) };
          })
          .filter((t) => t.w > 0 && (t.h < 44 || t.w < 44))
          .map((t) => `${t.id} ${t.w}x${t.h}`));
        for (const item of new Set(small)) offenders.push(`${name}: ${item}`);
      }
      expect(offenders, `sub-44px controls at ${width}px`).toEqual([]);
    });

    test("full-height uses dvh and the top bar clears the safe area", async ({ page }) => {
      await openFrozen(page, "/");
      const shell = await page.evaluate(() => {
        // The computed value of `100dvh` and `100vh` is identical on a desktop
        // headless browser, so the declaration itself is what gets asserted.
        const rules: string[] = [];
        for (const sheet of document.styleSheets) {
          try {
            const walk = (list: CSSRuleList, media: string) => {
              for (const rule of list) {
                if (rule instanceof CSSMediaRule) walk(rule.cssRules, rule.conditionText);
                else if (rule instanceof CSSStyleRule && rule.selectorText === ".app-shell") rules.push(`${media}|${rule.style.minHeight}`);
              }
            };
            walk(sheet.cssRules, "");
          } catch { /* cross-origin sheet */ }
        }
        const header = document.querySelector(".mobile-header");
        return { rules, headerPadTop: header ? getComputedStyle(header).paddingTop : null };
      });
      // Base stays 100vh (desktop-frozen); the mobile override is 100dvh.
      expect(shell.rules).toContain("|100vh");
      expect(shell.rules).toContain("(max-width: 859px)|100dvh");
      if (mobile) {
        // `env(safe-area-inset-top)` resolves to 0 on a device without a notch,
        // which is exactly the design's own padding.
        expect(shell.headerPadTop).toBe("0px");
      }
    });

    test("the longest real trip strings are the ones being measured", async ({ page }) => {
      // Guards the checks above against a reseed that shortens the worst case.
      await openFrozen(page, "/rooms");
      await expect(page.locator(".bm-bedroom-name", { hasText: new RegExp(`^${LONGEST.room}$`) })).toHaveCount(1);
      await openFrozen(page, "/tasks");
      await expect(page.locator(".task-table tbody th", { hasText: LONGEST.guest })).toHaveCount(1);
      await openFrozen(page, "/schedule");
      await expect(page.locator(".schedule-entry-title", { hasText: LONGEST.event })).toHaveCount(1);
      const lines = await lineCount(page.locator(".schedule-entry-name", { hasText: LONGEST.event }));
      expect(lines, `the longest event title took ${lines} lines at ${width}px`).toBeLessThanOrEqual(3);
    });
  });
}
