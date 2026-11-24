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
        // Crawled aliases of an already-prerendered page resolve to the SAME
        // output file, and the crawler renders them concurrently: each writeFile
        // truncates that shared file, which on Node 20 intermittently leaves the
        // page empty. Two aliases exist, and both are structural rather than
        // accidental:
        //   - `/fr` — the router spells the French index `/fr` in its `to`
        //     union, so every `<Link>` to the French home (the header brand
        //     link, the announcement bar, "back to home" on the legal pages)
        //     emits `href="/fr"`, while the canonical URL and the prerendered
        //     object are `/fr/` → `fr/index.html`.
        //   - `/#anchor` and `/fr/#anchor` — section links such as
        //     `/pricing#compare` and `/founding-users#apply`.
        // The canonical pages are still prerendered; only the duplicate writes
        // are skipped.
        filter: ({ path }) => path !== "/fr" && !path.includes("#"),
      },
    }),
    viteReact(),
  ],
  server: {
    port: 3000,
  },
});
