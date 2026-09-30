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

for (const [width, height] of [[320, 568], [375, 812], [390, 844], [412, 915], [768, 1024], [820, 1180]] as const) {
  test.describe(`bedroom map mobile detail rows at ${width}px`, () => {
    test.use({ viewport: { width, height } });

    test("keeps the row name and labeled floor/description values visible without overlap", async ({ page }) => {
      await openFrozen(page, "/rooms");

      const rows = page.locator(".bm-room-table tbody tr");
      expect(await rows.count()).toBe(8);

      const results = await rows.evaluateAll((elements) => elements.map((row) => {
        const rect = (element: Element | null) => {
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
        };
        const bedroom = row.querySelector<HTMLElement>('th[scope="row"]');
        const cells = [...row.querySelectorAll<HTMLElement>("td[data-label]")];
        return {
          row: rect(row),
          bedroom: bedroom?.textContent?.trim() ?? "",
          bedroomRect: rect(bedroom),
          fields: cells.map((cell) => {
            const label = cell.querySelector<HTMLElement>(".bm-mobile-field-label");
            const value = cell.querySelector<HTMLElement>(".bm-mobile-field-value");
            const valueRange = document.createRange();
            if (value) valueRange.selectNodeContents(value);
            const valueTextRects = [...valueRange.getClientRects()]
              .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
              .map((rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }));
            return {
              name: cell.dataset.label ?? "",
              valueText: value?.textContent?.trim() ?? "",
              cell: rect(cell),
              labelText: label?.textContent?.trim() ?? "",
              label: rect(label),
              labelVisible: !!label && getComputedStyle(label).display !== "none" && getComputedStyle(label).visibility !== "hidden",
              labelAccessible: !!label && label.getAttribute("aria-hidden") !== "true" && !label.closest('[aria-hidden="true"]'),
              value: rect(value),
              valueVisible: !!value && getComputedStyle(value).display !== "none" && getComputedStyle(value).visibility !== "hidden",
              valueTextRects,
              cellDisplay: getComputedStyle(cell).display,
              scrolls: !!cell && (cell.scrollWidth > cell.clientWidth + 1 || cell.scrollHeight > cell.clientHeight + 1),
            };
          }),
        };
      }));

      const intersects = (a: NonNullable<typeof results[number]["row"]>, b: NonNullable<typeof results[number]["row"]>) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;

      for (const row of results) {
        expect(row.bedroom, "row heading must identify the bedroom").toMatch(/^Bedroom\s+\d+/);
        expect(row.bedroomRect).not.toBeNull();
        expect(row.fields.map((field) => field.name)).toEqual(["Floor / door", "Description"]);
        expect(row.fields.map((field) => field.labelText)).toEqual(["Floor / door", "Description"]);
        expect(row.fields.every((field) => field.labelVisible && field.labelAccessible && field.cellDisplay === "grid" && !field.scrolls)).toBe(true);
        for (const field of row.fields) {
          expect(field.label).not.toBeNull();
          expect(field.value).not.toBeNull();
          expect(field.valueVisible).toBe(true);
          expect(field.label!.height).toBeGreaterThan(0);
          expect(field.cell!.width).toBeGreaterThan(0);
          expect(field.cell!.left).toBeGreaterThanOrEqual(row.row!.left - 1);
          expect(field.cell!.right).toBeLessThanOrEqual(row.row!.right + 1);
          expect(intersects(field.label!, field.value!)).toBe(false);
          expect(intersects(row.bedroomRect!, field.label!)).toBe(false);
          expect(intersects(row.bedroomRect!, field.value!)).toBe(false);
          expect(field.value!.left).toBeGreaterThanOrEqual(field.cell!.left - 1);
          expect(field.value!.right).toBeLessThanOrEqual(field.cell!.right + 1);
          expect(field.value!.top).toBeGreaterThanOrEqual(field.cell!.top - 1);
          expect(field.value!.bottom).toBeLessThanOrEqual(field.cell!.bottom + 1);
          if (field.valueText) {
            expect(field.value!.width).toBeGreaterThan(0);
            expect(field.value!.height).toBeGreaterThan(0);
            expect(field.valueTextRects.length).toBeGreaterThan(0);
            for (const textRect of field.valueTextRects) {
              expect(textRect.left).toBeGreaterThanOrEqual(field.cell!.left - 1);
              expect(textRect.right).toBeLessThanOrEqual(field.cell!.right + 1);
              expect(textRect.top).toBeGreaterThanOrEqual(field.cell!.top - 1);
              expect(textRect.bottom).toBeLessThanOrEqual(field.cell!.bottom + 1);
              expect(textRect.left).toBeGreaterThanOrEqual(row.row!.left - 1);
              expect(textRect.right).toBeLessThanOrEqual(row.row!.right + 1);
              expect(textRect.top).toBeGreaterThanOrEqual(row.row!.top - 1);
              expect(textRect.bottom).toBeLessThanOrEqual(row.row!.bottom + 1);
            }
          }
        }
        expect(intersects(row.fields[0]!.cell!, row.fields[1]!.cell!)).toBe(false);
      }
    });
  });
}

for (const width of [1280, 1440]) {
  test.describe(`desktop group flight table at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("every header and data cell contains its text without clipping or adjacent overlap", async ({ page }) => {
    await openFrozen(page, "/flights");

    const table = page.locator("table.flight-table");
    await expect(table).toHaveCount(1);
    const audit = await table.evaluate((element) => {
      const tableBox = element.getBoundingClientRect();
      const rows = [...element.querySelectorAll("tr")];
      const bodyRows = [...element.querySelectorAll("tbody tr")];
      const headerRowCount = element.querySelectorAll("thead tr").length;
      const failures: string[] = [];
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
      });
      return { rowCount: rows.length, headerRowCount, bodyRowCount: bodyRows.length, bodyColumnCounts: bodyRows.map((row) => row.querySelectorAll("th, td").length), failures };
    });

      expect(audit.rowCount).toBe(14);
      expect(audit.headerRowCount).toBe(2);
      expect(audit.bodyRowCount).toBe(12);
      expect(audit.bodyColumnCounts).toEqual(Array.from({ length: 12 }, () => 8));
      expect(audit.failures).toEqual([]);
    });
  });
}
