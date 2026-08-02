import { test, expect, type Page } from "@playwright/test";

const financialHealthInsufficientMock = {
  data_sufficient: false,
  emergency_fund: null,
  savings: null,
  waterfall: {
    current_step: "build_emergency_fund" as const,
    action_line_key: "build_emergency_fund",
  },
};

async function setupEmptyNetWorthMock(page: Page) {
  await page.addInitScript((healthMock) => {
    // unlisten() reaches into the event plugin's own internals object on cleanup.
    (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ =
      { unregisterListener: () => {} };

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      // Real Tauri exposes this; event.listen() calls it, and without it every listener throws.
      transformCallback: (cb: unknown) => {
        const id = Math.floor(Math.random() * 1e9);
        (window as unknown as Record<string, unknown>)[`_${id}`] = cb;
        return id;
      },
      invoke: (cmd: string) => {
        // A truthy updater answer opens an always-modal dialog that aria-hidden()s the whole app.
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);
        switch (cmd) {
          case "get_current_net_worth":
            return Promise.resolve({
              total_cents: 0,
              cash_cents: 0,
              investments_cents: 0,
              assets_cents: 0,
            });
          case "get_net_worth_history":
            return Promise.resolve([]);
          case "get_net_worth_change":
            return Promise.resolve({
              absolute_change_cents: 0,
              percentage_change: 0,
              direction: "flat",
            });
          case "get_recent_net_worth_snapshots":
            return Promise.resolve([]);
          case "get_financial_health_summary":
            return Promise.resolve(healthMock);
          default:
            return Promise.resolve(null);
        }
      },
    };
  }, financialHealthInsufficientMock);
}

async function setupSeededNetWorthMock(page: Page) {
  await page.addInitScript(() => {
    const breakdown = JSON.stringify({
      cash_cents: 1500000,
      crypto_cents: 500000,
      housing_cents: 45000000,
      tfsa_cents: 10000000,
      rrsp_cents: 15000000,
      fhsa_cents: 800000,
      non_registered_cents: 2000000,
      business_cents: 0,
      vehicles_cents: 2500000,
      other_cents: 0,
    });

    const snapshots = [
      { id: 1, total_cents: 70000000, snapshot_date: "2025-07-01", breakdown_json: breakdown, created_at: "2025-07-01" },
      { id: 2, total_cents: 72000000, snapshot_date: "2025-09-01", breakdown_json: breakdown, created_at: "2025-09-01" },
      { id: 3, total_cents: 73000000, snapshot_date: "2025-11-01", breakdown_json: breakdown, created_at: "2025-11-01" },
      { id: 4, total_cents: 74000000, snapshot_date: "2026-01-01", breakdown_json: breakdown, created_at: "2026-01-01" },
      { id: 5, total_cents: 76000000, snapshot_date: "2026-02-01", breakdown_json: breakdown, created_at: "2026-02-01" },
      { id: 6, total_cents: 77300000, snapshot_date: "2026-03-01", breakdown_json: breakdown, created_at: "2026-03-01" },
    ];

    let targetMonths = 6;

    const buildSummary = () => ({
      data_sufficient: true,
      emergency_fund: {
        coverage_months: 2.4,
        target_months: targetMonths,
        progress_ratio: 2.4 / targetMonths,
        status: "approaching" as const,
      },
      savings: {
        savings_rate_percent: 14,
        avg_monthly_surplus_cents: 62000,
      },
      waterfall: {
        current_step: "build_emergency_fund" as const,
        action_line_key: "build_emergency_fund",
      },
    });

    const buildDetail = () => ({
      ...buildSummary(),
      figures: {
        liquid_savings_cents: 1500000,
        avg_monthly_expenses_cents: 625000,
        avg_monthly_income_cents: 720000,
        credit_card_debt_cents: 0,
        expense_month_count: 3,
        income_month_count: 3,
      },
      waterfall: {
        current_step: "build_emergency_fund" as const,
        completed_steps: [],
        reasoning_key: "build_emergency_fund",
        reasoning_params: {
          coverage_months: 2.4,
          target_months: targetMonths,
          credit_card_debt_cents: 0,
          avg_monthly_surplus_cents: 62000,
          liquid_savings_cents: 1500000,
          avg_monthly_expenses_cents: 625000,
        },
      },
      top_discretionary_categories: [
        {
          category_id: 1,
          category_name: "Dining Out",
          group_name: "Lifestyle",
          avg_monthly_spend_cents: 45000,
        },
        {
          category_id: 2,
          category_name: "Subscriptions",
          group_name: "Lifestyle",
          avg_monthly_spend_cents: 12000,
        },
      ],
      monthly_surplus_trend: [
        { month: "2025-10", income_cents: 720000, expense_cents: 650000, surplus_cents: 70000 },
        { month: "2025-11", income_cents: 720000, expense_cents: 640000, surplus_cents: 80000 },
        { month: "2025-12", income_cents: 720000, expense_cents: 660000, surplus_cents: 60000 },
        { month: "2026-01", income_cents: 720000, expense_cents: 630000, surplus_cents: 90000 },
        { month: "2026-02", income_cents: 720000, expense_cents: 645000, surplus_cents: 75000 },
        { month: "2026-03", income_cents: 720000, expense_cents: 658000, surplus_cents: 62000 },
      ],
    });

    (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ =
      { unregisterListener: () => {} };

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      transformCallback: (cb: unknown) => {
        const id = Math.floor(Math.random() * 1e9);
        (window as unknown as Record<string, unknown>)[`_${id}`] = cb;
        return id;
      },
      invoke: (cmd: string, args?: { months?: number }) => {
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);
        switch (cmd) {
          case "get_current_net_worth":
            return Promise.resolve({
              total_cents: 77300000,
              cash_cents: 1500000,
              investments_cents: 28300000,
              assets_cents: 47500000,
            });
          case "get_net_worth_history":
            return Promise.resolve(snapshots);
          case "get_net_worth_change":
            return Promise.resolve({
              absolute_change_cents: 7300000,
              percentage_change: 10.43,
              direction: "up",
            });
          case "get_recent_net_worth_snapshots":
            return Promise.resolve(snapshots.map((s) => ({
              total_cents: s.total_cents,
              snapshot_date: s.snapshot_date,
            })));
          case "get_financial_health_summary":
            return Promise.resolve(buildSummary());
          case "get_financial_health_detail":
            return Promise.resolve(buildDetail());
          case "set_emergency_fund_target":
            if (
              args?.months == null ||
              args.months < 1 ||
              args.months > 24 ||
              !Number.isInteger(args.months)
            ) {
              return Promise.reject("Validation error");
            }
            targetMonths = args.months;
            return Promise.resolve(null);
          default:
            return Promise.resolve(null);
        }
      },
    };
  });
}

