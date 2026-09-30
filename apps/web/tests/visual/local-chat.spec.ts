import { expect, test, type Page } from "@playwright/test";

const answer = "Mocked local trip answer.";

async function mockChat(page: Page, failFirst = false) {
  let starts = 0;
  const conversationDetails = () => ({
    id: "local-mock-conversation", tripId: "local", status: "completed", createdAt: "2026-09-30T12:00:00.000Z",
    finishedAt: "2026-09-30T12:00:01.000Z", error: null, events: [
      { id: "user-1", seq: 1, type: "user_message", payload: { text: "local question", delivery: "sent" } },
      { id: "assistant-1", seq: 2, type: "message", payload: { text: answer, threadRole: "root" } },
    ], eventsTruncated: false, eventsCursor: null, lastEventSeq: 2, agentSessionId: "local-session", pendingWakeupAt: null,
    chat: { canSend: true, reason: null, runtimeStatus: "closed", pendingWakeupAt: null, activeTurn: false, waitingOnApproval: false },
  });
  await page.route("**/api/chat/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === "/api/chat/conversations") {
      starts += 1;
      if (failFirst && starts === 1) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "local mock failure" }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, conversationId: "local-mock-conversation", seq: 0 }) });
      return;
    }
    if (url.pathname.endsWith("/stream")) {
      const details = conversationDetails();
      const frames = [
        ...details.events.map(row => `event: activity\nid: ${row.seq}\ndata: ${JSON.stringify(row)}\n\n`),
        `event: state\ndata: ${JSON.stringify({ runtimeStatus: "closed", status: "completed", activeRequestIdPresent: false, activeTurnId: null, pendingWakeupAt: null, waitingOnApproval: false })}\n\n`,
        "event: done\ndata: {}\n\n",
      ];
      const frame = frames.join("");
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: frame });
      return;
    }
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "completed", lastEventSeq: 2, finishedAt: "2026-09-30T12:00:01.000Z", error: null }) });
      return;
    }
    if (url.pathname === "/api/chat/conversations/local-mock-conversation") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(conversationDetails()) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });
  return () => starts;
}

test.describe("local chat browser journeys", () => {
  test.use({ hasTouch: true });
  test.beforeEach(({ }, testInfo) => test.skip(testInfo.project.name !== "desktop-1280", "run once at phone size"));

  test("a quick option sends once and receives a streamed answer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const starts = await mockChat(page);
    await page.goto("/");
    await page.getByRole("button", { name: "What time do I need to land?" }).click();
    await expect(page.getByText(answer)).toBeVisible();
    expect(starts()).toBe(1);
  });

  test("a mobile typed send blurs the composer and receives one response", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const starts = await mockChat(page);
    await page.goto("/");
    const composer = page.getByRole("textbox", { name: "Ask anything about the trip" });
    await composer.fill("Typed local question");
    await composer.focus();
    await page.getByRole("button", { name: "Send" }).tap();
    await expect(page.getByText(answer)).toBeVisible();
    await expect(composer).not.toBeFocused();
    expect(starts()).toBe(1);
  });

  test("a failed send exposes only Retry, which resends once and recovers", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const starts = await mockChat(page, true);
    await page.goto("/");
    await page.getByRole("textbox", { name: "Ask anything about the trip" }).fill("Recover this question");
    await page.getByRole("button", { name: "Send" }).tap();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await expect(page.getByText(/Not delivered|Edit|Resend/i)).toHaveCount(0);
    await page.getByRole("button", { name: "Retry", exact: true }).tap();
    await expect(page.getByText(answer)).toBeVisible();
    expect(starts()).toBe(2);
  });

  test("mobile navigation opens, navigates, and closes through touch taps", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Menu" });
    await toggle.tap();
    await expect(page.getByRole("dialog", { name: "Trip navigation" })).toBeVisible();
    await page.getByRole("link", { name: "Rooms", exact: true }).tap();
    await expect(page).toHaveURL(/\/rooms$/);
    await expect(page.getByRole("dialog", { name: "Trip navigation" })).toHaveCount(0);
  });

  test("landscape phone viewport keeps the app within the screen", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto("/");
    await expect(page.locator(".mobile-header")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(844);
  });

  test("desktop acceptance viewports render without horizontal overflow", async ({ page }) => {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      const widths = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      expect(widths.scroll, `${viewport.width}x${viewport.height} page overflow`).toBeLessThanOrEqual(widths.client);
    }
  });
});
