import { expect, test, type Page } from "@playwright/test";

import {
  captureConsole,
  expectedHeaderHeight,
  headerReport,
  viewportWidth,
} from "./support/site";

/**
 * Shared web chrome and its one notice surface, verified as *rendered*.
 *
 * `warm-editorial.spec.ts` proves the marketing light palette reaches the page,
 * cards and shared primitives. It deliberately reads nothing off the pre-alpha
 * notice or the header wordmark, so those two were the last unguarded colour
 * decisions in the chrome — which is exactly how the notice kept a raw `amber-*`
 * scale that followed neither the warm light palette nor dark mode.
 *
 * Colour is asserted as a resolved `rgb()`, never as a class name: a class
 * assertion passes while the token behind it is wrong.
 */

/**
 * The status family from `packages/shared/src/styles/tokens.css`. Warm Editorial
 * scopes its `:root:not(.dark)` override to surface/ink/brand and deliberately
 * never redeclares `--caution*` — DESIGN.md keeps the status-colour family
 * load-bearing on marketing routes too. So these values are identical in the
 * desktop app, and the same in both modes' respective blocks.
 */
const CAUTION = {
  light: { accent: "rgb(161, 98, 7)", bg: "rgb(251, 242, 222)", ink: "rgb(131, 79, 6)" },
  dark: { accent: "rgb(251, 191, 36)", bg: "rgb(51, 41, 15)", ink: "rgb(252, 211, 77)" },
} as const;

/**
 * `--logo-stop-2` and `--logo-stop-3`: the Nixus identity gradient. Declared in
 * `:root` with no dark override because identity is mode-independent, which is
 * why the wordmark is not a palette decision this task may touch.
 */
const LOGO_GRADIENT_STOPS = ["rgb(167, 139, 250)", "rgb(244, 114, 182)"] as const;

const DISMISS_KEY = "nixus.preAlphaDismissed";

type NoticeReport = {
  background: string;
  ink: string;
  borderBottom: string;
  iconInk: string;
  linkInk: string;
};

async function readNotice(page: Page): Promise<NoticeReport> {
  return page.evaluate(() => {
    const banner = document.querySelector("[data-pre-alpha-banner]");
    if (!banner) throw new Error("pre-alpha banner not rendered");
    const style = getComputedStyle(banner);
    const icon = banner.querySelector("svg");
    const link = banner.querySelector("a");
    return {
      background: style.backgroundColor,
      ink: style.color,
      borderBottom: style.borderBottomColor,
      iconInk: icon ? getComputedStyle(icon).color : "MISSING icon",
      linkInk: link ? getComputedStyle(link).color : "MISSING link",
    };
  });
}

/**
 * Chromium serialises an alpha-modified token as `oklab(...)`, not `rgba(...)`,
 * because Tailwind v4 emits `color-mix(in oklab, ...)` for `/25`. So the hairline
 * cannot be compared to a flat hex token. What matters is that it is a real,
 * caution-tinted line and not the previous raw amber — asserted as "an opaque
 * enough colour, distinct from both the surface and the ink it separates".
 */
function expectTintedHairline(report: NoticeReport): void {
  expect(report.borderBottom).toMatch(/^(?:rgba?|oklab|oklch|color-mix)\(/);
  expect(report.borderBottom).not.toBe("rgba(0, 0, 0, 0)");
  expect(report.borderBottom).not.toBe(report.background);
  expect(report.borderBottom).not.toBe(report.ink);
}

/**
 * Paint a throwaway element with `expression` and return Chromium's serialised
 * colour, so an expectation is written in the same colour space the browser
 * reports instead of a hand-converted literal.
 */
async function paintedColour(page: Page, expression: string): Promise<string> {
  return page.evaluate((value) => {
    const probe = document.body.appendChild(document.createElement("div"));
    probe.style.cssText = `position:absolute;visibility:hidden;background-color:${value}`;
    const painted = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return painted;
  }, expression);
}

/**
 * The prerendered download CTA swaps variant on mount, so it is the barrier that
 * proves React has attached. Clicking the dismiss button before this lands hits
 * inert prerendered markup and the banner never unmounts — a race that resolves
 * purely on asset-transfer timing.
 */
async function settleHydration(page: Page): Promise<void> {
  const cta = page.locator("#main-content").getByTestId("download-cta").first();
  await expect(cta).not.toHaveAttribute("data-os", "choose");
}

test.describe("pre-alpha notice resolves the semantic caution family", () => {
  test("paints the warm light caution surface, not a raw amber scale", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");

    const notice = await readNotice(page);
    expect(notice.background).toBe(CAUTION.light.bg);
    expect(notice.ink).toBe(CAUTION.light.ink);
    // The icon and the inline link inherit rather than carrying their own hue.
    expect(notice.iconInk).toBe(CAUTION.light.ink);
    expect(notice.linkInk).toBe(CAUTION.light.ink);
    expectTintedHairline(notice);
  });

  test("follows dark mode through the same aliases, with no hand-written override", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.className))
      .toContain("dark");

    const notice = await readNotice(page);
    expect(notice.background).toBe(CAUTION.dark.bg);
    expect(notice.ink).toBe(CAUTION.dark.ink);
    expect(notice.iconInk).toBe(CAUTION.dark.ink);
    expectTintedHairline(notice);

    // The mode actually moved. Without this the test above would also pass on a
    // surface that ignored `.dark` entirely.
    expect(notice.background).not.toBe(CAUTION.light.bg);
    expect(notice.ink).not.toBe(CAUTION.light.ink);
  });

  test("focuses its controls with the one global focus ring", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await settleHydration(page);

    const dismiss = page.getByTestId("pre-alpha-banner").getByRole("button");
    await dismiss.focus();

    const ring = await dismiss.evaluate((el) => getComputedStyle(el).boxShadow);

    /* `ring-ring/50` compiles to a 50% mix of `{marketing-colors.focus-ring}`,
     * so the expectation is derived by painting that same expression rather than
     * hand-converting oklab. The caution mix is asserted absent in the same
     * breath: a per-surface notice ring is what this task removes. */
    const expected = await paintedColour(
      page,
      "color-mix(in oklab, var(--focus-ring) 50%, transparent)",
    );
    const cautionRing = await paintedColour(
      page,
      "color-mix(in oklab, var(--caution) 40%, transparent)",
    );

    expect(ring).toContain(expected);
    expect(ring).not.toContain(cautionRing);
  });

  test("keeps the caution accent available for the hairline tint in both modes", async ({
    page,
  }) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      const accent = await page.evaluate(() => {
        const probe = document.body.appendChild(document.createElement("div"));
        probe.style.cssText =
          "position:absolute;visibility:hidden;background-color:var(--caution)";
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
      });
      expect(accent, `--caution in ${scheme}`).toBe(CAUTION[scheme].accent);
    }
  });
});

