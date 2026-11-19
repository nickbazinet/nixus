import { expect, test } from "@playwright/test";

import {
  STUB_PLAN_CATALOG,
  captureConsole,
  isDesktopTier,
  scope,
  stubPlanCatalog,
} from "./support/site";

/**
 * The pricing page's own gate, on top of the site-wide layout and console
 * gates `responsive.spec.ts` and `dev-console.spec.ts` already apply to it.
 *
 * It runs on every viewport project, because the thing most likely to break
 * here is the width-dependent half: four columns that have to degrade to two
 * and then to one, and a comparison matrix that swaps to a per-card list below
 * the desktop tier. Each width asserts the shape it is supposed to have rather
 * than a shape that happens to be true at one of them.
 */

const PLANS = ["local", "cloudFree", "classic", "advance"] as const;

/** Baked and live figures per locale. `\s` covers the narrow no-break space fr-CA groups with. */
const FIGURE = {
  "/pricing": {
    bakedClassic: "$9.99 CAD",
    bakedAdvance: "$19.99 CAD",
    liveClassic: "$10.99 CAD",
    liveAdvance: "$21.99 CAD",
  },
  "/fr/pricing": {
    bakedClassic: /^9,99\s\$\sCAD$/u,
    bakedAdvance: /^19,99\s\$\sCAD$/u,
    liveClassic: /^10,99\s\$\sCAD$/u,
    liveAdvance: /^21,99\s\$\sCAD$/u,
  },
} as const;

function amount(page: import("@playwright/test").Page, plan: string) {
  return page.locator(`[data-testid="pricing-amount"][data-plan="${plan}"]`);
}

