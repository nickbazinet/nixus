/**
 * Generate the marketing site's favicon set.
 *
 * Mirrors the structure of `generate-og-image.ts`. One source SVG (the
 * Nixus N-mark with the brand gradient) is rendered at multiple sizes via
 * `@resvg/resvg-js`. Outputs:
 *
 *   - apps/web/public/favicon.svg            (modern browsers prefer this)
 *   - apps/web/public/favicon.ico            (32×32 PNG renamed to .ico —
 *                                             sufficient for modern browsers
 *                                             per NFR-W6; see spec TD-11)
 *   - apps/web/public/apple-touch-icon.png   (180×180 — iOS home screen)
 *   - apps/web/public/icon-192.png           (192×192 — Android home screen)
 *   - apps/web/public/icon-512.png           (512×512 — Android splash / PWA)
 *
 * The geometry is intentionally duplicated here rather than imported from
 * `packages/shared` — build scripts can't import React components, and a
 * standalone SVG string keeps the rendering pipeline simple.
 *
 * Run with: `pnpm --filter @nkbaz/web generate-favicons`
 */

import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "../public");

/**
 * The canonical Nixus N-mark.
 *
 * Mirrors the geometry of `packages/shared/src/ui/nixus-logo.tsx` (the
 * shared brand component consumed by `apps/desktop` and `apps/web`'s site
 * header): two pillars — indigo (#818CF8) on the left, pink (#F472B6) on
 * the right — joined by a diagonal that carries the indigo→violet→pink
 * brand gradient. Background is transparent so the mark sits flush on
 * whatever surface hosts it (browser tab strip, OS home screen, etc.).
 *
 * Geometry duplicated here rather than imported because build scripts
 * can't import React components and resvg needs a plain SVG string. Keep
 * in sync with the shared component if either is edited.
 */
const SOURCE_SVG = `<svg width="64" height="64" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="nixus-mark-gradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#818CF8"/>
      <stop offset="50%" stop-color="#A78BFA"/>
      <stop offset="100%" stop-color="#F472B6"/>
    </linearGradient>
  </defs>
  <rect x="3" y="3" width="7" height="26" rx="2" fill="#818CF8"/>
  <rect x="22" y="3" width="7" height="26" rx="2" fill="#F472B6"/>
  <polygon points="3,29 10,29 29,3 22,3" fill="url(#nixus-mark-gradient)"/>
</svg>`;

/**
 * Render the source SVG at the requested pixel size and write the PNG to
 * `public/<filename>`. `fitTo: { mode: "width", value: size }` upscales the
 * vector geometry to the target raster size — no aliasing since we're
 * redrawing from vector at every output size.
 */
function renderPng(size: number, filename: string): void {
  const resvg = new Resvg(SOURCE_SVG, {
    fitTo: { mode: "width", value: size },
    background: "rgba(0, 0, 0, 0)",
  });
  const png = resvg.render().asPng();
  const out = resolve(PUBLIC_DIR, filename);
  writeFileSync(out, png);
  console.log(
    `Wrote ${filename} (${size}×${size}, ${png.length} bytes, ${(png.length / 1024).toFixed(1)} KB)`,
  );
}

// 1) Source SVG — modern browsers (Chrome 80+, Firefox 41+, Safari 16+)
//    prefer this; it's resolution-independent and tiny.
const svgOut = resolve(PUBLIC_DIR, "favicon.svg");
writeFileSync(svgOut, SOURCE_SVG);
console.log(`Wrote favicon.svg (${SOURCE_SVG.length} bytes)`);

// 2) Multi-resolution PNGs.
renderPng(32, "favicon.ico"); // PNG-as-ico is acceptable for modern browsers.
renderPng(180, "apple-touch-icon.png");
renderPng(192, "icon-192.png");
renderPng(512, "icon-512.png");

console.log("Favicon generation complete.");
