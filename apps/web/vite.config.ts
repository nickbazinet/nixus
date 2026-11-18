import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  // Path alias `@/*` mirrors the `paths` mapping in `tsconfig.json`. Vite 7
  // does not yet support `resolve.tsconfigPaths` (that's Vite 8+); add the
  // alias explicitly for both the dev server and the production build.
  // The matching alias also lives in `vitest.config.ts`.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    nitro(),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: true,
        // Crawled aliases of an already-prerendered page - `/fr` (linked from the
        // French 404) and every `/#anchor` / `/fr/#anchor` (the header's section
        // links) - resolve to the SAME output file as `/fr/` or `/`. The crawler
        // renders them concurrently and each writeFile truncates that shared file,
        // which on Node 20 intermittently leaves the home page empty. The canonical
        // pages are still prerendered; only the duplicate writes are skipped.
        filter: ({ path }) => path !== "/fr" && !path.includes("#"),
      },
    }),
    viteReact(),
  ],
  server: {
    port: 3000,
  },
});
