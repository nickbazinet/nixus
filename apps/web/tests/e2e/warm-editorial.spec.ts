import { expect, test, type Page } from "@playwright/test";

import { expectedHeaderHeight, isDesktopTier, viewportWidth } from "./support/site";

/**
 * Warm Editorial — the marketing-only light palette, verified as *rendered*.
 *
 * Every expectation below is a `getComputedStyle` value read off a real element
 * on the production static build, never a class name and never a screenshot. A
 * class assertion passes while the token behind it is wrong, and a screenshot
 * baseline fails on font rasterisation; a resolved `rgb()` is the only thing
 * that proves a visitor sees the contract.
 *
 * The palette is web-scoped by design: `apps/web/src/styles/main.css` overrides
 * the shared spine variables under `:root:not(.dark)` only, so the desktop app
 * and web dark mode keep Quiet Ledger. The dark block at the bottom is what
 * makes that claim falsifiable rather than asserted.
 */

/** DESIGN.md `{marketing-colors}`, as Chromium serialises each hex. */
const WARM = {
  bg: "rgb(250, 248, 245)",
  card: "rgb(255, 255, 255)",
  chrome: "rgb(245, 242, 236)",
  ink: "rgb(28, 25, 23)",
  inkDim: "rgb(107, 99, 90)",
  inkFaint: "rgb(113, 104, 95)",
  line: "rgb(232, 227, 218)",
  lineStrong: "rgb(216, 209, 197)",
  hover: "rgb(251, 249, 246)",
  brand: "rgb(91, 84, 214)",
  brandInk: "rgb(74, 67, 190)",
  brandSoft: "rgb(239, 237, 251)",
  brandOn: "rgb(255, 255, 255)",
  focusRing: "rgb(91, 84, 214)",
} as const;

/** The shared Quiet Ledger dark values, which this task must leave untouched. */
const QUIET_LEDGER_DARK = {
  bg: "rgb(8, 13, 24)",
  card: "rgb(23, 32, 51)",
  line: "rgb(42, 53, 71)",
  ink: "rgb(232, 237, 245)",
} as const;

/** The one warm elevation DESIGN.md permits, on `ProductFrame` imagery only. */
const FRAME_SHADOW =
  "rgba(58, 44, 24, 0.05) 0px 1px 2px 0px, rgba(58, 44, 24, 0.18) 0px 14px 30px -16px";

type SurfaceReport = {
  htmlClass: string;
  headerBarHeight: number;
  bodyBackground: string;
  bodyInk: string;
  pageSection: string;
  featureBand: string;
  cardBackground: string;
  cardBorder: string;
  cardShadow: string;
  cardInkDim: string;
  accordionBorder: string;
  accordionInk: string;
  brandFill: string;
  brandFillInk: string;
};

type TokenName = "chrome" | "hover" | "brandSoft" | "brandInk" | "inkFaint" | "focusRing";

type MaterialReport = {
  ruleWidth: string;
  ruleColor: string;
  ruleLength: string;
  measureLead: string;
  measureProse: string;
  asymDisplay: string;
  asymColumnCount: number;
  heroOverlap: string;
  overlapClear: string;
  ambientPosition: string;
  ambientOpacity: string;
  frameShadow: string;
};

/**
 * The prerendered CTA is OS-neutral and swaps variant on mount, so reading a
 * shared-Button colour before hydration reads a different element than the one
 * the visitor ends up with. `data-os` leaving `choose` is that barrier.
 */
async function settleHydration(page: Page): Promise<void> {
  const cta = page.locator("#main-content").getByTestId("download-cta").first();
  await expect(cta).not.toHaveAttribute("data-os", "choose");
}

async function readSurfaces(page: Page): Promise<SurfaceReport> {
  return page.evaluate(() => {
    const read = (selector: string, property: string): string => {
      const el = document.querySelector(selector);
      if (!el) return `MISSING ${selector}`;
      return getComputedStyle(el).getPropertyValue(property);
    };
    const bar = document.querySelector("header")?.firstElementChild;
    const body = getComputedStyle(document.body);
    return {
      htmlClass: document.documentElement.className,
      headerBarHeight: bar ? Math.round(bar.getBoundingClientRect().height) : 0,
      bodyBackground: body.backgroundColor,
      bodyInk: body.color,
      pageSection: read('[data-testid="faq"]', "background-color"),
      featureBand: read('[data-testid="feature-grid"]', "background-color"),
      cardBackground: read('[data-testid="feature-card"]', "background-color"),
      cardBorder: read('[data-testid="feature-card"]', "border-top-color"),
      cardShadow: read('[data-testid="feature-card"]', "box-shadow"),
      cardInkDim: read('[data-testid="feature-card"] p', "color"),
      accordionBorder: read('[data-slot="accordion-item"]', "border-bottom-color"),
      accordionInk: read('[data-slot="accordion-trigger"]', "color"),
      brandFill: read('[data-testid="beta-invite-cta"]', "background-color"),
      brandFillInk: read('[data-testid="beta-invite-cta"]', "color"),
    };
  });
}

