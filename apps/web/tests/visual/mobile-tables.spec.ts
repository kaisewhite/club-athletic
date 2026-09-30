import { expect, test } from "@playwright/test";

import { openFrozen } from "./prepare";

for (const width of [320, 375, 390, 414, 768, 859]) {
  test.describe(`mobile tables at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("recommendations keep the route above paired departure and arrival times", async ({ page }) => {
      await openFrozen(page, "/flights");

      const rows = page.locator(".flight-rec-table tbody tr");

      expect(await rows.count()).toBeGreaterThan(0);

      for (const row of await rows.all()) {
        const route = await row.locator('[data-label="Route"]').boundingBox();
        const departure = await row.locator('[data-label="Departs"]').boundingBox();
        const arrival = await row.locator('[data-label="Arrives"]').boundingBox();

        expect(route).not.toBeNull();
        expect(departure).not.toBeNull();
        expect(arrival).not.toBeNull();
        expect(departure!.y).toBeGreaterThanOrEqual(route!.y + route!.height);
        expect(Math.abs(departure!.y - arrival!.y)).toBeLessThan(1);

        const fontSize = await row.locator("td").first().evaluate(cell => Number.parseFloat(getComputedStyle(cell).fontSize));

        expect(fontSize).toBeGreaterThanOrEqual(14);
      }
    });

    test("all table records contain long names, notes, routes and times", async ({ page }) => {
      for (const path of ["/flights", "/chef"]) {
        await openFrozen(page, path);

        // Stress the existing DOM without writing to the shared trip database.
        await page.locator('.flight-rec-table tbody th').first().evaluateAll(cells => {
          for (const cell of cells) cell.textContent = "InternationalAirlineWithAnUnbrokenLongName123456789";
        });
        await page.locator('.dietary-cell-button').first().evaluateAll(buttons => {
          for (const button of buttons) button.prepend("Severe sesame allergy; please avoid cross contamination. ".repeat(5));
        });

        const overflow = await page.locator(".detail-table tbody th, .detail-table tbody td, .flight-guest-card").evaluateAll(cells => {
          const failures: string[] = [];

          for (const cell of cells) {
            if (cell.scrollWidth > cell.clientWidth + 1) failures.push(cell.textContent ?? "empty cell");
          }

          return failures;
        });

        expect(overflow).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      }
    });

    test("dietary editors remain legible and show the whole draft", async ({ page }) => {
      await openFrozen(page, "/chef");
      await page.locator(".dietary-cell-button").first().click();

      const editor = page.locator(".dietary-cell-textarea");

      const geometry = await editor.evaluate(input => ({
        fontSize: Number.parseFloat(getComputedStyle(input).fontSize),
        height: input.getBoundingClientRect().height,
      }));

      expect(geometry.fontSize).toBeGreaterThanOrEqual(16);
      expect(geometry.height).toBeGreaterThanOrEqual(44);
      await editor.fill("No nuts or sesame. Please use separate utensils and avoid cross contamination. ".repeat(5));
      expect(await editor.evaluate(input => input.scrollHeight - input.clientHeight)).toBeLessThanOrEqual(1);
      await editor.press("Escape");
      await expect(editor).toHaveCount(0);
    });
  });
}
