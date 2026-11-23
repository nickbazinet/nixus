/**
 * Generate the marketing site's favicon set.
 *
 * Mirrors the structure of `generate-og-image.ts`. The source is the Nixus
 * mark artwork in `scripts/brand/nixus-logo.png` (512×512, transparent): the
 * brand's own file is a raster, so it is wrapped in an SVG `<image>` and
 * rendered at each size through `@resvg/resvg-js`. Outputs:
 *
 *   - apps/web/public/favicon.svg            (modern browsers prefer this; it
 *                                             embeds a 64×64 PNG of the mark)
 *   - apps/web/public/favicon.ico            (32×32 PNG renamed to .ico —
 *                                             sufficient for modern browsers
 *                                             per NFR-W6; see spec TD-11)
 *   - apps/web/public/apple-touch-icon.png   (180×180 — iOS home screen)
 *   - apps/web/public/icon-192.png           (192×192 — Android home screen)
 *   - apps/web/public/icon-512.png           (512×512 — Android splash / PWA)
 *
 * Run with: `pnpm --filter @nixus/web generate-favicons`
 */

import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "../public");

const SOURCE_PNG = readFileSync(resolve(__dirname, "brand/nixus-logo.png")).toString("base64");

/** The mark as an SVG document, at `size` pixels, transparent around it. */
function markSvg(png: string, size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <image width="${size}" height="${size}" xlink:href="data:image/png;base64,${png}"/>
</svg>`;
}

const SOURCE_SVG = markSvg(SOURCE_PNG, 512);

/** Render the source at `size` pixels. The source is 512px, so every output is a downscale. */
function render(size: number): Buffer {
  return new Resvg(SOURCE_SVG, {
    fitTo: { mode: "width", value: size },
    background: "rgba(0, 0, 0, 0)",
  })
    .render()
    .asPng();
}

function writePng(size: number, filename: string): void {
  const png = render(size);
  writeFileSync(resolve(PUBLIC_DIR, filename), png);
  console.log(
    `Wrote ${filename} (${size}×${size}, ${png.length} bytes, ${(png.length / 1024).toFixed(1)} KB)`,
  );
}

// 1) Multi-resolution PNGs.
writePng(32, "favicon.ico"); // PNG-as-ico is acceptable for modern browsers.
writePng(180, "apple-touch-icon.png");
writePng(192, "icon-192.png");
writePng(512, "icon-512.png");

// 2) favicon.svg — modern browsers (Chrome 80+, Firefox 41+, Safari 16+) prefer
//    it. A 64px raster inside keeps it small; a tab icon never draws larger.
const favicon = markSvg(render(64).toString("base64"), 64);
writeFileSync(resolve(PUBLIC_DIR, "favicon.svg"), favicon);
console.log(`Wrote favicon.svg (${favicon.length} bytes)`);

console.log("Favicon generation complete.");
