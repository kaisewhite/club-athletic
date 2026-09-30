import { defineConfig, devices } from "@playwright/test";

const external = process.env.CHAT_LIVE_BASE_URL;

const port = 47_318;

export default defineConfig({
  testDir: "tests/live",
  timeout: 200_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], baseURL: external ?? `http://127.0.0.1:${port}` },
  webServer: external ? undefined : {
    command: `NODE_ENV=production PORT=${port} bash scripts/with-env.sh bun index.ts`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
