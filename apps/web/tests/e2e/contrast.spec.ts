import { expect, test, type Locator, type Page } from "@playwright/test";

import { isDesktopTier } from "./support/site";

/**
 * Rendered text contrast on every tinted marketing surface.
 *
 * The colour work on this page is layered: a corner wash under the hero, brand
 * and neutral card tints, a gradient glow behind several bands. Each layer is
 * individually fine, and the failure mode is their sum — live prose ending up on
 * a surface a few percent darker than the token it was verified against. A token
 * audit cannot see that, because the problem only exists after compositing.
 *
 * So this measures pixels. Each target is screenshotted, decoded in the page,
 * and its lightest and darkest pixels are compared. That is deliberately
 * conservative: antialiasing keeps thin glyphs from reaching their full ink
 * colour, so the measured ratio sits a little BELOW the true one, and the test
 * can only fail when contrast is really short.
 *
 * Hidden-state reveal targets are scrolled to and given time to settle first.
 * A card caught at opacity 0 has no text pixels at all and would measure as an
 * empty box — a false failure that looks exactly like a real one.
 */

type Target = {
  readonly name: string;
  readonly selector: string;
  /** Measure every match rather than only the first. */
  readonly every?: boolean;
  /** Only rendered at the desktop tier; skipped (not tolerated) elsewhere. */
  readonly desktopOnly?: boolean;
};

const TARGETS: readonly Target[] = [
  { name: "hero eyebrow", selector: '[data-testid="hero-eyebrow"]' },
  { name: "hero headline", selector: "[data-testid=hero] h1" },
  { name: "hero subhead", selector: "[data-testid=hero] h1 + p" },
  { name: "hero alt download", selector: '[data-testid="hero"] [data-testid="download-cta-alt"]', desktopOnly: true },
  { name: "trust body", selector: '[data-testid="trust-claim"] p:nth-of-type(2)' },
  { name: "pillar body", selector: '[data-testid="pillar-card"] p' },
  { name: "step body", selector: '[data-testid="how-it-works-step"] p' },
  { name: "stage body", selector: '[data-testid="stage-row"] p' },
  { name: "feature body", selector: '[data-testid="feature-card"] p' },
  { name: "privacy stays", selector: '[data-testid="privacy-section"] .mkt-tint-brand li span:last-child' },
  { name: "privacy exception", selector: '[data-testid="privacy-exception"] p' },
  { name: "privacy badge", selector: '[data-testid="privacy-exception"] span.uppercase' },
  { name: "is (brand tint)", selector: '[data-testid="is-isnt-is"] li span:last-child' },
  { name: "isn't (warm neutral)", selector: '[data-testid="is-isnt-isnt"] li span:last-child' },
  { name: "founding body", selector: '[data-testid="beta-invite"] p' },
  { name: "founding list", selector: '[data-testid="beta-focus-list"] li span:last-child' },
  { name: "faq question", selector: '[data-slot="accordion-trigger"] span' },
  { name: "closing lead", selector: '[data-testid="closing-cta"] p' },
  { name: "section eyebrow", selector: '[data-testid="section-intro"] p.uppercase', every: true },
  { name: "section lead", selector: '[data-testid="section-intro"] p.text-lead', every: true },
];

async function settleReveals(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight * 0.7) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 70));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(900);
}

/**
 * Worst-case contrast of a text element against what is actually behind it.
 *
 * The glyphs are made transparent for the screenshot, so the capture is the
 * pure composited backdrop — gradient washes, photo, card tint and all — with no
 * glyph pixels in it. Every one of those pixels is then compared against the
 * element's DECLARED text colour, and the least contrast anywhere is reported.
 * That is the WCAG calculation done on real rendered pixels, and it needs no
 * heuristic to tell "text" from "background".
 *
 * Two earlier approaches were wrong, and both ways of being wrong are worth
 * knowing. Comparing the lightest and darkest pixel flatters a gradient,
 * because dark text sits on the DARKEST part of its backdrop, not the lightest.
 * Classifying pixels as background by distance from the median fixes that but
 * lets antialiased glyph edges (~50% coverage) in as "background", which reads
 * as a ~3:1 failure on perfectly good text.
 */
async function measure(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(80);
  const style = await locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      size: Number.parseFloat(s.fontSize),
      weight: Number(s.fontWeight),
      color: s.color,
    };
  });
  const ink = (style.color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);

  await locator.evaluate((el) => el.setAttribute("data-contrast-probe", ""));
  const shot = (await locator.screenshot()).toString("base64");
  await locator.evaluate((el) => el.removeAttribute("data-contrast-probe"));

  const least = await page.evaluate(
    async ({ b64, rgb }) => {
      const lin = (c: number) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const lum = (r: number, g: number, b: number) =>
        0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const g = canvas.getContext("2d");
      if (!g) throw new Error("no 2d context");
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, canvas.width, canvas.height).data;

      const inkL = lum(rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0);
      let worst = Infinity;
      for (let i = 0; i < px.length; i += 4) {
        const l = lum(px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0);
        const ratio = (Math.max(l, inkL) + 0.05) / (Math.min(l, inkL) + 0.05);
        if (ratio < worst) worst = ratio;
      }
      return worst;
    },
    { b64: shot, rgb: ink },
  );

  // WCAG large text: 24px regular, or 18.66px at weight 700+.
  const large = style.size >= 24 || (style.size >= 18.66 && style.weight >= 700);
  return { ratio: least, floor: large ? 3 : 4.5 };
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode text contrast`, () => {
    test(`clears WCAG AA on every tinted surface`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      await expect(page.getByTestId("hero")).toBeVisible();
      await page.addStyleTag({
        content:
          "[data-contrast-probe],[data-contrast-probe] *{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;transition:none!important}",
      });
      await settleReveals(page);

      const failures: string[] = [];
      let measured = 0;
      const required = TARGETS.filter(
        (target) => !target.desktopOnly || isDesktopTier(page),
      );
      for (const { name, selector, every } of required) {
        const matches = page.locator(selector);
        const count = await matches.count();
        if (count === 0) {
          failures.push(`${name}: selector matched nothing (${selector})`);
          continue;
        }
        const indices = every ? Array.from({ length: count }, (_, i) => i) : [0];
        for (const index of indices) {
          const { ratio, floor } = await measure(page, matches.nth(index));
          measured += 1;
          if (ratio < floor) {
            failures.push(
              `${name}${every ? ` #${index + 1}` : ""}: ${ratio.toFixed(2)}:1, needs ${floor}:1`,
            );
          }
        }
      }

      // A selector that quietly stops matching would turn this into a test that
      // passes by checking nothing.
      expect(measured).toBeGreaterThanOrEqual(required.length);
      expect(failures).toEqual([]);
    });
  });
}
