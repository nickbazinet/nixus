import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit and security-gate tests for the account app.
 *
 * `environment: "node"` deliberately: everything under test here is the BFF's
 * server half — sessions, the OIDC callback, the origin check, the redirect
 * allow-list. The browser half is covered by `tests/e2e`, which drives the real
 * built server. Kept separate from `vite.config.ts` so the TanStack Start and
 * Tailwind plugins are not loaded for every test run.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
