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
 * the canonical Nixus N-mark logo with brand gradient, Inter via system-font
 * fallback). The two subtitle lines re-use copy from the marketing pitch.
 *
 * Logo gradient + geometry mirror `packages/shared/src/ui/nixus-logo.tsx`.
 * Keep them in sync if the brand mark evolves.
 */

import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F8FAFC"/>
      <stop offset="1" stop-color="#FFFFFF"/>
    </linearGradient>
    <linearGradient id="nixus-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#818CF8"/>
      <stop offset="50%" stop-color="#A78BFA"/>
      <stop offset="100%" stop-color="#F472B6"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <!-- Canonical Nixus N-mark (mirrors packages/shared/src/ui/nixus-logo.tsx) scaled 80x80 at (120, 170). Source viewBox is 0 0 32 32; scale 2.5x. -->
  <g transform="translate(120 170) scale(2.5)">
    <rect x="3" y="3" width="7" height="26" rx="2" fill="#818CF8"/>
    <rect x="22" y="3" width="7" height="26" rx="2" fill="#F472B6"/>
    <polygon points="3,29 10,29 29,3 22,3" fill="url(#nixus-grad)"/>
  </g>
  <text x="240" y="232" font-family="Inter, system-ui, sans-serif" font-size="64" font-weight="700" fill="#0F172A">Nixus</text>
  <text x="120" y="370" font-family="Inter, system-ui, sans-serif" font-size="56" font-weight="700" fill="#0F172A" letter-spacing="-1.5">Personal finance, automated.</text>
  <text x="120" y="450" font-family="Inter, system-ui, sans-serif" font-size="26" font-weight="400" fill="#475569">Drop in a credit card statement. Watch the AI categorize it.</text>
  <text x="120" y="495" font-family="Inter, system-ui, sans-serif" font-size="26" font-weight="400" fill="#475569">Budget · Accounts · Assets · Net worth — in one place.</text>
  <rect x="120" y="555" width="60" height="4" rx="2" fill="url(#nixus-grad)"/>
  <text x="200" y="566" font-family="Inter, system-ui, sans-serif" font-size="20" font-weight="500" fill="#64748B">nixus.app</text>
</svg>`;

const resvg = new Resvg(svg, {
  font: { loadSystemFonts: true },
  fitTo: { mode: "width", value: 1200 },
});
const png = resvg.render().asPng();
const out = resolve(__dirname, "../public/og-image.png");
writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes, ${(png.length / 1024).toFixed(1)} KB)`);
