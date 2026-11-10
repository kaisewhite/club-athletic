import { defineConfig, devices } from "@playwright/test";
import { loadExplicitLocalTestEnv } from "./tests/visual/local-env";

const localTestEnv = loadExplicitLocalTestEnv();
if (localTestEnv.values.DATABASE_URL_POOLED) process.env.DATABASE_URL_POOLED = localTestEnv.values.DATABASE_URL_POOLED;
const port = 47_319;

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `bun run build && NODE_ENV=production PORT=${port} bash scripts/with-env.sh bun index.ts`,
    url: `http://127.0.0.1:${port}/guest-questionnaire`,
    env: { ...process.env, ...localTestEnv.values, CLUB_ATHLETIC_WEB_ENV_FILE: localTestEnv.envFile, NODE_ENV: "production", PORT: String(port) },
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
