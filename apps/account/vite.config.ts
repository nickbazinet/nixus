import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Account app build (AD-14, and the Phase 0 hosting spike recipe verbatim).
 *
 * No Nitro: `@tanstack/react-start` 1.167.x already emits a plain Node-compatible
 * fetch server at `dist/server/server.js` whose default export is
 * `{ fetch(request) }`. `scripts/package-lambda.ts` wraps that with `srvx` for the
 * Lambda Web Function contract. Keep react-start pinned on the `~1.167.65` line:
 * 1.169+ requires Vite 8, and this workspace is on Vite 7.
 *
 * No prerender either. Every page here is session-dependent, so a build-time HTML
 * snapshot would either leak one visitor's state or be immediately stale.
 */
export default defineConfig({
  resolve: {
    alias: {
      // Mirrors `paths` in tsconfig.json. Vite 7 has no `resolve.tsconfigPaths`
      // (that is Vite 8+), so the alias is declared here and in vitest.config.ts.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
  server: {
    port: 3100,
  },
});