/**
 * Tokens the current pages do not yet paint (chrome band, hover, brand-soft,
 * brand-ink, faint ink, focus ring) still have to resolve, because Todos 4-7
 * compose with them. Rendering each through a throwaway element measures the
 * same cascade a component would, and returns a browser-normalised `rgb()`
 * instead of the authored hex — which Chromium rewrites (`#FFFFFF` -> `#fff`).
 */
async function readTokens(page: Page): Promise<Record<TokenName, string>> {
  return page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement("div"));
    const paint = (token: string): string => {
      probe.style.cssText = `position:absolute;visibility:hidden;background-color:var(${token})`;
      return getComputedStyle(probe).backgroundColor;
    };
    return {
      chrome: paint("--chrome"),
      hover: paint("--hover"),
      brandSoft: paint("--brand-soft"),
      brandInk: paint("--brand-ink"),
      inkFaint: paint("--ink-faint"),
      focusRing: paint("--focus-ring"),
    };
  });
}

/**
 * The named marketing materials Todos 4-7 consume by class name. Measured on
 * throwaway elements because the composition that uses them does not exist
 * yet — a missing or misspelled utility has to fail here, not silently produce
 * a flat hero three todos later.
 */
async function readMaterials(page: Page): Promise<MaterialReport> {
  return page.evaluate(() => {
    const mount = (className: string): HTMLElement => {
      const el = document.createElement("div");
      el.className = className;
      return document.body.appendChild(el);
    };
    const css = (className: string): CSSStyleDeclaration =>
      getComputedStyle(mount(className));

    const rule = css("mkt-rule");
    const asym = css("mkt-asym-hero");
    const ambient = mount("mkt-ambient-light");
    return {
      ruleWidth: rule.borderTopWidth,
      ruleColor: rule.borderTopColor,
      ruleLength: rule.width,
      measureLead: css("mkt-measure-lead").maxWidth,
      measureProse: css("mkt-measure-prose").maxWidth,
      asymDisplay: asym.display,
      asymColumnCount: asym.gridTemplateColumns.split(" ").length,
      heroOverlap: css("mkt-hero-overlap").marginBottom,
      overlapClear: css("mkt-overlap-clear").paddingTop,
      ambientPosition: getComputedStyle(ambient).position,
      ambientOpacity: getComputedStyle(ambient, "::before").opacity,
      frameShadow: css("mkt-product-frame").boxShadow,
    };
  });
}

