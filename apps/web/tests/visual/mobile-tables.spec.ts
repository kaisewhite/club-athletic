import { expect, test } from "@playwright/test";

import { openFrozen } from "./prepare";

for (const width of [320, 375, 390, 412, 768, 820, 859]) {
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

for (const [width, height] of [[320, 568], [390, 844], [412, 915], [820, 1180]] as const) {
  test.describe(`bedroom map mobile detail rows at ${width}px`, () => {
    test.use({ viewport: { width, height } });

    test("keeps the row name and labeled floor/description values visible without overlap", async ({ page }) => {
      await openFrozen(page, "/rooms");

      const rows = page.locator(".bm-room-table tbody tr");
      expect(await rows.count()).toBe(8);

      const results = await rows.evaluateAll((elements) => elements.map((row) => {
        const rowBox = row.getBoundingClientRect();
        const bedroom = row.querySelector<HTMLElement>('th[scope="row"]')!;
        const cells = [
          row.querySelector<HTMLElement>('td[data-label="Floor / door"]')!,
          row.querySelector<HTMLElement>('td[data-label="Description"]')!,
        ];
        const bedroomBox = bedroom.getBoundingClientRect();
        const values = cells.map((cell) => {
          const box = cell.getBoundingClientRect();
          const label = getComputedStyle(cell, "::before");
          const range = document.createRange();
          range.selectNodeContents(cell);
          const textRects = [...range.getClientRects()]
            .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
            .map((rect) => ({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }));
          return {
            label: label.content.replace(/^['"]|['"]$/g, ""),
            labelVisible: label.content !== "none" && label.visibility !== "hidden" && Number.parseFloat(label.fontSize) >= 10,
            value: cell.textContent?.trim() ?? "",
            box: { top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width },
            scroll: { width: cell.scrollWidth, clientWidth: cell.clientWidth, height: cell.scrollHeight, clientHeight: cell.clientHeight },
            textRects,
          };
        });
        return {
          bedroom: bedroom.textContent?.trim() ?? "",
          bedroomVisible: getComputedStyle(bedroom).display !== "none" && getComputedStyle(bedroom).visibility !== "hidden",
          bedroomBox: { left: bedroomBox.left, right: bedroomBox.right, top: bedroomBox.top, bottom: bedroomBox.bottom },
          rowBox: { left: rowBox.left, right: rowBox.right, top: rowBox.top, bottom: rowBox.bottom },
          values,
        };
      }));

      for (const row of results) {
        expect(row.bedroom, "row heading must identify the bedroom").toMatch(/^Bedroom\s+\d+/);
        expect(row.bedroomVisible).toBe(true);
        expect(row.bedroomBox.left).toBeGreaterThanOrEqual(row.rowBox.left - 1);
        expect(row.bedroomBox.right).toBeLessThanOrEqual(row.rowBox.right + 1);
        expect(row.values.map((cell) => cell.label)).toEqual(["Floor / door", "Description"]);
        for (const cell of row.values) {
          expect(cell.labelVisible, `${row.bedroom}: ${cell.label} label is hidden`).toBe(true);
          expect(cell.value, `${row.bedroom}: ${cell.label} value is empty`).not.toBe("");
          expect(cell.box.left).toBeGreaterThanOrEqual(row.rowBox.left - 1);
          expect(cell.box.right).toBeLessThanOrEqual(row.rowBox.right + 1);
          expect(cell.scroll.width).toBeLessThanOrEqual(cell.scroll.clientWidth + 1);
          expect(cell.scroll.height).toBeLessThanOrEqual(cell.scroll.clientHeight + 1);
          expect(cell.textRects.length).toBeGreaterThan(0);
          // The pseudo-label is the first grid row; actual value text must start
          // below its 10px label line plus the CSS grid's 3px row gap.
          expect(cell.textRects[0]!.top).toBeGreaterThanOrEqual(cell.box.top + 12);
          for (const rect of cell.textRects) {
            expect(rect.left).toBeGreaterThanOrEqual(cell.box.left - 1);
            expect(rect.right).toBeLessThanOrEqual(cell.box.right + 1);
            expect(rect.bottom).toBeLessThanOrEqual(cell.box.bottom + 1);
          }
        }
      }
    });
  });
}

test.describe("desktop group flight table at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("every header and data cell contains its text without clipping or adjacent overlap", async ({ page }) => {
    await openFrozen(page, "/flights");

    const table = page.locator("table.flight-table");
    await expect(table).toHaveCount(1);
    const audit = await table.evaluate((element) => {
      const tableBox = element.getBoundingClientRect();
      const rows = [...element.querySelectorAll("tr")];
      const failures: string[] = [];
      const checkedCells: { row: number; text: string; rects: { top: number; right: number; bottom: number; left: number }[] }[] = [];

      rows.forEach((row, rowIndex) => {
        const cells = [...row.querySelectorAll<HTMLElement>("th, td")];
        const rowCells = cells.map((cell) => {
          const cellBox = cell.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(cell);
          const rects = [...range.getClientRects()]
            .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
            .map((rect) => ({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }));
          const name = `${rowIndex}:${cell.textContent?.trim() || "(empty)"}`;
          if (cell.scrollWidth > cell.clientWidth + 1) failures.push(`${name} horizontal scroll ${cell.scrollWidth}/${cell.clientWidth}`);
          if (cell.scrollHeight > cell.clientHeight + 1) failures.push(`${name} vertical scroll ${cell.scrollHeight}/${cell.clientHeight}`);
          if (cellBox.left < tableBox.left - 1 || cellBox.right > tableBox.right + 1) failures.push(`${name} cell outside table bounds`);
          if (rects.length === 0 && cell.textContent?.trim()) failures.push(`${name} has no visible text geometry`);
          for (const rect of rects) {
            if (rect.left < cellBox.left - 1 || rect.right > cellBox.right + 1 || rect.top < cellBox.top - 1 || rect.bottom > cellBox.bottom + 1) {
              failures.push(`${name} text outside cell bounds`);
            }
          }
          return { row: rowIndex, text: name, rects };
        });

        for (let leftIndex = 0; leftIndex < rowCells.length; leftIndex += 1) {
          for (let rightIndex = leftIndex + 1; rightIndex < rowCells.length; rightIndex += 1) {
            for (const left of rowCells[leftIndex]!.rects) {
              for (const right of rowCells[rightIndex]!.rects) {
                const overlaps = Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1 &&
                  Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1;
                if (overlaps) failures.push(`${rowCells[leftIndex]!.text} overlaps ${rowCells[rightIndex]!.text}`);
              }
            }
          }
        }
        checkedCells.push(...rowCells);
      });
      return { rowCount: rows.length, cellCount: checkedCells.length, failures };
    });

    expect(audit.rowCount).toBeGreaterThan(1);
    expect(audit.cellCount).toBeGreaterThan(20);
    expect(audit.failures).toEqual([]);
  });
});
