import { chromium } from "@playwright/test";
const browser = await chromium.launch();
try {
  const res = await fetch("http://localhost:4173/admin");
  const raw = await res.text();
  console.log("no-cookie: status", res.status, "| has login:", raw.includes("admin-password"), "| leaks guest data:", /venmo|@[a-z]/i.test(raw.replace(/<script[\s\S]*?<\/script>/g, "")) && raw.includes("admin-guest"), "| cache-control:", res.headers.get("cache-control"));
  const page = await browser.newPage({ viewport: { width: 390, height: 1400 }, deviceScaleFactor: 2 });
  await page.goto("http://localhost:4173/admin");
  await page.waitForFunction(() => Object.keys(document.querySelector("#admin-password") ?? {}).some((k) => k.startsWith("__reactProps")), null, { timeout: 60000 });
  await page.fill("#admin-password", "Paris"); await page.click("button[type=submit]");
  await page.getByRole("alert").waitFor(); console.log("wrong password:", await page.getByRole("alert").innerText());
  await page.fill("#admin-password", "Vienna"); await page.click("button[type=submit]");
  await page.locator(".admin-guest").first().waitFor({ timeout: 20000 });
  const cards = await page.locator(".admin-guest").count();
  const venmos = await page.locator(".admin-field", { hasText: "Venmo" }).locator("dd").allInnerTexts();
  console.log("guest cards:", cards, "| with venmo:", venmos.filter((v) => v.trim() !== "—").length, "| enum underscores:", /[A-Z]+_[A-Z]+/.test(await page.locator(".admin-guests").innerText()));
  const cookie = (await page.context().cookies()).find((c) => c.name === "club_admin");
  console.log("cookie:", cookie?.value, cookie?.path, "httpOnly", cookie?.httpOnly);
  await page.screenshot({ path: process.argv[2] });
  await page.reload(); await page.locator(".admin-guest").first().waitFor(); console.log("after reload cards:", await page.locator(".admin-guest").count());
  await page.click("button[value=sign-out]"); await page.locator("#admin-password").waitFor();
  console.log("after sign-out cards:", await page.locator(".admin-guest").count());
} finally { await browser.close(); }