test.describe("Warm Editorial light palette", () => {
  test("paints the page, cards, and shared primitives with the marketing contract", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await settleHydration(page);

    const surfaces = await readSurfaces(page);
    expect(surfaces.htmlClass).not.toContain("dark");
    expect(surfaces).toMatchObject({
      bodyBackground: WARM.bg,
      bodyInk: WARM.ink,
      cardBackground: WARM.card,
      cardBorder: WARM.line,
      cardInkDim: WARM.inkDim,
      accordionBorder: WARM.line,
      accordionInk: WARM.ink,
      brandFill: WARM.brand,
      brandFillInk: WARM.brandOn,
    });

    // The FAQ band shares the feature section's tinted surface rather than the
    // plain page paper, so the two editorial bands must resolve identically and
    // must not collapse back to the body background.
    expect(surfaces.pageSection).toBe(surfaces.featureBand);
    expect(surfaces.pageSection).not.toBe(WARM.bg);

    // The one bounded shadow exception is ProductFrame imagery. An ordinary
    // marketing card stays hairline-only, warm palette or not.
    expect(surfaces.cardShadow).toBe("none");
    // The responsive header contract is a separate token family this task must
    // not disturb while rewriting colour.
    expect(surfaces.headerBarHeight).toBe(expectedHeaderHeight(viewportWidth(page)));

    expect(await readTokens(page)).toEqual({
      chrome: WARM.chrome,
      hover: WARM.hover,
      brandSoft: WARM.brandSoft,
      brandInk: WARM.brandInk,
      inkFaint: WARM.inkFaint,
      focusRing: WARM.focusRing,
    });
  });

  test("resolves the Warm Editorial palette inside the shared Button primitive", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await settleHydration(page);

    // Which shared variant renders is the download feature's decision, not
    // this spec's: desktop resolves to a real OS binary and gets the primary
    // fill, a phone gets the outline "email me a link" pair. Both are the same
    // `@nixus/shared` Button, so both are valid proof that the override reaches
    // shared primitives — asserting only the desktop one would leave the phone
    // project asserting nothing.
    const primary = isDesktopTier(page);
    const button = page
      .locator("#main-content")
      .getByTestId(primary ? "download-cta-primary" : "download-cta-mobile-copy")
      .first();
    await expect(button).toBeVisible();

    const painted = await button.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        slot: el.getAttribute("data-slot"),
        backgroundColor: style.backgroundColor,
        color: style.color,
        borderColor: style.borderTopColor,
      };
    });

    expect(painted).toEqual({
      slot: "button",
      backgroundColor: primary ? WARM.brand : WARM.card,
      color: primary ? WARM.brandOn : WARM.ink,
      borderColor: primary ? WARM.brand : WARM.lineStrong,
    });
  });

  test("registers the named marketing materials with their contract values", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");

    const materials = await readMaterials(page);
    expect(materials).toMatchObject({
      ruleWidth: "2px",
      ruleColor: WARM.ink,
      ruleLength: "40px",
      measureLead: "544px",
      measureProse: "704px",
      asymDisplay: "grid",
      ambientPosition: "relative",
      frameShadow: FRAME_SHADOW,
    });

    // Asymmetry is a marketing hero/showcase exception, so the two-column
    // grammar only exists on the desktop tier; below it the composition stacks.
    expect(materials.asymColumnCount).toBe(isDesktopTier(page) ? 2 : 1);
    // The overlap pulls the visual past the hero edge, and the next section has
    // to reserve at least that much room or the two collide.
    const overlap = Number.parseFloat(materials.heroOverlap);
    expect(overlap).toBeLessThan(0);
    expect(Number.parseFloat(materials.overlapClear)).toBeGreaterThanOrEqual(-overlap);
    // Light mode only: the ambient logo light is a glow behind a hero visual.
    expect(Number.parseFloat(materials.ambientOpacity)).toBeGreaterThan(0);
    expect(Number.parseFloat(materials.ambientOpacity)).toBeLessThan(0.5);
  });
});

test.describe("dark mode keeps Quiet Ledger", () => {
  test("resolves none of the Warm Editorial light values", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await settleHydration(page);

    const surfaces = await readSurfaces(page);
    expect(surfaces.htmlClass).toContain("dark");

    // Not "differs from light" by accident — these are the shared token values,
    // so a stray `.dark` edit in the web layer fails here too.
    expect(surfaces).toMatchObject({
      bodyBackground: QUIET_LEDGER_DARK.bg,
      bodyInk: QUIET_LEDGER_DARK.ink,
      pageSection: QUIET_LEDGER_DARK.bg,
      cardBackground: QUIET_LEDGER_DARK.card,
      cardBorder: QUIET_LEDGER_DARK.line,
      accordionBorder: QUIET_LEDGER_DARK.line,
    });
    expect(surfaces.bodyBackground).not.toBe(WARM.bg);
    expect(surfaces.cardBackground).not.toBe(WARM.card);
    expect(surfaces.accordionInk).not.toBe(WARM.ink);
    expect(surfaces.brandFill).not.toBe(WARM.brand);

    // Focus and contrast survive the mode: the ring still resolves to an opaque
    // colour, and it is not the light ring.
    const tokens = await readTokens(page);
    expect(tokens.focusRing).not.toBe(WARM.focusRing);
    expect(tokens.focusRing).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(tokens.chrome).not.toBe(WARM.chrome);
    expect(tokens.brandSoft).not.toBe(WARM.brandSoft);

    // The ambient logo light is a light-mode-only exception; in dark it must
    // not paint at all.
    expect((await readMaterials(page)).ambientOpacity).toBe("0");
  });
});
