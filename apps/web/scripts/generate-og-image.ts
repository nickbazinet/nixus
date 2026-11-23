/**
 * Generate the marketing site's Open Graph / Twitter card image (Story 4.2).
 *
 * Produces `apps/web/public/og-image.png` at 1200×630 — the size every major
 * platform (Twitter, LinkedIn, Slack, Discord, Facebook) crops to. The PNG
 * is committed to git as a versioned static asset; this script exists so the
 * design can be updated by re-running `pnpm --filter @nixus/web generate-og-image`
 * rather than hand-editing the file.
 *
 * Why @resvg/resvg-js?
 *   - SVG-source-of-truth means the design is editable with text diffs.
 *   - Native rendering is fast (<200ms) and produces a clean PNG at the
 *     fraction-of-a-megabyte size most platforms expect for OG images.
 *   - No headless-browser dependency — keeps CI lean.
 *
 * Visual language: matches the site (slate text on a near-white gradient,
 * the Nixus mark from `scripts/brand/nixus-logo.png`, Inter via system-font
 * fallback). The two subtitle lines re-use copy from the marketing pitch.
 */

import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MARK_PNG = readFileSync(resolve(__dirname, "brand/nixus-logo.png")).toString("base64");

const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F8FAFC"/>
      <stop offset="1" stop-color="#FFFFFF"/>
    </linearGradient>
    <linearGradient id="nixus-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5E78ED"/>
      <stop offset="50%" stop-color="#9978ED"/>
      <stop offset="100%" stop-color="#DE50A4"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <!-- The Nixus mark, 80x80 at (120, 170). -->
  <image x="120" y="170" width="80" height="80" xlink:href="data:image/png;base64,${MARK_PNG}"/>
  <text x="240" y="232" font-family="Poppins, Nunito, system-ui, sans-serif" font-size="64" font-weight="700" fill="#0F172A">Nixus</text>
  <text x="120" y="370" font-family="Poppins, Nunito, system-ui, sans-serif" font-size="56" font-weight="700" fill="#0F172A" letter-spacing="-1.5">Personal finance, automated.</text>
  <text x="120" y="450" font-family="Poppins, Nunito, system-ui, sans-serif" font-size="26" font-weight="400" fill="#475569">Drop in a credit card statement. Watch the AI categorize it.</text>
  <text x="120" y="495" font-family="Poppins, Nunito, system-ui, sans-serif" font-size="26" font-weight="400" fill="#475569">Budget · Accounts · Assets · Net worth — in one place.</text>
  <rect x="120" y="555" width="60" height="4" rx="2" fill="url(#nixus-grad)"/>
  <text x="200" y="566" font-family="Poppins, Nunito, system-ui, sans-serif" font-size="20" font-weight="500" fill="#64748B">nixusapp.com</text>
</svg>`;

const resvg = new Resvg(svg, {
  font: { loadSystemFonts: true },
  fitTo: { mode: "width", value: 1200 },
});
const png = resvg.render().asPng();
const out = resolve(__dirname, "../public/og-image.png");
writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes, ${(png.length / 1024).toFixed(1)} KB)`);
