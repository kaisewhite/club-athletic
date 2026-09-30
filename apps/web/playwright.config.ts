// Desktop-frozen visual baseline — TODO §2.15 ("lock a desktop baseline before
// any mobile work") and §7 ("the locked 1280/1920 baseline must show zero diff
// on every PR"). Decision D19 names Playwright's `toHaveScreenshot` for this.
//
// Mirrors `edge/apps/web-platform`'s visual setup: the same pinned Playwright
// (1.62.1), chromium only, headless, one snapshot folder called
// `tests/visual/__screenshots__`. It differs in one deliberate way — edge's
// baseline lives in a vitest `browser` project and photographs *mounted
// components*, while this one photographs the *ten real SSR routes* served by
// `index.ts`, because that is what the mobile pass can break.
import { defineConfig, devices } from "@playwright/test";
import { loadExplicitLocalTestEnv } from "./tests/visual/local-env";

// Never inherit the repository's .env for acceptance runs. The explicit file
// is parsed and both database endpoints are required to be loopback before the
// runner can configure or start the app server.
const localTestEnv = loadExplicitLocalTestEnv();

/**
 * Deliberately unusual: this machine is shared, `edge` holds 3000 and 5173, and
 * a stray occupant would silently photograph the wrong app. Not an environment
 * variable — a constant, because §2.15's baseline has to be reproducible.
 */
const PORT = 47_317;

export default defineConfig({
  testDir: "tests/visual",
  // One page at a time: parallel workers each launch a browser, and the
  // resulting CPU contention is a known source of font-rasterisation drift.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  // `list` only. The `html` reporter starts a web server on failure, which would
  // outlive the run.
  reporter: [["list"]],
  // `{platform}` is kept on purpose: pixel output is OS-specific, so a Linux CI
  // run must record its own set rather than silently diffing against darwin PNGs.
  // `{testDir}` is the absolute `tests/visual`; `{testFileDir}` would be relative
  // to it and empty here, which resolves to `/__screenshots__` at the filesystem
  // root. `__screenshots__` is edge/apps/web-platform's folder name.
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}-{projectName}-{platform}{ext}",
  expect: {
    toHaveScreenshot: {
      // Freeze CSS animations/transitions at their end state. `src/styles.css`
      // already drops `rise` and `blink` under `prefers-reduced-motion`, which
      // `use.reducedMotion` below turns on; this covers anything added later.
      animations: "disabled",
      caret: "hide",
      scale: "css",
      // §7 asks for zero diff. `threshold` (default 0.2) still absorbs a single
      // pixel's worth of anti-aliasing noise, but no pixel may exceed it.
      maxDiffPixels: 0,
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    deviceScaleFactor: 1,
    // The app hard-codes `class="dark"`; pinning these three stops the host
    // machine's appearance, locale and timezone from leaking into the capture.
    colorScheme: "dark",
    // 1.62 exposes `reducedMotion` through `contextOptions` rather than as a
    // top-level `use` key. This is the switch that makes `src/styles.css`'s own
    // `prefers-reduced-motion` block turn `rise` and `blink` off at the source,
    // rather than us injecting CSS the real page never sees.
    contextOptions: { reducedMotion: "reduce" },
    locale: "en-GB",
    timezoneId: "Europe/Paris",
    launchOptions: {
      args: [
        // Scrollbar rendering is machine- and OS-setting-dependent (overlay vs
        // classic, width, "show automatically"), which is pure diff noise. The
        // app's own `.navrow` rule already hides the horizontal ones on the week
        // strip, chip row and suggestions; this covers the document scrollbar
        // and anything added later without that class.
        "--hide-scrollbars",
        // Pin colour management and text rasterisation.
        "--force-color-profile=srgb",
        "--disable-lcd-text",
        "--font-render-hinting=none",
      ],
    },
  },
  // §7 names both widths. Heights are the conventional desktop pair.
  projects: [
    { name: "desktop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "desktop-1920", use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } } },
  ],
  webServer: {
    // Production mode, with the explicitly supplied local test env for both the
    // build and server process. `reuseExistingServer: false` prevents attaching
    // to a listener whose database configuration this run cannot verify.
    command: `bun run build && NODE_ENV=production PORT=${PORT} bash scripts/with-env.sh bun index.ts`,
    url: `http://127.0.0.1:${PORT}/`,
    env: {
      ...process.env,
      ...localTestEnv.values,
      CLUB_ATHLETIC_WEB_ENV_FILE: localTestEnv.envFile,
      NODE_ENV: "production",
      PORT: String(PORT),
    },
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
