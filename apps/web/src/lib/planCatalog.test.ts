import { afterEach, describe, expect, it, vi } from "vitest";
import { BILLING_CAPABILITIES } from "@nixus/shared";

import {
  ADVERTISED_CAPABILITIES,
  PRICING_COLUMNS,
  PRICING_COLUMN_IDS,
  PRICING_FEATURE_ROWS,
  pricingColumn,
  rowIncludes,
} from "@/content/pricing";
import { planCatalogUrl } from "./billingApi";
import { EMPTY_PLAN_CATALOG, loadPlanCatalog, toPlanCatalog } from "./planCatalog";
import { formatPlanAmount, resolvePlanPrice } from "./planPricing";

/*
 * The hydration contract, asserted at the layer that owns it.
 *
 * Everything here exists to keep one promise: a visitor who cannot reach the
 * billing API sees the baked prices, unchanged, with nothing in the console and
 * no error state on screen. Each failure mode a real deployment can produce —
 * refused, slow, non-200, HTML body, truncated body, newer server, duplicate
 * key, unknown key — is a separate case rather than one "bad response" case,
 * because they fail at different points in the parse and only one of them is
 * covered by a `try`.
 */

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tier: "classic",
    lookup_key: "classic_monthly_cad",
    unit_amount_cents: 1099,
    currency: "CAD",
    interval: "month",
    display_order: 1,
    capabilities: ["multi_device_sync"],
    monthly_request_limit: null,
    ...overrides,
  };
}

function body(
  plans: readonly unknown[],
  cacheTtlSeconds: unknown = 300,
): Record<string, unknown> {
  return { plans, cache_ttl_seconds: cacheTtlSeconds };
}

