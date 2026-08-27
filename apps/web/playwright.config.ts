import { defineConfig, devices } from "@playwright/test";

/**
 * Responsive E2E for the Nixus marketing site.
 *
 * Runs against the **production artifact**: `preview:static` serves
 * `.output/public` through the shipped CloudFront viewer-request function. The
 * acceptance criterion is "no console or hydration errors on the local
 * production build", and a dev server injects its own client, different asset
 * URLs, and React dev warnings that make that assertion meaningless. Build
 * first — the sequence is `build && verify:prerender && verify:routes && test:e2e`.
 *
 * The port is deliberately not the app's dev port and the server is never
 * reused: an unrelated process listening on 3000 silently served *its* pages to
 * this suite, which reported as a site-wide layout failure.
 *
 * One project per viewport in the DESIGN.md responsive tier. Widths are the real
 * device widths the spec names, driven with touch + mobile emulation below
 * 1024px so `hover:` never resolves and tap targets are measured the way a phone
 * actually lays them out. Every UA is pinned so OS detection cannot depend on
 * the host running the suite.
 */

const PORT = Number(process.env.WEB_PREVIEW_PORT ?? 4319);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/* React strips hydration and unknown-prop diagnostics from production builds, so
 * the production projects below are structurally incapable of catching a
 * mismatch. The `dev-*` projects run the same pages against `vite dev`, where
 * those diagnostics exist, and `dev-console.spec.ts` fails on any of them. */
const DEV_PORT = Number(process.env.WEB_DEV_PORT ?? 3100);
const DEV_BASE_URL = `http://127.0.0.1:${DEV_PORT}`;

const PHONE = {
  ...devices["Desktop Chrome"],
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
} as const;

const TABLET = {
  ...devices["Desktop Chrome"],
  hasTouch: true,
  deviceScaleFactor: 2,
  userAgent:
    "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
} as const;

const DESKTOP = {
  ...devices["Desktop Chrome"],
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
} as const;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "phone-320",
      testIgnore: /dev-console\.spec\.ts/,
      use: { ...PHONE, viewport: { width: 320, height: 640 } },
    },
    {
      name: "phone-375",
      testIgnore: /dev-console\.spec\.ts/,
      use: { ...PHONE, viewport: { width: 375, height: 667 } },
    },
    {
      name: "phone-390",
      testIgnore: /dev-console\.spec\.ts/,
      use: { ...PHONE, viewport: { width: 390, height: 844 } },
    },
    {
      name: "phone-430",
      testIgnore: /dev-console\.spec\.ts/,
      use: { ...PHONE, viewport: { width: 430, height: 932 } },
    },
    {
      name: "tablet-768",
      testIgnore: /dev-console\.spec\.ts/,
      use: { ...TABLET, viewport: { width: 768, height: 1024 } },
    },
    {
      name: "desktop-1280",
      testIgnore: /dev-console\.spec\.ts/,
      use: { ...DESKTOP, viewport: { width: 1280, height: 800 } },
    },
    {
      name: "dev-pixel",
      testMatch: /dev-console\.spec\.ts/,
      use: { ...devices["Pixel 7"], baseURL: DEV_BASE_URL },
    },
    {
      name: "dev-tablet",
      testMatch: /dev-console\.spec\.ts/,
      use: { ...TABLET, viewport: { width: 768, height: 1024 }, baseURL: DEV_BASE_URL },
    },
    {
      name: "dev-desktop",
      testMatch: /dev-console\.spec\.ts/,
      use: { ...DESKTOP, viewport: { width: 1280, height: 800 }, baseURL: DEV_BASE_URL },
    },
  ],
  webServer: [
    {
      command: "pnpm preview:static",
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm exec vite dev --port ${DEV_PORT} --strictPort --host 127.0.0.1`,
      url: DEV_BASE_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
