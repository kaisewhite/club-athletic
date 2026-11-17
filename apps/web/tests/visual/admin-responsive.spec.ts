import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import { openFrozen } from "./prepare";

const SCREENSHOTS = "/tmp/club-athletic-admin-acceptance";

test.beforeEach(({ browserName }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1280", `one ${browserName} pass covers all admin widths`);
});

test("guest records wrap without horizontal scrolling at desktop widths", async ({ page }) => {
  await openFrozen(page, "/admin");
  await mkdir(SCREENSHOTS, { recursive: true });
  const labels = ["Status", "Room / spot", "Venmo", "Phone", "Instagram", "Dietary", "Cocktails", "Tasks", "Flights"];
  for (const width of [1440, 1280, 1024, 860]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.reload();
    const pageOverflow = await page.evaluate(() => ({
      amount: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      badElements: [...document.querySelectorAll<HTMLElement>(".admin-page *")]
        .filter((element) => {
          const style = getComputedStyle(element);
          const visuallyHidden = element.matches(".sr-only") || (element.clientWidth === 1 && element.clientHeight === 1 && style.clip !== "auto");
          return !visuallyHidden && (element.scrollWidth > element.clientWidth + 1 || ["auto", "scroll"].includes(style.overflowX));
        })
        .map((element) => ({ tag: element.tagName, className: String(element.className), overflowX: getComputedStyle(element).overflowX, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth })),
    }));
    expect(pageOverflow.amount, `document overflow at ${width}px`).toBe(0);
    expect(pageOverflow.badElements, `overflowing admin elements at ${width}px`).toEqual([]);
    await expect(page.locator(".admin-page table")).toHaveCount(0);
    const cards = page.locator(".admin-guest-card");
    expect(await cards.count()).toBeGreaterThan(0);
    for (const card of await cards.all()) {
      expect(await card.locator(".admin-mobile-fields dt").allTextContents()).toEqual(labels);
    }
    const fieldDisplay = await page.locator(".admin-mobile-fields dd").evaluateAll((fields) => fields.map((field) => ({
      textOverflow: getComputedStyle(field).textOverflow,
      lineClamp: getComputedStyle(field).getPropertyValue("-webkit-line-clamp"),
      clipped: field.scrollHeight > field.clientHeight + 1,
    })));
    expect(fieldDisplay.filter((field) => field.textOverflow === "ellipsis" || (field.lineClamp && field.lineClamp !== "none") || field.clipped)).toEqual([]);
    if (width === 1440 || width === 1024) await page.screenshot({ path: `${SCREENSHOTS}/admin-desktop-${width}.png`, fullPage: true });
  }
});

test("chef page reads normalized preferences from the local database", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openFrozen(page, "/chef");
  const preferences = page.getByRole("table", { name: "Guest food preferences" });
  await expect(preferences).toContainText("Pescatarian; lactose intolerant");
  await expect(preferences).toContainText("Avoid parsley");
  await expect(preferences).toContainText("Espresso Martini; Margarita; Old Fashioned");
  await expect(preferences).toContainText("Peanut sensitivity (avoid peanuts)");
});

for (const [width, height] of [[390, 844], [320, 568]] as const) {
  test(`mobile guest cards fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openFrozen(page, "/admin");

    const cards = page.locator(".admin-guest-card");
    expect(await cards.count()).toBeGreaterThan(0);
    for (const card of await cards.all()) {
      await expect(card.locator("h3")).toBeVisible();
      expect(await card.locator(".admin-mobile-fields dt").allTextContents()).toEqual([
        "Status", "Room / spot", "Venmo", "Phone", "Instagram", "Dietary", "Cocktails", "Tasks", "Flights",
      ]);
    }
    await expect(page.locator(".admin-guest-card a").first()).toBeVisible();
    const fieldDisplay = await page.locator(".admin-mobile-fields dd").evaluateAll((fields) => fields.map((field) => ({
      textOverflow: getComputedStyle(field).textOverflow,
      lineClamp: getComputedStyle(field).getPropertyValue("-webkit-line-clamp"),
      clipped: field.scrollHeight > field.clientHeight + 1,
    })));
    expect(fieldDisplay.filter((field) => field.textOverflow === "ellipsis" || (field.lineClamp && field.lineClamp !== "none") || field.clipped)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

    await mkdir(SCREENSHOTS, { recursive: true });
    await page.screenshot({ path: `${SCREENSHOTS}/admin-mobile-${width}.png`, fullPage: true });
  });
}