function stubFetch(implementation: typeof fetch): ReturnType<typeof vi.fn> {
  const mock = vi.fn(implementation);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("toPlanCatalog", () => {
  it("keys entries by lookup_key and carries the TTL", () => {
    const catalog = toPlanCatalog(body([entry()]));

    expect(catalog.cacheTtlSeconds).toBe(300);
    expect(catalog.prices.get("classic_monthly_cad")).toEqual({
      amountCents: 1099,
      currency: "CAD",
      interval: "month",
    });
  });

  it("keeps a zero amount rather than treating it as absent", () => {
    const catalog = toPlanCatalog(body([entry({ unit_amount_cents: 0 })]));

    expect(catalog.prices.get("classic_monthly_cad")?.amountCents).toBe(0);
  });

  it("normalises a lowercase currency instead of rejecting it", () => {
    const catalog = toPlanCatalog(body([entry({ currency: "cad" })]));

    expect(catalog.prices.get("classic_monthly_cad")?.currency).toBe("CAD");
  });

  /* Per field, not all-or-nothing: an entry that publishes a good amount beside
   * one unparseable member must still move the price. */
  it.each([
    ["unit_amount_cents", { unit_amount_cents: "1099" }, "amountCents"],
    ["unit_amount_cents", { unit_amount_cents: 10.99 }, "amountCents"],
    ["unit_amount_cents", { unit_amount_cents: -1 }, "amountCents"],
    ["currency", { currency: "DOLLARS" }, "currency"],
    ["currency", { currency: null }, "currency"],
    ["interval", { interval: "monthly" }, "interval"],
    ["interval", { interval: 1 }, "interval"],
  ])("nulls only %s when it is %o", (_field, override, nulled) => {
    const parsed = toPlanCatalog(body([entry(override)])).prices.get(
      "classic_monthly_cad",
    );

    expect(parsed).toBeDefined();
    expect(parsed?.[nulled as keyof NonNullable<typeof parsed>]).toBeNull();
    const intact = (["amountCents", "currency", "interval"] as const).filter(
      (member) => member !== nulled,
    );
    for (const member of intact) {
      expect(parsed?.[member], `${member} was discarded with ${nulled}`).not.toBeNull();
    }
  });

  it("drops an entry whose lookup_key is absent or not key-shaped", () => {
    const catalog = toPlanCatalog(
      body([
        entry({ lookup_key: undefined }),
        entry({ lookup_key: "Classic Monthly" }),
        entry({ lookup_key: 42 }),
      ]),
    );

    expect([...catalog.prices.keys()]).toEqual([]);
  });

  /* A key no column declares must be inert, not a fifth column: the page's
   * columns are fixed and only the money is live (AD-6). */
  it("retains an unknown lookup_key without it reaching any column", () => {
    const catalog = toPlanCatalog(
      body([entry({ lookup_key: "privilege_monthly_cad", unit_amount_cents: 4999 })]),
    );

    for (const column of PRICING_COLUMNS) {
      const price = resolvePlanPrice(column, catalog.prices);
      expect(price.amountCents).toBe(column.bakedAmountCents);
    }
  });

  it("takes the first of two entries sharing a lookup_key", () => {
    const catalog = toPlanCatalog(
      body([entry({ unit_amount_cents: 1099 }), entry({ unit_amount_cents: 9999 })]),
    );

    expect(catalog.prices.get("classic_monthly_cad")?.amountCents).toBe(1099);
  });

  it("ignores members a newer server added", () => {
    const catalog = toPlanCatalog({
      ...body([entry({ trial_days: 14 })]),
      promotions: [{ code: "LAUNCH" }],
    });

    expect(catalog.prices.get("classic_monthly_cad")?.amountCents).toBe(1099);
  });

  it.each([
    ["null", null],
    ["a string", "unavailable"],
    ["an array", []],
    ["an object with no plans", {}],
    ["plans as an object", { plans: {} }],
    ["plans containing scalars", { plans: [1, "x", null] }],
  ])("yields an empty catalog for %s", (_label, payload) => {
    expect(toPlanCatalog(payload).prices.size).toBe(0);
  });

  it("reports an unusable TTL as null rather than guessing one", () => {
    expect(toPlanCatalog(body([entry()], "300")).cacheTtlSeconds).toBeNull();
    expect(toPlanCatalog(body([entry()], null)).cacheTtlSeconds).toBeNull();
  });
});

describe("loadPlanCatalog", () => {
  it("requests the public catalog route and parses the body", async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse(body([entry()]))));

    const catalog = await loadPlanCatalog();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(planCatalogUrl());
    expect(planCatalogUrl()).toBe("https://api.nixusapp.com/v1/billing/plans");
    expect(catalog?.prices.get("classic_monthly_cad")?.amountCents).toBe(1099);
  });

  /* AD-6: `cache_ttl_seconds` is the system's single cache bound, already
   * expressed as the response's own `Cache-Control`. Passing a `cache` mode
   * here would override it, which is the second cache owner that forbids. */
  it("passes no cache mode, leaving the response's own Cache-Control in charge", async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse(body([entry()]))));

    await loadPlanCatalog();

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init).not.toHaveProperty("cache");
    expect(init.headers).toEqual({ accept: "application/json" });
  });

  it.each([400, 401, 403, 404, 429, 500, 503])(
    "returns null on HTTP %i without throwing",
    async (status) => {
      stubFetch(() => Promise.resolve(jsonResponse(body([entry()]), status)));

      await expect(loadPlanCatalog()).resolves.toBeNull();
    },
  );

  it.each([
    ["a refused connection", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["an aborted request", () => Promise.reject(new DOMException("Aborted", "AbortError"))],
    [
      "an HTML error page served with a 200",
      () =>
        Promise.resolve(
          new Response("<html><body>502</body></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
        ),
    ],
    [
      "a truncated body",
      () =>
        Promise.resolve(
          new Response('{"plans":[', {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
    ],
  ])("returns null for %s", async (_label, implementation) => {
    stubFetch(implementation as typeof fetch);

    await expect(loadPlanCatalog()).resolves.toBeNull();
  });

  /* A 200 carrying no entry this page can use is indistinguishable from no
   * answer; reporting it as a catalog would replace nothing while claiming to. */
  it("returns null for a well-formed but empty catalog", async () => {
    stubFetch(() => Promise.resolve(jsonResponse(body([]))));

    await expect(loadPlanCatalog()).resolves.toBeNull();
  });

  it("writes nothing to the console on any failure path", async () => {
    const spies = {
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
    };

    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    await loadPlanCatalog();
    stubFetch(() => Promise.resolve(jsonResponse({ nope: true }, 503)));
    await loadPlanCatalog();

    for (const [channel, spy] of Object.entries(spies)) {
      expect(spy, `console.${channel} was written to`).not.toHaveBeenCalled();
    }
  });

  it("forwards the abort signal so an unmount cancels the request", async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse(body([entry()]))));
    const controller = new AbortController();

    await loadPlanCatalog(controller.signal);

    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal);
  });
});

