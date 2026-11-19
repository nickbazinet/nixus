import type { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "next-themes";
import { renderToString } from "react-dom/server";
import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import i18n from "@/lib/i18n";
import { renderWithProviders } from "@/lib/test-utils";
import {
  hydrationMismatches,
  renderAndHydrate,
} from "@/lib/hydration-test-utils";
import { PRICING_COLUMNS, PRICING_FEATURE_ROWS } from "@/content/pricing";
import type { Locale } from "@/lib/site";

import { PricingPage } from "./PricingPage";

/*
 * The pricing page is a revenue surface with two release gates on it (AD-16):
 * the price a visitor is shown has to be the one checkout charges, and the tax
 * and currency wording has to be true the day the first charge lands. Both are
 * asserted here rather than reviewed, along with the thing that makes the first
 * one possible — baked copy that is complete before any network call, and live
 * amounts that replace it afterwards without the page changing shape.
 */

const LIVE_CATALOG = {
  plans: [
    {
      tier: "classic",
      lookup_key: "classic_monthly_cad",
      unit_amount_cents: 1099,
      currency: "CAD",
      interval: "month",
      display_order: 1,
      capabilities: ["household_net_worth", "multi_device_sync"],
      monthly_request_limit: null,
    },
    {
      tier: "advance",
      lookup_key: "advance_monthly_cad",
      unit_amount_cents: 2199,
      currency: "CAD",
      interval: "month",
      display_order: 2,
      capabilities: ["hosted_ai", "household_net_worth", "multi_device_sync"],
      monthly_request_limit: 500,
    },
  ],
  cache_ttl_seconds: 300,
};

function providers(children: ReactElement): ReactElement {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        {children}
      </ThemeProvider>
    </I18nextProvider>
  );
}

