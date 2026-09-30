import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";

const conversationStart = z.object({ conversationId: z.string() });

const delivery = z.object({ delivery: z.enum(["sent", "queued"]) });

const detailSchema = z.object({
  status: z.string(),
  error: z.string().nullable(),
  events: z.array(z.object({
    type: z.string(),
    payload: z.object({ text: z.string().optional(), toolName: z.string().optional(), ok: z.boolean().optional() }),
  })),
});

async function askSuggestion(page: Page, question: string, path: string) {
  const response = page.waitForResponse(value => value.url().endsWith(path) && value.request().method() === "POST");
  await page.getByRole("button", { name: question, exact: true }).click();

  return response;
}

async function detail(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/chat/conversations/${id}`);
  expect(response.ok()).toBe(true);

  return detailSchema.parse(await response.json());
}

test("a live trip tool answers the landing question and the answer survives reload", async ({ page, request }) => {
  await page.goto("/");
  const response = await askSuggestion(page, "What time do I need to land?", "/api/chat/conversations");
  expect(response.status()).toBe(201);
  const { conversationId } = conversationStart.parse(await response.json());
  expect(conversationId).toMatch(/^[a-z0-9]+$/);

  await expect.poll(async () => {
    const current = await detail(request, conversationId);

    return {
      flightRuleCalled: current.events.some(row => row.type === "tool_call" && row.payload.toolName === "getFlightRules"),
      flightRuleSucceeded: current.events.some(row => row.type === "tool_result" && row.payload.ok === true),
      answer: current.events.find(row => row.type === "message")?.payload.text ?? "",
      error: current.error,
    };
  }, { timeout: 120_000, intervals: [1_000] }).toMatchObject({
    flightRuleCalled: true,
    flightRuleSucceeded: true,
    answer: expect.stringMatching(/09:30[\s\S]*Source: Flights/),
    error: null,
  });
  await expect(page.getByRole("log", { name: "Trip conversation" })).toContainText("09:30");
  await page.reload();
  await expect(page.getByRole("log", { name: "Trip conversation" })).toContainText("09:30");
});

test("a suggestion clicked during an active answer is queued and receives its own answer", async ({ page, request }) => {
  await page.goto("/");
  const opening = await askSuggestion(page, "What time do I need to land?", "/api/chat/conversations");
  expect(opening.status()).toBe(201);
  const { conversationId } = conversationStart.parse(await opening.json());

  await expect.poll(async () => {
    const current = await detail(request, conversationId);

    return current.status === "completed" && current.events.some(row => row.type === "message");
  }, { timeout: 120_000, intervals: [1_000] }).toBe(true);

  const firstFollowup = await askSuggestion(page, "What are we doing Monday?", `/api/chat/conversations/${conversationId}/messages`);
  expect(firstFollowup.status()).toBe(200);
  expect(delivery.parse(await firstFollowup.json()).delivery).toBe("sent");

  const next = page.getByRole("button", { name: "Which nights is there no chef dinner?", exact: true });
  await expect(next).toBeEnabled();
  const followup = await askSuggestion(page, "Which nights is there no chef dinner?", `/api/chat/conversations/${conversationId}/messages`);
  expect(followup.status()).toBe(200);
  expect(delivery.parse(await followup.json()).delivery).toBe("queued");

  await expect.poll(async () => {
    const current = await detail(request, conversationId);

    return {
      userMessages: current.events.filter(row => row.type === "user_message").length,
      answers: current.events.filter(row => row.type === "message").length,
      failed: current.events.some(row => row.type === "turn.failed") || current.error !== null,
    };
  }, { timeout: 180_000, intervals: [1_000] }).toEqual({ userMessages: 3, answers: 3, failed: false });
});

test("a greeting and a live availability question both receive grounded replies", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto("/");
  const opening = page.waitForResponse(value => value.url().endsWith("/api/chat/conversations") && value.request().method() === "POST");
  await page.getByRole("textbox", { name: "Ask anything about the trip" }).fill("Hello, what can you help me with?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(async () => page.evaluate(() => document.activeElement?.tagName)).not.toBe("TEXTAREA");
  const response = await opening;
  expect(response.status()).toBe(201);
  const { conversationId } = conversationStart.parse(await response.json());

  await expect.poll(async () => {
    const current = await detail(request, conversationId);

    return current.events.find(row => row.type === "message")?.payload.text ?? "";
  }, { timeout: 120_000, intervals: [1_000] }).toMatch(/help|trip|flight|shuttle|chalet|room/i);
  const greeted = await detail(request, conversationId);
  expect(greeted.events.find(row => row.type === "message")?.payload.text).not.toMatch(/not in the trip notes|Source:/i);

  await expect.poll(async () => (await detail(request, conversationId)).status, { timeout: 120_000, intervals: [1_000] }).toBe("completed");
  const followup = await askSuggestion(page, "How much are the open spots?", `/api/chat/conversations/${conversationId}/messages`);
  expect(followup.status()).toBe(200);
  await expect.poll(async () => {
    const current = await detail(request, conversationId);

    return {
      checkedSpots: current.events.some(row => row.type === "tool_call" && row.payload.toolName === "getOpenSpots"),
      answered: current.events.filter(row => row.type === "message").length >= 2,
      failed: current.error !== null || current.events.some(row => row.type === "turn.failed"),
    };
  }, { timeout: 120_000, intervals: [1_000] }).toEqual({ checkedSpots: true, answered: true, failed: false });
});

test("the deployed trip facts give the current departure shuttle pickup", async ({ page, request }) => {
  await page.goto("/");
  const opening = page.waitForResponse(value => value.url().endsWith("/api/chat/conversations") && value.request().method() === "POST");
  await page.getByRole("textbox", { name: "Ask anything about the trip" }).fill("What time does the shuttle pick us up at the chalet on departure day?");
  await page.getByRole("button", { name: "Send" }).click();
  const response = await opening;
  expect(response.status()).toBe(201);
  const { conversationId } = conversationStart.parse(await response.json());

  await expect.poll(async () => {
    const current = await detail(request, conversationId);

    return current.events.find(row => row.type === "message")?.payload.text ?? "";
  }, { timeout: 120_000, intervals: [1_000] }).toMatch(/04:00[\s\S]*Source: Shuttle/);

  const current = await detail(request, conversationId);
  const answer = current.events.find(row => row.type === "message")?.payload.text ?? "";
  expect(answer).not.toContain("04:15");
  expect(current.error).toBeNull();
});
