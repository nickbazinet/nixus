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
        // The crawler keeps only the PATH of every link, so the header's
        // absolute https://account.nixusapp.com/fr is crawled as this site's
        // `/fr` - a redirect to `/fr/` whose output can overwrite the real
        // French home depending on crawl order. Nothing on this site lives at `/fr`.
        filter: ({ path }) => path !== "/fr",
      },
    }),
    viteReact(),
  ],
  server: {
    port: 3000,
  },
});