describe("resolvePlanPrice", () => {
  it("falls back to every baked value when the catalog is empty", () => {
    for (const column of PRICING_COLUMNS) {
      expect(resolvePlanPrice(column, EMPTY_PLAN_CATALOG.prices)).toEqual({
        amountCents: column.bakedAmountCents,
        currency: column.bakedCurrency,
        interval: column.bakedInterval,
      });
    }
  });

  it("takes the live amount, currency and interval when all three are published", () => {
    const { prices } = toPlanCatalog(
      body([
        entry({ unit_amount_cents: 1299, currency: "USD", interval: "year" }),
      ]),
    );

    expect(resolvePlanPrice(pricingColumn("classic"), prices)).toEqual({
      amountCents: 1299,
      currency: "USD",
      interval: "year",
    });
  });

  it("mixes a live amount with baked currency and interval when only it is usable", () => {
    const { prices } = toPlanCatalog(
      body([
        entry({ unit_amount_cents: 1299, currency: "???", interval: "fortnight" }),
      ]),
    );

    expect(resolvePlanPrice(pricingColumn("classic"), prices)).toEqual({
      amountCents: 1299,
      currency: "CAD",
      interval: "month",
    });
  });

  /* Local and Nixus Cloud Free have no Stripe Price, so no catalog entry can
   * ever be addressed to them — not even one that names them. */
  it("never applies a live entry to a column with no lookup_key", () => {
    const { prices } = toPlanCatalog(
      body([entry({ lookup_key: "local_monthly_cad", unit_amount_cents: 500 })]),
    );

    for (const id of ["local", "cloudFree"] as const) {
      expect(resolvePlanPrice(pricingColumn(id), prices).amountCents).toBe(0);
    }
  });
});

describe("formatPlanAmount", () => {
  it("renders the CAD list price with its currency code in each locale", () => {
    const classic = resolvePlanPrice(pricingColumn("classic"), new Map());
    const advance = resolvePlanPrice(pricingColumn("advance"), new Map());

    expect(formatPlanAmount(classic, "en")).toBe("$9.99 CAD");
    expect(formatPlanAmount(advance, "en")).toBe("$19.99 CAD");
    expect(formatPlanAmount(classic, "fr")).toMatch(/^9,99\s\$\sCAD$/u);
    expect(formatPlanAmount(advance, "fr")).toMatch(/^19,99\s\$\sCAD$/u);
  });

  /* Minor units all the way to `Intl.NumberFormat`: the only division by 100
   * in the monorepo is inside `formatMoney`, at the render edge. A cents value
   * that cannot be represented exactly as a float is the case that catches a
   * stray `cents / 100` on the way here. */
  it("renders a large amount exactly, with no float drift", () => {
    expect(
      formatPlanAmount(
        { amountCents: 99_999_999, currency: "CAD", interval: "month" },
        "en",
      ),
    ).toBe("$999,999.99 CAD");
    expect(
      formatPlanAmount({ amountCents: 1, currency: "CAD", interval: "month" }, "en"),
    ).toBe("$0.01 CAD");
  });

  it("formats a live non-CAD currency in the active locale", () => {
    expect(
      formatPlanAmount({ amountCents: 1299, currency: "USD", interval: "month" }, "en"),
    ).toBe("$12.99 USD");
  });
});