for (const route of ["/pricing", "/fr/pricing"] as const) {
  test.describe(route, () => {
    test("renders all four plan columns", async ({ page }, testInfo) => {
      await stubPlanCatalog(page);
      await page.goto(route);

      const plans = page.locator('[data-testid="pricing-plan"]');
      await expect(plans, scope(testInfo, route)).toHaveCount(4);
      for (const plan of PLANS) {
        await expect(
          page.locator(`[data-testid="pricing-plan"][data-plan="${plan}"]`),
        ).toBeVisible();
      }
    });

    test("marks exactly one column recommended, in words as well as tint", async ({
      page,
    }) => {
      await stubPlanCatalog(page);
      await page.goto(route);

      const badge = page.locator('[data-testid="pricing-recommended"]');
      await expect(badge).toHaveCount(1);
      await expect(badge).toBeVisible();
      await expect(
        page.locator('[data-testid="pricing-plan"][data-recommended="true"]'),
      ).toHaveAttribute("data-plan", "advance");
    });

    /* The page is prerendered, so the amounts have to be in the HTML before any
     * script runs. Scripts disabled is the only way to assert that rather than
     * assert a fast hydration. */
    test("serves the baked prices with JavaScript disabled", async ({ browser }) => {
      const context = await browser.newContext({ javaScriptEnabled: false });
      try {
        const page = await context.newPage();
        await page.goto(`${test.info().project.use.baseURL ?? ""}${route}`);

        await expect(amount(page, "classic")).toHaveText(FIGURE[route].bakedClassic);
        await expect(amount(page, "advance")).toHaveText(FIGURE[route].bakedAdvance);
        await expect(
          page.locator('[data-testid="pricing-plan"]'),
        ).toHaveCount(4);
      } finally {
        await context.close();
      }
    });

    test("replaces the baked amounts with the live catalog after hydration", async ({
      page,
    }) => {
      await stubPlanCatalog(page);
      await page.goto(route);

      await expect(amount(page, "classic")).toHaveText(FIGURE[route].liveClassic);
      await expect(amount(page, "advance")).toHaveText(FIGURE[route].liveAdvance);
    });

    /* An unreachable catalog is the common case for an offline visitor and for
     * any API incident. It has to be invisible: baked prices stay, and nothing
     * reaches the console — which `captureConsole` enforces with no allowlist,
     * including the failed request itself. */
    test("keeps the baked prices and a silent console when the catalog fails", async ({
      page,
    }, testInfo) => {
      const devtools = captureConsole(page);
      await stubPlanCatalog(page, null);
      await page.goto(route);
      await page.waitForLoadState("networkidle");

      await expect(amount(page, "classic")).toHaveText(FIGURE[route].bakedClassic);
      await expect(amount(page, "advance")).toHaveText(FIGURE[route].bakedAdvance);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByRole("progressbar")).toHaveCount(0);
      await expect(page.getByRole("status")).toHaveCount(0);

      // Chromium logs its own "Failed to load resource" line for any non-2xx
      // response; no application can suppress that. What this asserts is that
      // the page adds nothing of its own to it — no error, no warning, no
      // diagnostic. That the client itself writes to no console channel on any
      // failure path is proven exhaustively in `src/lib/planCatalog.test.ts`.
      const browserNetworkLog = /Failed to load resource|v1\/billing\/plans/;
      expect(
        devtools.messages.filter((message) => !browserNetworkLog.test(message)),
        `${scope(testInfo, route)}: console`,
      ).toEqual([]);
    });

    test("reserves the figure's box so the live amount shifts nothing", async ({
      page,
    }) => {
      await stubPlanCatalog(page, STUB_PLAN_CATALOG, 1500);
      await page.goto(route);

      // Settle everything that moves for its own reasons first: the download
      // CTA re-renders once OS detection resolves, which is a shape change the
      // price swap must not be blamed for.
      await expect(amount(page, "classic")).toHaveText(FIGURE[route].bakedClassic);
      await page
        .locator('[data-testid="pricing-plan"] [data-testid="download-cta"][data-os]')
        .waitFor();
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
      );

      // Offsets within the swapped card, never absolute positions. A longer or
      // shorter amount can only move things inside its own card, and absolute
      // coordinates also track the Local card's download CTA re-rendering when
      // OS detection resolves — which stacks above this card on a phone and
      // stretches the grid row on a desktop, and is nothing to do with price.
      const card = page.locator('[data-testid="pricing-plan"][data-plan="classic"]');
      const figure = amount(page, "classic");
      const interval = card.locator('[data-testid="pricing-interval"]');
      const highlight = card.locator('[data-testid="pricing-highlight"]');

      const band = async () => {
        const origin = await card.boundingBox();
        const offset = async (target: typeof figure) => {
          const box = await target.boundingBox();
          return Math.round((box?.y ?? 0) - (origin?.y ?? 0));
        };
        return {
          figureHeight: Math.round((await figure.boundingBox())?.height ?? 0),
          figureTop: await offset(figure),
          intervalTop: await offset(interval),
          highlightTop: await offset(highlight),
        };
      };

      const before = await band();
      await expect(figure).toHaveText(FIGURE[route].liveClassic);

      expect(await band()).toEqual(before);
    });

    /* One row set, two presentations. Rendering both at one width would read the
     * same matrix twice to a screen reader, so exactly one has to be live. */
    test("shows the matrix on desktop and the per-card lists below it", async ({
      page,
    }, testInfo) => {
      await stubPlanCatalog(page);
      await page.goto(route);

      const matrix = page.locator('[data-testid="pricing-compare-table"]');
      const cardLists = page.getByRole("list", {
        name: /What this plan includes|Ce que comprend ce forfait/,
      });
      const where = scope(testInfo, route);

      if (isDesktopTier(page)) {
        await expect(matrix, where).toBeVisible();
        await expect(cardLists, where).toHaveCount(0);
      } else {
        await expect(matrix, where).toBeHidden();
        await expect(cardLists, where).toHaveCount(4);
      }
    });

    test("states every matrix answer as text, not only as a glyph", async ({
      page,
    }) => {
      test.skip(!isDesktopTier(page), "the matrix is a desktop-tier presentation");
      await stubPlanCatalog(page);
      await page.goto(route);

      const cells = page.locator('[data-testid="pricing-compare-table"] tbody td');
      await expect(cells).toHaveCount(8 * 4);
      for (const text of await cells.allInnerTexts()) {
        expect(text.trim()).toMatch(/^(Included|Not included|Inclus|Non inclus)$/);
      }
    });

    test("sends each paid column to the account app by lookup key", async ({
      page,
    }) => {
      await stubPlanCatalog(page);
      await page.goto(route);

      const prefix = route.startsWith("/fr")
        ? "https://account.nixusapp.com/fr"
        : "https://account.nixusapp.com";

      for (const entry of STUB_PLAN_CATALOG.plans) {
        const plan = entry.lookup_key.startsWith("classic") ? "classic" : "advance";
        await expect(
          page.locator(`[data-testid="pricing-cta"][data-plan="${plan}"]`),
        ).toHaveAttribute("href", `${prefix}/billing?plan=${entry.lookup_key}`);
      }
      await expect(
        page.locator('[data-testid="pricing-cta"][data-plan="cloudFree"]'),
      ).toHaveAttribute("href", prefix);
    });

    /* AD-8: commerce UI is Stripe-hosted on every surface. This page links out
     * and must never grow a card field or an embedded Checkout frame. */
    test("renders no payment surface of its own", async ({ page }) => {
      await stubPlanCatalog(page);
      await page.goto(route);

      const main = page.locator("#main-content");
      await expect(main.locator("iframe")).toHaveCount(0);
      await expect(main.locator("input")).toHaveCount(0);
      await expect(main.locator("form")).toHaveCount(0);
    });

    test("states the tax and currency footnote without saying taxes are extra", async ({
      page,
    }) => {
      await stubPlanCatalog(page);
      await page.goto(route);

      const footnote = page.locator('[data-testid="pricing-footnote"]');
      await expect(footnote).toBeVisible();
      await expect(footnote).toContainText(
        route.startsWith("/fr") ? /dollars canadiens/i : /Canadian dollars/i,
      );
      await expect(footnote).toContainText(
        route.startsWith("/fr") ? /taxe est comprise/i : /[Tt]ax is included/,
      );

      const body = (await page.locator("body").innerText()).toLowerCase();
      for (const phrase of [
        "taxes extra",
        "plus tax",
        "+ tax",
        "taxes en sus",
        "plus taxes",
      ]) {
        expect(body, `page says "${phrase}"`).not.toContain(phrase);
      }
    });

    test("keeps one h1 and a real heading order", async ({ page }) => {
      await stubPlanCatalog(page);
      await page.goto(route);

      await expect(page.locator("#main-content h1")).toHaveCount(1);
      await expect(
        page.locator('#main-content h2[id^="pricing-plan-"]'),
      ).toHaveCount(4);
      // An `sr-only` heading reads as a clipped heading to the site-wide layout
      // gate, so this page must name its regions without one.
      await expect(page.locator("#main-content h1.sr-only, #main-content h2.sr-only, #main-content h3.sr-only")).toHaveCount(0);
    });
  });
}

test.describe("chrome reaches the pricing page", () => {
  test("the footer links there in both locales", async ({ page }) => {
    await stubPlanCatalog(page);

    await page.goto("/");
    await expect(
      page.getByRole("navigation", { name: /^product$/i }).getByRole("link", {
        name: /^Pricing$/,
      }),
    ).toHaveAttribute("href", "/pricing");

    await page.goto("/fr/");
    await expect(
      page.getByRole("navigation", { name: /^produit$/i }).getByRole("link", {
        name: /^Tarifs$/,
      }),
    ).toHaveAttribute("href", "/fr/pricing");
  });

  test("the desktop nav links there and marks the current page", async ({ page }) => {
    test.skip(!isDesktopTier(page), "the nav group is a desktop-tier composition");
    await stubPlanCatalog(page);

    await page.goto("/pricing");
    const link = page.locator('[data-testid="header-pricing-link"]');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("aria-current", "page");

    await page.goto("/");
    await expect(
      page.locator('[data-testid="header-pricing-link"]'),
    ).not.toHaveAttribute("aria-current", "page");
  });
});