/** The Wealth destination's segmented sub-nav — real links, deliberately not an ARIA tablist. */
function wealthSubNav(page: Page) {
  return page.getByRole("navigation", { name: "Wealth" });
}

test.describe("Net Worth Page", () => {
  test("displays H1 title and current total", async ({ page }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/wealth/net-worth");

    await expect(
      page.getByRole("heading", { name: "Net worth", level: 1 })
    ).toBeVisible();

    const total = page.getByTestId("net-worth-total");
    await expect(total).toContainText("$773,000.00");
  });

  test("trend chart element is rendered", async ({ page }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/wealth/net-worth");

    const chart = page.getByTestId("trend-chart");
    await expect(chart).toBeVisible();

    // Recharts renders SVG
    await expect(chart.locator("svg")).toBeVisible();
  });

  test("period tabs (6M, 1Y, ALL) are visible and clickable", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/wealth/net-worth");

    const tabs = page.getByTestId("period-tabs");
    await expect(tabs).toBeVisible();

    await expect(page.getByTestId("period-tabs-6m")).toContainText("6M");
    await expect(page.getByTestId("period-tabs-1y")).toContainText("1Y");
    await expect(page.getByTestId("period-tabs-all")).toContainText("ALL");
  });

  test("clicking a different period tab updates chart", async ({ page }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/wealth/net-worth");

    // Default is 1Y
    const tab6m = page.getByTestId("period-tabs-6m");
    await tab6m.click();

    // Chart should still be visible after period change
    await expect(page.getByTestId("trend-chart")).toBeVisible();
  });

  test("NetWorthBreakdownBar renders with colored segments", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/wealth/net-worth");

    const bar = page.getByTestId("breakdown-bar");
    await expect(bar).toBeVisible();

    const segments = page.getByTestId("breakdown-segment");
    // Should have segments for non-zero categories
    const count = await segments.count();
    expect(count).toBeGreaterThan(0);
  });

  test("legend grid shows category names, amounts, and percentages", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/wealth/net-worth");

    const legend = page.getByTestId("breakdown-legend");
    await expect(legend).toBeVisible();

    const items = page.getByTestId("legend-item");
    const count = await items.count();
    expect(count).toBeGreaterThan(0);

    // Check first legend item has text content
    await expect(items.first()).toContainText("$");
    await expect(items.first()).toContainText("%");
  });

  test("the allocation bar is presentational and the table carries every label", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/wealth/net-worth");

    // The hover tooltip is retired: a hover-only readout is unreachable for anyone who does not use
    // a pointer. The bar now carries proportion only, and the table beside it is the direct label,
    // in the same rank order as the bands.
    const bar = page.getByTestId("breakdown-bar");
    await expect(bar).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByTestId("breakdown-tooltip")).toHaveCount(0);

    const segments = page.getByTestId("breakdown-segment");
    const rows = page.getByTestId("legend-item");
    expect(await rows.count()).toBe(await segments.count());

    // Largest first, so the biggest holding names itself in the first row.
    await expect(rows.first()).toContainText("Housing");
    await expect(rows.first()).toContainText("$450,000.00");
    await expect(rows.first()).toContainText("%");
  });

  test("with no snapshots, empty state message is visible", async ({
    page,
  }) => {
    await setupEmptyNetWorthMock(page);
    await page.goto("/wealth/net-worth");

    const emptyState = page.getByTestId("empty-net-worth");
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText("No snapshots yet");
    // Honest caption: it says when a snapshot appears rather than blaming the user for empty data.
    await expect(emptyState).toContainText(
      "Your first snapshot is taken when you enter account balances."
    );
    // Never an empty axis in place of a real state.
    await expect(page.getByTestId("trend-chart")).toHaveCount(0);
  });

  test("empty state carries exactly one action", async ({ page }) => {
    await setupEmptyNetWorthMock(page);
    await page.goto("/wealth/net-worth");

    await expect(page.getByTestId("add-account-btn")).toBeVisible();
    await expect(page.getByTestId("add-account-btn")).toHaveText(
      "Add an account"
    );
    // One action only: balances are what produce a snapshot, so a second equal-weight choice
    // sends half the users down the path that does not unblock them.
    const emptyState = page.getByTestId("empty-net-worth");
    await expect(emptyState.getByRole("button")).toHaveCount(1);
    await expect(page.getByTestId("add-asset-btn")).toHaveCount(0);
  });

  test("Wealth sub-nav lists its four surfaces and marks the current one", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/wealth/net-worth");

    // Exactly one segmented sub-nav per destination, owned by the shell rather than the surface.
    const subNav = wealthSubNav(page);
    await expect(subNav).toBeVisible();
    await expect(subNav.getByRole("link")).toHaveText([
      "Accounts",
      "What you own",
      "Net worth",
      "Where to put your money",
    ]);
    await expect(
      subNav.getByRole("link", { name: "Net worth", exact: true })
    ).toHaveAttribute("aria-current", "page");

    // Not a tablist, so arrow keys are deliberately unbound — announcing "link" and then behaving
    // like a tab is what confuses anyone who knows either pattern.
    await expect(subNav.locator('[role="tab"], [role="tablist"]')).toHaveCount(0);
    const first = subNav.getByRole("link", { name: "Accounts", exact: true });
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await expect(first).toBeFocused();
  });

  test("period tabs are not shown on the where-to-put-your-money surface", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/wealth/where-to-put-your-money");

    await expect(page.getByTestId("period-tabs")).toHaveCount(0);
    await expect(
      wealthSubNav(page).getByRole("link", {
        name: "Where to put your money",
        exact: true,
      })
    ).toHaveAttribute("aria-current", "page");
  });

  test("no surface in the Wealth destination says Financial Health", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);

    for (const path of ["/wealth/net-worth", "/wealth/where-to-put-your-money"]) {
      await page.goto(path);
      await expect(wealthSubNav(page)).toBeVisible();
      await expect(page.getByText("Financial Health")).toHaveCount(0);
    }
  });

  test("clicking Where to put your money navigates and marks it current", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/wealth/net-worth");

    const target = wealthSubNav(page).getByRole("link", {
      name: "Where to put your money",
      exact: true,
    });
    await target.click();

    await expect(page).toHaveURL(/\/wealth\/where-to-put-your-money/);
    await expect(target).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("action-waterfall")).toBeVisible();
  });

  test("where-to-put-your-money shows Compass empty state when data insufficient", async ({
    page,
  }) => {
    await setupEmptyNetWorthMock(page);
    await page.goto("/wealth/where-to-put-your-money");

    const emptyState = page.getByTestId("financial-health-section-empty");
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText("Come back in a couple of months");
    await expect(emptyState).toContainText(
      "needs about three finished months of spending to see a pattern. You have 0 so far."
    );
    // Progress, not a figure the app cannot yet know.
    await expect(
      page.getByTestId("financial-health-months-progress")
    ).toBeVisible();
    await expect(emptyState).toContainText("0 of 3 months");
    await expect(page.getByTestId("financial-health-import-cta")).toContainText(
      "Import transactions"
    );
  });

  test("clicking Net worth returns to trend view with period tabs", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/wealth/where-to-put-your-money");

    await wealthSubNav(page)
      .getByRole("link", { name: "Net worth", exact: true })
      .click();
    await expect(page).toHaveURL(/\/wealth\/net-worth\/?$/);
    await expect(page.getByTestId("period-tabs")).toBeVisible();
    await expect(page.getByTestId("trend-chart")).toBeVisible();
  });

  test("where-to-put-your-money shows the savings cushion panel with its source line", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/wealth/where-to-put-your-money");

    const panel = page.getByTestId("emergency-fund-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("emergency-fund-months")).toContainText(
      "2.4 months"
    );
    await expect(page.getByTestId("emergency-fund-progress")).toBeVisible();
    await expect(page.getByTestId("emergency-fund-target")).toContainText(
      "6 months"
    );
    // Prose, not a division: the figures are named in the sentence that uses them.
    const mathLine = page.getByTestId("emergency-fund-math-line");
    await expect(mathLine).toContainText("$15,000.00 in chequing and savings");
    await expect(mathLine).toContainText(
      "$6,250.00 of spending in a typical month"
    );
    // A guideline number alone is not actionable; the note names which money actually counts.
    await expect(panel.getByText(/Savings accounts only/)).toBeVisible();
    await expect(
      page.getByTestId("financial-health-section-disclaimer")
    ).toBeVisible();
  });

  test("clicking target months opens inline edit", async ({ page }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/wealth/where-to-put-your-money");

    await page.getByTestId("emergency-fund-target").click();
    await expect(page.getByTestId("emergency-fund-target-input")).toBeVisible();
  });

  test("saving valid target shows toast and updates display", async ({ page }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/wealth/where-to-put-your-money");

    await page.getByTestId("emergency-fund-target").click();
    const input = page.getByTestId("emergency-fund-target-input");
    await input.fill("8");
    await input.press("Enter");

    await expect(page.getByText("Emergency fund target updated")).toBeVisible();
    await expect(page.getByTestId("emergency-fund-target")).toContainText("8 mo");
  });

  test("invalid target shows inline error without toast", async ({ page }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/wealth/where-to-put-your-money");

    await page.getByTestId("emergency-fund-target").click();
    const input = page.getByTestId("emergency-fund-target-input");
    await input.fill("25");
    await input.press("Enter");

    await expect(page.getByTestId("emergency-fund-target-error")).toContainText(
      "Enter a whole number between 1 and 24"
    );
    await expect(page.getByText("Emergency fund target updated")).not.toBeVisible();
    await input.press("Escape");
    await expect(page.getByTestId("emergency-fund-target")).toContainText("6 mo");
  });

  test("pressing Escape on target edit reverts without saving", async ({ page }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/wealth/where-to-put-your-money");

    await page.getByTestId("emergency-fund-target").click();
    const input = page.getByTestId("emergency-fund-target-input");
    await input.fill("10");
    await input.press("Escape");

    await expect(page.getByTestId("emergency-fund-target-input")).not.toBeVisible();
    await expect(page.getByTestId("emergency-fund-target")).toContainText("6 mo");
    await expect(page.getByText("Emergency fund target updated")).not.toBeVisible();
  });

  test("where-to-put-your-money shows the action waterfall with current rung", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/wealth/where-to-put-your-money");

    const waterfall = page.getByTestId("action-waterfall");
    await expect(waterfall).toBeVisible();
    await expect(
      waterfall.getByText("Your order of operations", { exact: true })
    ).toBeVisible();

    const currentRung = page.getByTestId("waterfall-rung-build_emergency_fund");
    await expect(currentRung).toHaveAttribute("data-state", "current");
    await expect(currentRung).toContainText("You're here");
    await expect(page.getByTestId("waterfall-why-toggle")).toBeVisible();
  });

  test("expanding Why? on waterfall shows reasoning with user figures", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/wealth/where-to-put-your-money");

    await page.getByTestId("waterfall-why-toggle").click();

    const reasoning = page.getByTestId("waterfall-reasoning");
    await expect(reasoning).toBeVisible();
    await expect(reasoning).toContainText("2.4 months");
    await expect(reasoning).toContainText("6 months");
  });

  test("where-to-put-your-money shows savings capacity panel", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/wealth/where-to-put-your-money");

    const panel = page.getByTestId("savings-capacity-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("What you're able to save")).toBeVisible();

    // The surplus is stated in the sentence that gives it meaning rather than as a bare +$/mo.
    const rate = page.getByTestId("savings-capacity-rate");
    await expect(rate).toContainText("14%");
    await expect(rate).toContainText(
      "$620.00 left over in a typical month"
    );

    await expect(page.getByTestId("savings-capacity-trend")).toBeVisible();
    await expect(page.getByTestId("savings-capacity-categories")).toBeVisible();
    await expect(panel.getByText("Dining Out")).toBeVisible();
    await expect(panel.getByText("Subscriptions")).toBeVisible();
    await expect(panel.getByText("Where you'd find the money")).toBeVisible();
  });
});
