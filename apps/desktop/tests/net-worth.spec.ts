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

const financialHealthSufficientMock = {
  data_sufficient: true,
  emergency_fund: {
    coverage_months: 2.4,
    target_months: 6,
    progress_ratio: 0.4,
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
};

async function setupEmptyNetWorthMock(page: Page) {
  await page.addInitScript((healthMock) => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: (cmd: string) => {
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

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args?: { months?: number }) => {
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

test.describe("Net Worth Page", () => {
  test("displays H1 title and current total", async ({ page }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/net-worth");

    await expect(
      page.getByRole("heading", { name: "Net Worth" })
    ).toBeVisible();

    const total = page.getByTestId("net-worth-total");
    await expect(total).toContainText("$773,000.00");
  });

  test("trend chart element is rendered", async ({ page }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/net-worth");

    const chart = page.getByTestId("trend-chart");
    await expect(chart).toBeVisible();

    // Recharts renders SVG
    await expect(chart.locator("svg")).toBeVisible();
  });

  test("period tabs (6M, 1Y, ALL) are visible and clickable", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/net-worth");

    const tabs = page.getByTestId("period-tabs");
    await expect(tabs).toBeVisible();

    await expect(page.getByTestId("period-tabs-6m")).toContainText("6M");
    await expect(page.getByTestId("period-tabs-1y")).toContainText("1Y");
    await expect(page.getByTestId("period-tabs-all")).toContainText("ALL");
  });

  test("clicking a different period tab updates chart", async ({ page }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/net-worth");

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
    await page.goto("/net-worth");

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
    await page.goto("/net-worth");

    const legend = page.getByTestId("breakdown-legend");
    await expect(legend).toBeVisible();

    const items = page.getByTestId("legend-item");
    const count = await items.count();
    expect(count).toBeGreaterThan(0);

    // Check first legend item has text content
    await expect(items.first()).toContainText("$");
    await expect(items.first()).toContainText("%");
  });

  test("hovering a bar segment shows tooltip", async ({ page }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/net-worth");

    const segments = page.getByTestId("breakdown-segment");
    await segments.first().hover();

    const tooltip = page.getByTestId("breakdown-tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("$");
  });

  test("with no snapshots, empty state message is visible", async ({
    page,
  }) => {
    await setupEmptyNetWorthMock(page);
    await page.goto("/net-worth");

    const emptyState = page.getByTestId("empty-net-worth");
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText(
      "No net worth history yet. Add accounts and assets to start tracking."
    );
  });

  test("empty state shows Add Account and Add Asset buttons", async ({
    page,
  }) => {
    await setupEmptyNetWorthMock(page);
    await page.goto("/net-worth");

    await expect(page.getByTestId("add-account-btn")).toBeVisible();
    await expect(page.getByTestId("add-asset-btn")).toBeVisible();
  });

  test("section sub-nav shows Net Worth and Financial Health", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/net-worth");

    const sectionNav = page.getByTestId("net-worth-section-nav");
    await expect(sectionNav).toBeVisible();
    await expect(page.getByTestId("section-nav-net-worth")).toContainText(
      "Net Worth"
    );
    await expect(page.getByTestId("section-nav-financial-health")).toContainText(
      "Financial Health"
    );
  });

  test("period tabs are not shown on Financial Health section", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/net-worth/financial-health");

    await expect(page.getByTestId("period-tabs")).not.toBeVisible();
    await expect(page.getByTestId("net-worth-section-nav")).toBeVisible();
  });

  test("clicking Financial Health section shows subtitle", async ({ page }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/net-worth");

    await page.getByTestId("section-nav-financial-health").click();
    await expect(page).toHaveURL(/\/net-worth\/financial-health/);
    await expect(page.getByText("Where your money should go next")).toBeVisible();
  });

  test("Financial Health section shows Compass empty state when data insufficient", async ({
    page,
  }) => {
    await setupEmptyNetWorthMock(page);
    await page.goto("/net-worth/financial-health");

    const emptyState = page.getByTestId("financial-health-section-empty");
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText("Not enough data yet");
    await expect(page.getByTestId("financial-health-import-cta")).toContainText(
      "Import transactions"
    );
  });

  test("clicking Net Worth section returns to trend view with period tabs", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/net-worth/financial-health");

    await page.getByTestId("section-nav-net-worth").click();
    await expect(page).toHaveURL(/\/net-worth\/?$/);
    await expect(page.getByTestId("period-tabs")).toBeVisible();
    await expect(page.getByTestId("trend-chart")).toBeVisible();
  });

  test("Financial Health section shows emergency fund panel with math line", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/net-worth/financial-health");

    const panel = page.getByTestId("emergency-fund-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("emergency-fund-months")).toContainText("2.4 mo");
    await expect(page.getByTestId("emergency-fund-progress")).toBeVisible();
    await expect(page.getByTestId("emergency-fund-target")).toContainText("6 mo");
    await expect(page.getByTestId("emergency-fund-math-line")).toContainText(
      "$15,000.00 liquid savings"
    );
    await expect(page.getByTestId("emergency-fund-math-line")).toContainText(
      "$6,250.00 average monthly expenses"
    );
    await expect(panel.getByText("3–6 months is a common guideline")).toBeVisible();
    await expect(page.getByTestId("financial-health-section-disclaimer")).toBeVisible();
  });

  test("clicking target months opens inline edit", async ({ page }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/net-worth/financial-health");

    await page.getByTestId("emergency-fund-target").click();
    await expect(page.getByTestId("emergency-fund-target-input")).toBeVisible();
  });

  test("saving valid target shows toast and updates display", async ({ page }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/net-worth/financial-health");

    await page.getByTestId("emergency-fund-target").click();
    const input = page.getByTestId("emergency-fund-target-input");
    await input.fill("8");
    await input.press("Enter");

    await expect(page.getByText("Emergency fund target updated")).toBeVisible();
    await expect(page.getByTestId("emergency-fund-target")).toContainText("8 mo");
  });

  test("invalid target shows inline error without toast", async ({ page }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/net-worth/financial-health");

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
    await page.goto("/net-worth/financial-health");

    await page.getByTestId("emergency-fund-target").click();
    const input = page.getByTestId("emergency-fund-target-input");
    await input.fill("10");
    await input.press("Escape");

    await expect(page.getByTestId("emergency-fund-target-input")).not.toBeVisible();
    await expect(page.getByTestId("emergency-fund-target")).toContainText("6 mo");
    await expect(page.getByText("Emergency fund target updated")).not.toBeVisible();
  });

  test("Financial Health section shows action waterfall with current rung", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/net-worth/financial-health");

    const waterfall = page.getByTestId("action-waterfall");
    await expect(waterfall).toBeVisible();
    await expect(waterfall.getByText("Priority ladder")).toBeVisible();

    const currentRung = page.getByTestId("waterfall-rung-build_emergency_fund");
    await expect(currentRung).toHaveAttribute("data-state", "current");
    await expect(currentRung).toContainText("You are here");
    await expect(page.getByTestId("waterfall-why-toggle")).toBeVisible();
  });

  test("expanding Why? on waterfall shows reasoning with user figures", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/net-worth/financial-health");

    await page.getByTestId("waterfall-why-toggle").click();

    const reasoning = page.getByTestId("waterfall-reasoning");
    await expect(reasoning).toBeVisible();
    await expect(reasoning).toContainText("2.4 months");
    await expect(reasoning).toContainText("6 months");
  });

  test("Financial Health section shows savings capacity panel", async ({
    page,
  }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/net-worth/financial-health");

    const panel = page.getByTestId("savings-capacity-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("savings-capacity-rate")).toContainText("14%");
    await expect(page.getByTestId("savings-capacity-surplus")).toContainText(
      "+$620.00/mo"
    );
    await expect(page.getByTestId("savings-capacity-trend")).toBeVisible();
    await expect(page.getByTestId("savings-capacity-categories")).toBeVisible();
    await expect(panel.getByText("Dining Out")).toBeVisible();
    await expect(panel.getByText("Subscriptions")).toBeVisible();
    await expect(panel.getByText("Where you could free up capacity")).toBeVisible();
  });
});
