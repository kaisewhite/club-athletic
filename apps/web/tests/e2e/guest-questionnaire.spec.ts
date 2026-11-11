import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../prisma/generated/client";
import { expect, test } from "@playwright/test";

async function getDummyGuest(firstName: string) {
  const connectionString = process.env.DATABASE_URL_POOLED;
  if (!connectionString) throw new Error("The isolated E2E database URL is missing.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    return await db.guest.findFirst({ where: { firstName }, select: { id: true, status: true, spot: { select: { id: true } } } });
  } finally {
    await db.$disconnect();
  }
}

test("a guest can resume a local draft and submit all details once", async ({ page }) => {
  const dummyName = `E2E Dummy ${Date.now()}`;
  const submissions: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/guest-details") && request.method() === "POST") submissions.push(request.postData() ?? "");
  });

  await page.goto("/questionnaire");
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByLabel("First name").fill(dummyName);
  await page.getByLabel("Last name").fill("Questionnaire");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Select a room" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Resume questionnaire" })).toBeVisible();
  await page.getByRole("button", { name: "Resume questionnaire" }).click();
  await expect(page.getByRole("heading", { name: "Select a room" })).toBeVisible();
  expect(await getDummyGuest(dummyName)).toBeNull();

  const roomChoice = page.locator('input[name="roomId"]').first();
  await roomChoice.check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("textbox", { name: "Mobile / WhatsApp number" }).fill("+1 415 555 0132");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Venmo handle").fill("@e2e-dummy");
  await page.getByLabel("Instagram handle (optional)").fill("@e2e.dummy");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("#guest-dietaryNotes").fill("None");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("#guest-favoriteCocktails").fill("Margarita");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Payment & cancellation policy" })).toBeVisible();
  expect(await getDummyGuest(dummyName)).toMatchObject({ status: "CONFIRMED", spot: { id: expect.any(String) } });
  await page.reload();
  await expect(page.getByRole("button", { name: "Resume questionnaire" })).toBeVisible();
  await page.getByRole("button", { name: "Resume questionnaire" }).click();
  await expect(page.getByRole("heading", { name: "Payment & cancellation policy" })).toBeVisible();
  await expect(page.getByText("@kaise-white")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("heading", { name: "Thanks — you’re all set." })).toBeVisible();

  expect(submissions).toHaveLength(1);
  const payload = JSON.parse(submissions[0]!);
  expect(payload).toMatchObject({ firstName: dummyName, lastName: "Questionnaire", venmoHandle: "@e2e-dummy", favoriteCocktails: "Margarita" });

  const firstGuest = await getDummyGuest(dummyName);
  expect(firstGuest).not.toBeNull();
  const repeatPage = await page.context().newPage();
  repeatPage.on("request", (request) => {
    if (request.url().endsWith("/api/guest-details") && request.method() === "POST") submissions.push(request.postData() ?? "");
  });
  await repeatPage.goto("/questionnaire");
  await repeatPage.getByRole("button", { name: "Start" }).click();
  await repeatPage.getByLabel("First name").fill(dummyName);
  await repeatPage.getByLabel("Last name").fill("Questionnaire");
  await repeatPage.getByRole("button", { name: "Continue" }).click();
  await repeatPage.locator('input[name="roomId"]').first().check();
  await repeatPage.getByRole("button", { name: "Continue" }).click();
  await repeatPage.getByRole("textbox", { name: "Mobile / WhatsApp number" }).fill("+1 415 555 0132");
  await repeatPage.getByRole("button", { name: "Continue" }).click();
  await repeatPage.getByLabel("Venmo handle").fill("@e2e-dummy");
  await repeatPage.getByLabel("Instagram handle (optional)").fill("@e2e.dummy");
  await repeatPage.getByRole("button", { name: "Continue" }).click();
  await repeatPage.locator("#guest-dietaryNotes").fill("None");
  await repeatPage.getByRole("button", { name: "Continue" }).click();
  await repeatPage.locator("#guest-favoriteCocktails").fill("Margarita");
  await repeatPage.getByRole("button", { name: "Continue" }).click();
  await expect(repeatPage.getByRole("heading", { name: "Payment & cancellation policy" })).toBeVisible();
  const repeatedGuest = await getDummyGuest(dummyName);
  expect(repeatedGuest).toMatchObject({ id: firstGuest!.id, status: "CONFIRMED", spot: { id: expect.any(String) } });
  expect(submissions).toHaveLength(2);
  expect(JSON.parse(submissions[1]!).submissionId).not.toBe(payload.submissionId);

  const connectionString = process.env.DATABASE_URL_POOLED;
  if (!connectionString) throw new Error("The isolated E2E database URL is missing.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const submission = await db.guestSubmission.findUnique({
      where: { submissionId: payload.submissionId },
      include: { guest: { select: { firstName: true, lastName: true, status: true, venmoHandle: true, favoriteCocktails: true } } },
    });
    expect(submission?.guest).toMatchObject({ firstName: dummyName, lastName: "Questionnaire", status: "CONFIRMED", venmoHandle: "@e2e-dummy", favoriteCocktails: "Margarita" });
    expect(submission?.processedAt).not.toBeNull();
  } finally {
    await db.$disconnect();
  }
});
