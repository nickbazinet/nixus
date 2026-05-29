import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for unit tests in the marketing site.
 *
 * Kept intentionally separate from `vite.config.ts` because that config
 * pulls in TanStack Start + Nitro plugins, which are heavy SSR/server
 * concerns we don't want loaded for every unit test run.
 *
 * Note: We intentionally do not load `@vitejs/plugin-react` here. Vitest
 * transforms JSX/TSX via esbuild by default, which is sufficient for unit
 * tests. The React plugin is only required for HMR / Fast Refresh in the
 * dev server. Skipping it here also avoids a TypeScript type conflict caused
 * by the desktop app's older `vitest@2` transitively pulling in `vite@5`,
 * which collides with this app's `vite@7` types when the React plugin is
 * passed through `defineConfig`.
 *
 * Path alias `@/*` mirrors the `paths` mapping in `tsconfig.json` so test
 * code (and components-under-test) can import via `@/lib/...` etc. We
 * resolve it explicitly here because Vite 7 does not yet support
 * `resolve.tsconfigPaths` (that's Vite 8+) — see the matching note in
 * `vite.config.ts`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
