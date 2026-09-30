import { expect, test, type Page } from "@playwright/test";

const answer = "Mocked local trip answer.";

async function mockChat(page: Page, failFirst = false) {
  let starts = 0;
  const submittedTexts: string[] = [];
  const conversationDetails = () => ({
    id: "local-mock-conversation", tripId: "local", status: "completed", createdAt: "2026-09-30T12:00:00.000Z",
    finishedAt: "2026-09-30T12:00:01.000Z", error: null, events: [
      { id: "user-1", seq: 1, type: "user_message", payload: { text: submittedTexts.at(-1) ?? "", delivery: "sent" } },
      { id: "assistant-1", seq: 2, type: "message", payload: { text: answer, threadRole: "root" } },
    ], eventsTruncated: false, eventsCursor: null, lastEventSeq: 2, agentSessionId: "local-session", pendingWakeupAt: null,
    chat: { canSend: true, reason: null, runtimeStatus: "closed", pendingWakeupAt: null, activeTurn: false, waitingOnApproval: false },
  });
  await page.route("**/api/chat/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === "/api/chat/conversations") {
      starts += 1;
      submittedTexts.push((request.postDataJSON() as { text: string }).text);
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
  return { starts: () => starts, submittedTexts };
}

test.describe("local chat browser journeys", () => {
  test.use({ hasTouch: true });
  test.beforeEach(({ }, testInfo) => test.skip(testInfo.project.name !== "desktop-1280", "run once at phone size"));

  test("a quick option sends once and receives a streamed answer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const chat = await mockChat(page);
    await page.goto("/");
    const quickOption = "What time do I need to land?";
    await page.getByRole("button", { name: quickOption }).click();
    await expect(page.getByText(answer)).toBeVisible();
    await expect(page.locator(".chat-user-bubble").getByText(quickOption, { exact: true })).toBeVisible();
    expect(chat.submittedTexts).toEqual([quickOption]);
    expect(chat.starts()).toBe(1);
  });

  test("a mobile typed send blurs the composer and receives one response", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const chat = await mockChat(page);
    await page.goto("/");
    const composer = page.getByRole("textbox", { name: "Ask anything about the trip" });
    const prompt = "Typed local question";
    await composer.fill(prompt);
    await composer.focus();
    await page.getByRole("button", { name: "Send" }).tap();
    await expect(page.getByText(answer)).toBeVisible();
    await expect(page.locator(".chat-user-bubble").getByText(prompt, { exact: true })).toBeVisible();
    await expect(composer).not.toBeFocused();
    expect(chat.submittedTexts).toEqual([prompt]);
    expect(chat.starts()).toBe(1);
  });

  test("a failed send exposes only Retry, which resends once and recovers", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const chat = await mockChat(page, true);
    await page.goto("/");
    const prompt = "Recover this question";
    await page.getByRole("textbox", { name: "Ask anything about the trip" }).fill(prompt);
    await page.getByRole("button", { name: "Send" }).tap();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await expect(page.getByText(/Not delivered|Edit|Resend/i)).toHaveCount(0);
    await page.getByRole("button", { name: "Retry", exact: true }).tap();
    await expect(page.getByText(answer)).toBeVisible();
    await expect(page.locator(".chat-user-bubble").getByText(prompt, { exact: true })).toBeVisible();
    expect(chat.submittedTexts).toEqual([prompt, prompt]);
    expect(chat.starts()).toBe(2);
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
    await page.getByRole("button", { name: "Menu" }).tap();
    await page.getByRole("dialog", { name: "Trip navigation" }).getByRole("button", { name: "Close navigation" }).tap();
    await expect(page.getByRole("dialog", { name: "Trip navigation" })).toHaveCount(0);
    await page.getByRole("button", { name: "Menu" }).tap();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Trip navigation" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Menu" })).toBeFocused();
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

  test("desktop typed send shows its exact prompt and streamed answer", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const chat = await mockChat(page);
    await page.goto("/");
    const prompt = "Desktop typed prompt";
    await page.getByRole("textbox", { name: "Ask anything about the trip" }).fill(prompt);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator(".chat-user-bubble").getByText(prompt, { exact: true })).toBeVisible();
    await expect(page.getByText(answer)).toBeVisible();
    expect(chat.submittedTexts).toEqual([prompt]);
    expect(chat.starts()).toBe(1);
  });

  test("desktop quick option sends its exact text once and receives an answer", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const chat = await mockChat(page);
    await page.goto("/");
    const quickOption = "Where am I sleeping?";
    await page.getByRole("button", { name: quickOption }).click();
    await expect(page.locator(".chat-user-bubble").getByText(quickOption, { exact: true })).toBeVisible();
    await expect(page.getByText(answer)).toBeVisible();
    expect(chat.submittedTexts).toEqual([quickOption]);
    expect(chat.starts()).toBe(1);
  });
});
