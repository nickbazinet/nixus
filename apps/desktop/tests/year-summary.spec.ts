import { test, expect, type Page } from "@playwright/test";

function makeYearlySummary(overrides: Record<string, unknown> = {}) {
  return {
    year: 2026,
    is_current_year: true,
    total_spent_cents: 450000,
    total_income_cents: 600000,
    cash_flow_net_cents: 150000,
    net_worth_gain_cents: 2500000,
    net_worth_gain_available: true,
    top_categories: [
      { category_id: 1, category_name: "Housing", spent_cents: 120000 },
      { category_id: 2, category_name: "Food", spent_cents: 35000 },
      { category_id: 3, category_name: "Entertainment", spent_cents: 15000 },
    ],
    monthly_totals: [
      { month: "2026-01", total_cents: 80000 },
      { month: "2026-02", total_cents: 90000 },
      { month: "2026-03", total_cents: 280000 },
      ...Array.from({ length: 9 }, (_, i) => ({
        month: `2026-${String(i + 4).padStart(2, "0")}`,
        total_cents: 0,
      })),
    ],
    all_categories: [
      { category_id: 1, category_name: "Housing", spent_cents: 120000 },
      { category_id: 2, category_name: "Food", spent_cents: 35000 },
      { category_id: 3, category_name: "Entertainment", spent_cents: 15000 },
      { category_id: 4, category_name: "Transport", spent_cents: 5000 },
    ],
    available_years: [2026, 2025, 2024],
    ...overrides,
  };
}

async function setupYearSummaryMock(page: Page, yearlyOverrides: Record<string, unknown> = {}) {
  const summary2026 = makeYearlySummary(yearlyOverrides);
  const summary2025 = makeYearlySummary({
    year: 2025,
    is_current_year: false,
    total_spent_cents: 320000,
    total_income_cents: 500000,
    cash_flow_net_cents: 180000,
    net_worth_gain_cents: 1000000,
    monthly_totals: Array.from({ length: 12 }, (_, i) => ({
      month: `2025-${String(i + 1).padStart(2, "0")}`,
      total_cents: i < 11 ? Math.floor(320000 / 12) : 320000 - Math.floor(320000 / 12) * 11,
    })),
    available_years: [2026, 2025, 2024],
  });

  await page.addInitScript(
    ({ s2026, s2025 }) => {
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args?: { year?: number }) => {
          switch (cmd) {
            case "get_yearly_summary":
              if (args?.year === 2025) return Promise.resolve(s2025);
              return Promise.resolve(s2026);
            default:
              return Promise.resolve(null);
          }
        },
      };
    },
    { s2026: summary2026, s2025: summary2025 }
  );
}

test.describe("Year Summary Page", () => {
  test("renders metrics and chart with seeded data", async ({ page }) => {
    await setupYearSummaryMock(page);
    await page.goto("/year-summary");

    await expect(
      page.getByRole("heading", { name: "Year Summary" })
    ).toBeVisible();

    await expect(page.getByTestId("year-metric-spent")).toContainText("$4,500.00");
    await expect(page.getByTestId("year-metric-income")).toContainText("$6,000.00");
    await expect(page.getByTestId("year-metric-cash-flow")).toContainText("$1,500.00");
    await expect(page.getByTestId("year-metric-gain")).toContainText("$25,000.00");
    await expect(page.getByTestId("spending-trend-chart")).toBeVisible();
    await expect(page.getByTestId("yearly-category-table")).toBeVisible();

    const monthsElapsed = new Date().getMonth() + 1;
    const ytdAvgCents = Math.round(450000 / monthsElapsed);
    const ytdAvgFormatted = `$${(ytdAvgCents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
    await expect(page.getByText("Year to Date Average Monthly Spend")).toBeVisible();
    await expect(page.getByTestId("spending-trend-avg")).toContainText(ytdAvgFormatted);
  });

  test("past year uses full-year monthly average", async ({ page }) => {
    await setupYearSummaryMock(page);
    await page.goto("/year-summary");

    await page.getByTestId("year-summary-tabs-2025").click();

    const fullYearAvgFormatted = `$${(320000 / 12 / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
    await expect(page.getByText("Average Monthly Spend")).toBeVisible();
    await expect(page.getByTestId("spending-trend-avg")).toContainText(fullYearAvgFormatted);
  });

  test("year pill tabs switch data", async ({ page }) => {
    await setupYearSummaryMock(page);
    await page.goto("/year-summary");

    await page.getByTestId("year-summary-tabs-2025").click();
    await expect(page.getByTestId("year-metric-spent")).toContainText("$3,200.00");
  });

  test("shows empty state when no data", async ({ page }) => {
    await setupYearSummaryMock(page, {
      total_spent_cents: 0,
      total_income_cents: 0,
      cash_flow_net_cents: 0,
      top_categories: [],
      all_categories: [],
      monthly_totals: Array.from({ length: 12 }, (_, i) => ({
        month: `2026-${String(i + 1).padStart(2, "0")}`,
        total_cents: 0,
      })),
    });
    await page.goto("/year-summary");

    await expect(page.getByTestId("year-summary-empty")).toBeVisible();
    await expect(page.getByTestId("year-summary-empty")).toContainText(
      "No spending recorded yet this year."
    );
  });
});