test.describe("chrome survives the notice being dismissed", () => {
  /**
   * The failure path the plan calls out: a returning visitor whose dismissal is
   * already persisted. `__root.tsx`'s pre-hydration script sets
   * `data-pre-alpha-dismissed` before React mounts and CSS hides the band, so
   * this is a genuinely different first paint — the header becomes the first
   * thing in the document — and it is the state most real visitors are in.
   */
  test("hides the band and leaves header geometry and console untouched", async ({
    page,
  }) => {
    const devtools = captureConsole(page);
    await page.addInitScript(
      ([key]) => window.localStorage.setItem(key as string, "1"),
      [DISMISS_KEY],
    );
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("pre-alpha-banner")).toBeHidden();
    expect(await headerReport(page)).toEqual({
      height: expectedHeaderHeight(viewportWidth(page)),
      escaping: [],
      overlapsFirstContent: false,
    });
    expect(devtools.messages).toEqual([]);
  });

  test("keeps header geometry after scrolling with the notice dismissed", async ({
    page,
  }) => {
    await page.addInitScript(
      ([key]) => window.localStorage.setItem(key as string, "1"),
      [DISMISS_KEY],
    );
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    // The scrolled header swaps a transparent border for `border-border` plus a
    // backdrop blur; give the rAF-throttled listener a frame before measuring.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
    );

    const report = await headerReport(page);
    expect(report.escaping).toEqual([]);
    expect(report.height).toBe(expectedHeaderHeight(viewportWidth(page)));
  });

  test("dismissing live removes the band without disturbing the header", async ({
    page,
  }) => {
    await page.goto("/");
    const banner = page.getByTestId("pre-alpha-banner");
    await expect(banner).toBeVisible();
    await settleHydration(page);

    await banner.getByRole("button").click();
    await expect(banner).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate((key) => window.localStorage.getItem(key), DISMISS_KEY),
      )
      .toBe("1");

    expect(await headerReport(page)).toEqual({
      height: expectedHeaderHeight(viewportWidth(page)),
      escaping: [],
      overlapsFirstContent: false,
    });
  });
});

test.describe("header identity and destinations are preserved", () => {
  test("renders the Nixus wordmark gradient from the identity stops", async ({
    page,
  }) => {
    await page.goto("/");

    const painted = await page.evaluate((stops) => {
      const gradient = Array.from(
        document.querySelectorAll("header span"),
      ).find((el) => getComputedStyle(el).backgroundImage.includes("gradient"));
      const image = gradient ? getComputedStyle(gradient).backgroundImage : "none";
      return { image, missing: stops.filter((stop) => !image.includes(stop)) };
    }, LOGO_GRADIENT_STOPS as unknown as string[]);

    expect(painted.missing, `wordmark gradient: ${painted.image}`).toEqual([]);
  });

  test("keeps the Founding destination in chrome at every viewport", async ({
    page,
  }) => {
    await page.goto("/");
    const founding = page.getByTestId("header-beta-link");
    await expect(founding).toBeVisible();
    await expect(founding).toHaveText("Founding");
    await expect(founding).toHaveAttribute("href", "/beta");
  });

  test("resolves the scrolled sticky surface from tokens, not a raw palette", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    // The scroll listener is attached on mount, so an unhydrated page keeps the
    // transparent at-rest surface no matter how far the window scrolls.
    await settleHydration(page);

    const readChrome = () =>
      page.evaluate(() => {
        const header = document.querySelector("header");
        if (!header) throw new Error("header not rendered");
        const style = getComputedStyle(header);
        return {
          position: style.position,
          background: style.backgroundColor,
          borderBottom: style.borderBottomColor,
        };
      });

    /* `bg-background/85` and `border-border`, which alias `--bg` and `--line`.
     * Both are Warm Editorial values, so a stale cool `#E2E8F0` hairline or a
     * slate surface fails here. The surface expectation is painted rather than
     * written as `rgba(...)` because Tailwind's `/85` compiles to `color-mix`,
     * which Chromium serialises as `oklab(...)`. Polling to the settled value
     * rather than sampling once is what makes the 200ms scrolled fade a
     * non-issue — a single read lands mid-transition at a partial alpha. */
    const scrolledSurface = await paintedColour(
      page,
      "color-mix(in oklab, var(--bg) 85%, transparent)",
    );
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(async () => (await readChrome()).background).toBe(scrolledSurface);

    const chrome = await readChrome();
    expect(chrome.position).toBe("sticky");
    expect(chrome.borderBottom).toBe("rgb(232, 227, 218)");
  });
});