describe("the page's fixed shape", () => {
  it("declares exactly the four columns, in ladder order", () => {
    expect(PRICING_COLUMNS.map((column) => column.id)).toEqual([
      "local",
      "cloudFree",
      "classic",
      "advance",
    ]);
    expect(PRICING_COLUMN_IDS).toEqual(PRICING_COLUMNS.map((column) => column.id));
  });

  it("highlights exactly one column", () => {
    expect(PRICING_COLUMNS.filter((column) => column.recommended)).toHaveLength(1);
    expect(pricingColumn("advance").recommended).toBe(true);
  });

  /* The baked amounts are the release-gated figures from the tier table. They
   * are a fallback, never the source of truth — which is why there is no
   * `price_id` to assert here, only a `lookup_key`. */
  it("bakes the advertised CAD monthly prices and their lookup keys", () => {
    expect(pricingColumn("classic")).toMatchObject({
      lookupKey: "classic_monthly_cad",
      bakedAmountCents: 999,
      bakedCurrency: "CAD",
      bakedInterval: "month",
    });
    expect(pricingColumn("advance")).toMatchObject({
      lookupKey: "advance_monthly_cad",
      bakedAmountCents: 1999,
      bakedCurrency: "CAD",
      bakedInterval: "month",
    });
  });

  it("gives the two free columns no Stripe Price and no interval", () => {
    for (const id of ["local", "cloudFree"] as const) {
      expect(pricingColumn(id)).toMatchObject({
        lookupKey: null,
        bakedAmountCents: 0,
        bakedInterval: null,
      });
    }
  });

  it("bakes every integer amount as minor units, never a decimal", () => {
    for (const column of PRICING_COLUMNS) {
      expect(Number.isSafeInteger(column.bakedAmountCents)).toBe(true);
    }
  });

  it("matches the tier table: sync from Classic up, hosted AI on Advance only", () => {
    const included = (rowId: string) =>
      PRICING_COLUMN_IDS.filter((id) => {
        const row = PRICING_FEATURE_ROWS.find((candidate) => candidate.id === rowId);
        return row !== undefined && rowIncludes(row, id);
      });

    expect(included("noAccount")).toEqual(["local"]);
    expect(included("cloudProfile")).toEqual(["cloudFree", "classic", "advance"]);
    expect(included("sync")).toEqual(["classic", "advance"]);
    expect(included("hostedAi")).toEqual(["advance"]);
    expect(included("householdNetWorth")).toEqual(["classic", "advance"]);
    expect(included("customDashboards")).toEqual(["advance"]);
    // AD-16 gates that a visitor bringing their own credentials reaches every
    // AI surface on any plan, free included.
    expect(included("byoAi")).toEqual([...PRICING_COLUMN_IDS]);
  });

  /* The closed capability union is the entitlement model's source of truth, so
   * adding a member has to force a decision about how the page advertises it
   * rather than silently shipping a plan nobody can see they are buying. */
  it("advertises every capability the closed union defines, once each", () => {
    expect([...ADVERTISED_CAPABILITIES]).toEqual([...BILLING_CAPABILITIES]);

    for (const capability of BILLING_CAPABILITIES) {
      const claiming = PRICING_FEATURE_ROWS.filter(
        (row) => row.capability === capability,
      );
      expect(claiming, `${capability} is claimed by ${claiming.length} rows`).toHaveLength(1);
    }
  });

  it("marks household net worth as coming and custom dashboards as shipped", () => {
    const byId = new Map(PRICING_FEATURE_ROWS.map((row) => [row.id, row]));

    expect(byId.get("householdNetWorth")?.comingSoon).toBe(true);
    expect(byId.get("customDashboards")?.comingSoon).toBeUndefined();
  });
});
