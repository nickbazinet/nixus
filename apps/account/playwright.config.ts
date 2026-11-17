import { defineConfig } from "@playwright/test";

/**
 * E2E against the packaged server (`.deploy/bundle`), not a dev server: the
 * artifact CI uploads is the artifact the browser drives. `pnpm build && pnpm
 * package` has to have run first — the harness fails loudly if it has not.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  use: {
    // Each spec starts its own harness on an ephemeral port and sets baseURL.
    trace: "retain-on-failure",
    ignoreHTTPSErrors: false,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