/** Resolve with `payload`, or reject when it is `null`. */
function stubCatalog(payload: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn(() =>
    payload === null
      ? Promise.reject(new TypeError("Failed to fetch"))
      : Promise.resolve(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

function amountOf(plan: string): string {
  return (
    document
      .querySelector(`[data-testid="pricing-amount"][data-plan="${plan}"]`)
      ?.textContent?.trim() ?? ""
  );
}

function ctaHref(plan: string): string {
  return (
    document
      .querySelector(`[data-testid="pricing-cta"][data-plan="${plan}"]`)
      ?.getAttribute("href") ?? ""
  );
}

/**
 * The components read the i18n singleton, so French assertions need the
 * language actually switched. Restored in a `finally` inside `act`, because the
 * French tree is still mounted when the language goes back.
 */
async function withFrench(run: () => void | Promise<void>): Promise<void> {
  await act(async () => {
    await i18n.changeLanguage("fr");
  });
  try {
    await run();
  } finally {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  }
}

/** Mount and let the catalog effect settle, so no update lands outside `act`. */
async function renderPricing(locale: Locale = "en"): Promise<void> {
  renderWithProviders(<PricingPage locale={locale} />);
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  // Every test owns its catalog. An unstubbed `fetch` would reach the real
  // billing API from a unit test, which is both slow and non-deterministic.
  stubCatalog(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the four columns", () => {
  it("renders Local, Nixus Cloud Free, Classic and Advance in that order", async () => {
    await renderPricing("en");

    const plans = screen.getAllByTestId("pricing-plan");
    expect(plans.map((plan) => plan.dataset.plan)).toEqual([
      "local",
      "cloudFree",
      "classic",
      "advance",
    ]);

    for (const name of ["Local", "Nixus Cloud Free", "Classic", "Advance"]) {
      expect(
        screen.getByRole("heading", { level: 2, name }),
        `${name} column heading`,
      ).toBeInTheDocument();
    }
  });

  it("renders all four in French, with Nixus Cloud left untranslated", async () => {
    await withFrench(async () => {
      await renderPricing("fr");

      expect(screen.getAllByTestId("pricing-plan")).toHaveLength(4);
      expect(
        screen.getByRole("heading", { level: 2, name: "Nixus Cloud Free" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Comparez les quatre forfaits" }),
      ).toBeInTheDocument();
    });
  });

  it("marks only Advance as recommended, and marks it with words", async () => {
    await renderPricing("en");

    const badges = screen.getAllByTestId("pricing-recommended");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent("Recommended");
    expect(badges[0].closest("[data-plan]")?.getAttribute("data-plan")).toBe("advance");

    const recommended = screen
      .getAllByTestId("pricing-plan")
      .filter((plan) => plan.dataset.recommended === "true");
    expect(recommended).toHaveLength(1);
  });

  it("states every comparison row for every column with a text alternative", async () => {
    await renderPricing("en");

    const table = screen.getByTestId("pricing-compare-table");
    const marks = table.querySelectorAll(".sr-only");
    // One per body cell, plus the table's own caption.
    expect(marks.length).toBe(PRICING_FEATURE_ROWS.length * PRICING_COLUMNS.length + 1);

    for (const row of PRICING_FEATURE_ROWS) {
      const cells = table.querySelectorAll(`[data-row="${row.id}"] td`);
      expect(cells, `row ${row.id}`).toHaveLength(PRICING_COLUMNS.length);
      for (const cell of cells) {
        expect(cell.textContent, `row ${row.id} cell`).toMatch(
          /^(Included|Not included)$/,
        );
      }
    }
  });
});

describe("baked prices are what gets prerendered", () => {
  /* The page is prerendered with `crawlLinks`, so a prerender-time network call
   * would make the build depend on a live API. The fetch is reached only from
   * an effect, which `renderToString` does not run — this is that proof. */
  it("renders the complete baked prices server-side with no network call", () => {
    const fetchMock = stubCatalog(LIVE_CATALOG);

    const html = renderToString(providers(<PricingPage locale="en" />));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(html).toContain("$9.99 CAD");
    expect(html).toContain("$19.99 CAD");
    expect(html).toContain("per month");
    expect(html).toContain("Free");
    expect(html).toContain("Prices are listed in Canadian dollars");
  });

  it("renders the complete baked French prices server-side", async () => {
    await withFrench(() => {
      const html = renderToString(providers(<PricingPage locale="fr" />));

      expect(html).toMatch(/9,99\s\$\sCAD/u);
      expect(html).toMatch(/19,99\s\$\sCAD/u);
      expect(html).toContain("par mois");
      expect(html).toContain("Les prix sont affich");
    });
  });

  it("hydrates the server markup with no React diagnostic", async () => {
    stubCatalog(LIVE_CATALOG);

    const result = await renderAndHydrate(<PricingPage locale="en" />, providers);

    expect(hydrationMismatches(result)).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.ssrHtml).toContain("$9.99 CAD");
  });

  it("shows the baked amounts with no live catalog at all", async () => {
    await renderPricing("en");

    expect(amountOf("classic")).toBe("$9.99 CAD");
    expect(amountOf("advance")).toBe("$19.99 CAD");
    expect(amountOf("local")).toBe("Free");
    expect(amountOf("cloudFree")).toBe("$0");
  });

  /* Reserving the figure's line is the whole no-layout-shift mechanism: the
   * baked and the live amount render into the same box, so replacing one with
   * the other cannot move anything below it. */
  it("reserves the figure's line height so a live amount moves nothing", async () => {
    await renderPricing("en");

    for (const column of PRICING_COLUMNS) {
      const figure = document.querySelector(
        `[data-testid="pricing-amount"][data-plan="${column.id}"]`,
      );
      expect(figure, column.id).toHaveClass("min-h-11", "tabular-nums");
    }
    for (const interval of screen.getAllByTestId("pricing-interval")) {
      expect(interval).toHaveClass("min-h-5");
    }
  });
});

describe("the live catalog hydrates over the baked copy", () => {
  it("replaces the amount of each Stripe-backed column", async () => {
    stubCatalog(LIVE_CATALOG);

    renderWithProviders(<PricingPage locale="en" />);

    await waitFor(() => {
      expect(amountOf("classic")).toBe("$10.99 CAD");
    });
    expect(amountOf("advance")).toBe("$21.99 CAD");
  });

  it("leaves the two columns with no Stripe Price untouched", async () => {
    stubCatalog(LIVE_CATALOG);

    renderWithProviders(<PricingPage locale="en" />);

    await waitFor(() => {
      expect(amountOf("classic")).toBe("$10.99 CAD");
    });
    expect(amountOf("local")).toBe("Free");
    expect(amountOf("cloudFree")).toBe("$0");
  });

  it("formats the live amount in the active locale", async () => {
    await withFrench(async () => {
      stubCatalog(LIVE_CATALOG);

      renderWithProviders(<PricingPage locale="fr" />);

      await waitFor(() => {
        expect(amountOf("classic")).toMatch(/^10,99\s\$\sCAD$/u);
      });
    });
  });

  it("takes a live currency and interval when the catalog publishes them", async () => {
    stubCatalog({
      plans: [
        {
          ...LIVE_CATALOG.plans[0],
          unit_amount_cents: 9900,
          currency: "USD",
          interval: "year",
        },
      ],
      cache_ttl_seconds: 300,
    });

    renderWithProviders(<PricingPage locale="en" />);

    await waitFor(() => {
      expect(amountOf("classic")).toBe("$99.00 USD");
    });
    expect(
      screen.getAllByTestId("pricing-interval").map((node) => node.textContent),
    ).toContain("per year");
  });

  it("falls back per field, keeping a live amount beside a malformed interval", async () => {
    stubCatalog({
      plans: [
        {
          ...LIVE_CATALOG.plans[0],
          unit_amount_cents: 1099,
          currency: "not-a-currency",
          interval: "fortnight",
        },
      ],
      cache_ttl_seconds: 300,
    });

    renderWithProviders(<PricingPage locale="en" />);

    await waitFor(() => {
      expect(amountOf("classic")).toBe("$10.99 CAD");
    });
    expect(
      screen.getAllByTestId("pricing-interval").map((node) => node.textContent),
    ).not.toContain("per fortnight");
  });

  /* The columns are fixed; only the money is live. A key the page does not know
   * is inert — it must not become a fifth column and must not displace one. */
  it("ignores a lookup_key the page does not declare", async () => {
    stubCatalog({
      plans: [
        {
          tier: "privilege",
          lookup_key: "privilege_monthly_cad",
          unit_amount_cents: 4999,
          currency: "CAD",
          interval: "month",
          display_order: 3,
          capabilities: ["hosted_ai"],
          monthly_request_limit: null,
        },
      ],
      cache_ttl_seconds: 300,
    });

    renderWithProviders(<PricingPage locale="en" />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getAllByTestId("pricing-plan")).toHaveLength(4);
    expect(screen.queryByText(/privilege/i)).toBeNull();
    expect(amountOf("classic")).toBe("$9.99 CAD");
    expect(amountOf("advance")).toBe("$19.99 CAD");
  });
});

describe("a failing catalog is invisible to the visitor", () => {
  it.each([
    ["a refused request", null],
    ["an unusable body", { plans: "nope" }],
    ["an empty catalog", { plans: [], cache_ttl_seconds: 300 }],
  ])("keeps the baked prices on %s", async (_label, payload) => {
    stubCatalog(payload);

    renderWithProviders(<PricingPage locale="en" />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(amountOf("classic")).toBe("$9.99 CAD");
    expect(amountOf("advance")).toBe("$19.99 CAD");
  });

  it("writes nothing to the console and renders no error or spinner", async () => {
    const spies = (["error", "warn", "log", "debug", "info"] as const).map(
      (channel) => [channel, vi.spyOn(console, channel).mockImplementation(() => {})] as const,
    );
    stubCatalog(null);

    renderWithProviders(<PricingPage locale="en" />);
    await act(async () => {
      await Promise.resolve();
    });

    for (const [channel, spy] of spies) {
      expect(spy, `console.${channel}`).not.toHaveBeenCalled();
    }
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /loading|unavailable|try again|error/i,
    );
  });
});

describe("calls to action", () => {
  it("sends Local to the site's existing download affordance", async () => {
    await renderPricing("en");

    const local = screen.getAllByTestId("pricing-plan")[0];
    expect(local.dataset.plan).toBe("local");
    expect(local.querySelector('[data-testid="download-cta"]')).not.toBeNull();
    // Reused, not restated: the real per-OS anchors come with it.
    expect(local.querySelector('[data-testid="download-cta-macos"]')).not.toBeNull();
    expect(local.querySelector('[data-testid="download-cta-windows"]')).not.toBeNull();
    expect(ctaHref("local")).toBe("");
  });

  it("sends the free cloud column to the account app to sign in", async () => {
    await renderPricing("en");

    expect(ctaHref("cloudFree")).toBe("https://account.nixusapp.com");
  });

  /* A plan travels as its `lookup_key` and nothing else. A Stripe `price_id`
   * here would move price identity out of the Dashboard (AD-6), and the
   * checkout surface itself stays Stripe-hosted in the account app (AD-8). */
  it("sends each paid column to the account app with its lookup key", async () => {
    await renderPricing("en");

    expect(ctaHref("classic")).toBe(
      "https://account.nixusapp.com/billing?plan=classic_monthly_cad",
    );
    expect(ctaHref("advance")).toBe(
      "https://account.nixusapp.com/billing?plan=advance_monthly_cad",
    );
  });

  it("keeps every destination inside the visitor's locale", async () => {
    await withFrench(async () => {
      await renderPricing("fr");

      expect(ctaHref("cloudFree")).toBe("https://account.nixusapp.com/fr");
      expect(ctaHref("classic")).toBe(
        "https://account.nixusapp.com/fr/billing?plan=classic_monthly_cad",
      );
      expect(ctaHref("advance")).toBe(
        "https://account.nixusapp.com/fr/billing?plan=advance_monthly_cad",
      );

      const hrefs = screen
        .getAllByRole("link")
        .map((link) => link.getAttribute("href"));
      expect(hrefs).not.toContain("/terms");
      expect(hrefs).not.toContain("/privacy");
      expect(hrefs).toContain("/fr/terms");
      expect(hrefs).toContain("/fr/privacy");
    });
  });

  it("links to the English disclosures from the English page", async () => {
    await renderPricing("en");

    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/terms");
    expect(hrefs).toContain("/privacy");
  });

  /* AD-8 forbids a card field, Stripe Elements or embedded Checkout on any
   * surface. This page links out and renders no commerce UI of its own. */
  it("renders no payment input of any kind", async () => {
    const { container } = renderWithProviders(<PricingPage locale="en" />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.innerHTML).not.toMatch(/price_1|stripe\.js|elements/i);
  });
});

describe("pricing copy satisfies the AD-16 release gates", () => {
  const pricingKeys = Object.keys(en).filter((key) => key.startsWith("pricing."));

  it("defines the same pricing keys in both locales", () => {
    const frenchKeys = Object.keys(fr).filter((key) => key.startsWith("pricing."));

    expect(pricingKeys.length).toBeGreaterThan(0);
    expect(frenchKeys.sort()).toEqual(pricingKeys.slice().sort());
  });

  it("leaves no pricing string blank in either locale", () => {
    for (const key of pricingKeys) {
      expect(en[key as keyof typeof en]?.trim(), `en ${key}`).toBeTruthy();
      expect(fr[key as keyof typeof fr]?.trim(), `fr ${key}`).toBeTruthy();
    }
  });

  /* Plan names are proper nouns and are deliberately identical across locales;
   * everything else that reads as a sentence has to be actually translated, or
   * a French visitor is reading English marketing copy with nothing failing. */
  it("translates every pricing string that is not a plan name", () => {
    const sameInBoth = pricingKeys.filter(
      (key) => en[key as keyof typeof en] === fr[key as keyof typeof fr],
    );

    expect(sameInBoth).toEqual([
      "pricing.plan.local.name",
      "pricing.plan.cloudFree.name",
      "pricing.plan.classic.name",
      "pricing.plan.advance.name",
    ]);
  });

  it("keeps Nixus Cloud untranslated on every French pricing surface", () => {
    const mentions = pricingKeys.filter((key) =>
      en[key as keyof typeof en].includes("Nixus Cloud"),
    );

    expect(mentions.length).toBeGreaterThan(0);
    for (const key of mentions) {
      expect(fr[key as keyof typeof fr], `fr ${key}`).toContain("Nixus Cloud");
      expect(fr[key as keyof typeof fr], `fr ${key}`).not.toMatch(
        /nuage Nixus|infonuagique Nixus|Nixus Nuage/i,
      );
    }
  });

  /* Stripe is merchant of record and adds tax itself under Adaptive Pricing, so
   * "taxes extra" is not merely off-brand — it is false, and it is false on the
   * page a charge is agreed on. Checked across the whole bundle, not only the
   * pricing namespace, so the phrasing cannot arrive through a neighbouring key. */
  it("never says taxes are extra, in either language", () => {
    const forbidden =
      /taxes?\s+extra|plus\s+tax\b|\+\s*tax\b|excludes?\s+tax|before\s+tax|taxes?\s+en\s+sus|plus\s+taxes|taxes?\s+non\s+incluses|hors\s+taxes|avant\s+taxes/i;

    for (const key of Object.keys(en)) {
      expect(en[key as keyof typeof en], `en ${key}`).not.toMatch(forbidden);
      expect(fr[key as keyof typeof fr], `fr ${key}`).not.toMatch(forbidden);
    }
  });

  it("states the CAD list price, the checkout currency and that tax is included", () => {
    expect(en["pricing.footnote.currency"]).toMatch(/Canadian dollars/i);
    expect(en["pricing.footnote.currency"]).toMatch(
      /your own currency at checkout/i,
    );
    expect(en["pricing.footnote.currency"]).toMatch(/[Tt]ax is included/);

    expect(fr["pricing.footnote.currency"]).toMatch(/dollars canadiens/i);
    expect(fr["pricing.footnote.currency"]).toMatch(
      /votre propre devise au moment du paiement/i,
    );
    expect(fr["pricing.footnote.currency"]).toMatch(/[Ll]a taxe est comprise/);
  });

  /* The previous copy said payments were not part of Nixus. A pricing page that
   * repeated that would contradict the thing it is selling. */
  it("never claims on this page that there is no billing system", async () => {
    for (const locale of ["en", "fr"] as const) {
      const text = renderToString(providers(<PricingPage locale={locale} />));
      expect(text, locale).not.toMatch(
        /not part of Nixus|no payments|ne font pas encore partie|aucun paiement/i,
      );
    }
    await Promise.resolve();
  });

  /* AD-12: "premium" stopped being a meaningful word the moment two paid tiers
   * existed, and AD-14 forbids cloud-copy naming a sync tier. Neither may creep
   * onto the page that defines the plans. */
  it("names plans rather than reaching for premium or a sync tier", async () => {
    await renderPricing("en");

    expect(document.body.textContent).not.toMatch(/premium/i);
    expect(document.body.textContent).not.toMatch(
      /premium multi-device|multi-device sync tier/i,
    );
  });

  it("carries no Stripe price identifier in any pricing string", () => {
    for (const key of pricingKeys) {
      expect(en[key as keyof typeof en]).not.toMatch(/price_1[A-Za-z0-9]/);
      expect(fr[key as keyof typeof fr]).not.toMatch(/price_1[A-Za-z0-9]/);
    }
  });
});
