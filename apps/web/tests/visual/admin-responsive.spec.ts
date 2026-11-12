import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import { openFrozen } from "./prepare";

const SCREENSHOTS = "/tmp/club-athletic-admin-acceptance";

test.beforeEach(({ browserName }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1280", `one ${browserName} pass covers all admin widths`);
});

test("desktop guest sheet keeps every column on one line", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openFrozen(page, "/admin");
  await mkdir(SCREENSHOTS, { recursive: true });

  const headers = await page.locator(".admin-guest-table thead th").allTextContents();
  expect(headers).toEqual(["Guest", "Status", "Room / spot", "Venmo", "Phone", "Instagram", "Dietary", "Cocktails", "Tasks", "Flights"]);
  expect(await page.locator(".admin-guest-table tbody tr").count()).toBeGreaterThan(0);

  const cellLayout = await page.locator(".admin-guest-table th, .admin-guest-table td").evaluateAll((cells) => cells.map((cell) => ({
    tag: cell.tagName,
    text: cell.textContent?.trim().slice(0, 100),
    clientWidth: cell.clientWidth,
    scrollWidth: cell.scrollWidth,
    whiteSpace: getComputedStyle(cell).whiteSpace,
    overflows: cell.scrollWidth > cell.clientWidth + 1,
  })));
  expect(cellLayout.filter((cell) => cell.whiteSpace !== "nowrap" || cell.overflows)).toEqual([]);
  const tableViewport = await page.locator(".admin-guest-table-wrap").evaluate((element) => ({
    overflowX: getComputedStyle(element).overflowX,
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(tableViewport.overflowX).toBe("auto");
  expect(tableViewport.scrollWidth).toBeGreaterThan(tableViewport.clientWidth);
  const documentOverflow = await page.evaluate(() => ({
    amount: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    outsideAdmin: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => !element.closest(".admin-page") && element.getBoundingClientRect().right > window.innerWidth + 1)
      .map((element) => ({ tag: element.tagName, className: element.className, right: Math.round(element.getBoundingClientRect().right), text: element.textContent?.trim().slice(0, 40) })),
    ancestors: (() => {
      const chain: HTMLElement[] = [];
      let element = document.querySelector<HTMLElement>(".admin-guest-table-wrap");
      while (element) { chain.push(element); element = element.parentElement; }
      return chain.map((element) => ({ className: element.className, width: Math.round(element.getBoundingClientRect().width), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflowX: getComputedStyle(element).overflowX }));
    })(),
    elements: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(-12)
      .map((element) => ({ tag: element.tagName, className: element.className, width: Math.round(element.getBoundingClientRect().width), right: Math.round(element.getBoundingClientRect().right), text: element.textContent?.trim().slice(0, 50) })),
  }));
  expect(documentOverflow.amount, JSON.stringify({ outsideAdmin: documentOverflow.outsideAdmin, ancestors: documentOverflow.ancestors })).toBe(0);
  await page.screenshot({ path: `${SCREENSHOTS}/admin-desktop-1440.png`, fullPage: true });

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
