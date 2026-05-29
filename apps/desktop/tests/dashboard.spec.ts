import { test, expect, type Page } from "@playwright/test";

const yearlySummaryMock = {
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
  monthly_totals: [],
  all_categories: [],
  available_years: [2026, 2025],
};

const emptyYearlySummaryMock = {
  year: 2026,
  is_current_year: true,
  total_spent_cents: 0,
  total_income_cents: 0,
  cash_flow_net_cents: 0,
  net_worth_gain_cents: null,
  net_worth_gain_available: false,
  top_categories: [],
  monthly_totals: [],
  all_categories: [],
  available_years: [2026],
};

async function setupEmptyDashboardMock(page: Page) {
  await page.addInitScript((yearlyMock) => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: (cmd: string) => {
        switch (cmd) {
          case "get_budget_summary":
            return Promise.resolve({
              total_target_cents: 0,
              total_spent_cents: 0,
              remaining_cents: 0,
              month: "2026-03",
            });
          case "get_top_budget_categories":
            return Promise.resolve([]);
          case "get_current_net_worth":
            return Promise.resolve({
              total_cents: 0,
              cash_cents: 0,
              investments_cents: 0,
              assets_cents: 0,
            });
          case "get_recent_net_worth_snapshots":
            return Promise.resolve([]);
          case "get_spending_breakdown":
            return Promise.resolve([]);
          case "get_yearly_summary":
            return Promise.resolve(yearlyMock);
          default:
            return Promise.resolve(null);
        }
      },
    };
  }, emptyYearlySummaryMock);
}

async function setupSeededDashboardMock(page: Page) {
  await page.addInitScript((yearlyMock) => {
    const summary = {
      total_target_cents: 300000,
      total_spent_cents: 175000,
      remaining_cents: 125000,
      month: "2026-03",
    };

    const categories = [
      {
        id: 1,
        name: "Housing",
        group_name: "Essentials",
        target_cents: 150000,
        spent_cents: 120000,
        percentage: 80.0,
      },
      {
        id: 2,
        name: "Food",
        group_name: "Essentials",
        target_cents: 80000,
        spent_cents: 35000,
        percentage: 43.75,
      },
      {
        id: 3,
        name: "Entertainment",
        group_name: "Lifestyle",
        target_cents: 50000,
        spent_cents: 15000,
        percentage: 30.0,
      },
      {
        id: 4,
        name: "Transport",
        group_name: "Essentials",
        target_cents: 20000,
        spent_cents: 5000,
        percentage: 25.0,
      },
    ];

    const netWorth = {
      total_cents: 52500000,
      cash_cents: 1500000,
      investments_cents: 25000000,
      assets_cents: 26000000,
    };

    const snapshots = [
      { total_cents: 48000000, snapshot_date: "2025-10-01" },
      { total_cents: 49000000, snapshot_date: "2025-11-01" },
      { total_cents: 50000000, snapshot_date: "2025-12-01" },
      { total_cents: 51000000, snapshot_date: "2026-01-01" },
      { total_cents: 51500000, snapshot_date: "2026-02-01" },
      { total_cents: 52500000, snapshot_date: "2026-03-01" },
    ];

    const spendingBreakdown = [
      { category_id: 1, category_name: "Housing", spent_cents: 120000 },
      { category_id: 2, category_name: "Food", spent_cents: 35000 },
      { category_id: 3, category_name: "Entertainment", spent_cents: 15000 },
      { category_id: 4, category_name: "Transport", spent_cents: 5000 },
    ];

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: (cmd: string) => {
        switch (cmd) {
          case "get_budget_summary":
            return Promise.resolve(summary);
          case "get_top_budget_categories":
            return Promise.resolve(categories);
          case "get_current_net_worth":
            return Promise.resolve(netWorth);
          case "get_recent_net_worth_snapshots":
            return Promise.resolve(snapshots);
          case "get_spending_breakdown":
            return Promise.resolve(spendingBreakdown);
          case "get_yearly_summary":
            return Promise.resolve(yearlyMock);
          default:
            return Promise.resolve(null);
        }
      },
    };
  }, yearlySummaryMock);
}

test.describe("Dashboard — Story 5.1", () => {
  test("is the landing page when the app opens (route is /)", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");
    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: "Dashboard" })
    ).toBeVisible();
  });

  test("Budget Remaining hero card is visible with formatted dollar amount", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    const metricValues = page.getByTestId("metric-value");
    // Budget Remaining is the second hero card
    await expect(metricValues.nth(1)).toContainText("$1,250.00");
  });

  test("Budget category rows with progress bars are displayed", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    const categoryRows = page.getByTestId("dashboard-category-row");
    await expect(categoryRows).toHaveCount(4);

    const firstRow = categoryRows.first();
    await expect(firstRow).toContainText("Housing");
    await expect(firstRow.getByTestId("category-amount")).toContainText(
      "$1,200.00 / $1,500.00"
    );
    await expect(firstRow.getByRole("progressbar")).toBeVisible();
  });

  test("Import Statement button is visible in the page header", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    const importBtn = page.getByTestId("import-statement-btn");
    await expect(importBtn).toBeVisible();
    await expect(importBtn).toContainText("Import Statement");
  });

  test("Skeleton loading states appear before data renders", async ({
    page,
  }) => {
    await page.addInitScript((mock) => {
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        invoke: (cmd: string) => {
          switch (cmd) {
            case "get_budget_summary":
              return new Promise((resolve) =>
                setTimeout(
                  () =>
                    resolve({
                      total_target_cents: 100000,
                      total_spent_cents: 50000,
                      remaining_cents: 50000,
                      month: "2026-03",
                    }),
                  500
                )
              );
            case "get_current_net_worth":
              return new Promise((resolve) =>
                setTimeout(
                  () =>
                    resolve({
                      total_cents: 100000,
                      cash_cents: 50000,
                      investments_cents: 30000,
                      assets_cents: 20000,
                    }),
                  500
                )
              );
            case "get_top_budget_categories":
            case "get_recent_net_worth_snapshots":
            case "get_spending_breakdown":
              return new Promise((resolve) =>
                setTimeout(() => resolve([]), 500)
              );
            case "get_yearly_summary":
              return new Promise((resolve) =>
                setTimeout(() => resolve(mock), 500)
              );
            default:
              return Promise.resolve(null);
          }
        },
      };
    }, yearlySummaryMock);

    await page.goto("/");

    const skeleton = page.getByTestId("metric-card-skeleton");
    await expect(skeleton.first()).toBeVisible();

    await expect(page.getByTestId("metric-value").first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("With empty database, empty state message and action link are visible", async ({
    page,
  }) => {
    await setupEmptyDashboardMock(page);
    await page.goto("/");

    const emptyState = page.getByTestId("empty-budget");
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText(
      "No budget yet. Create your first budget."
    );

    const budgetLink = page.getByTestId("create-budget-link");
    await expect(budgetLink).toBeVisible();
  });

  test("Budget Remaining hero card shows overall progress bar", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    const overallProgress = page.getByTestId("budget-overall-progress");
    await expect(overallProgress).toBeVisible();
  });

  test("Category status badges display correct status", async ({ page }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    const badges = page.getByTestId("category-badge");
    await expect(badges.first()).toContainText("Warning");
    await expect(badges.nth(1)).toContainText("On track");
  });
});

test.describe("Dashboard — Story 5.2", () => {
  test("Net Worth hero card displays with formatted dollar amount", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    // Net Worth is the first hero card
    const metricValues = page.getByTestId("metric-value");
    await expect(metricValues.first()).toContainText("$525,000.00");
  });

  test("3 secondary cards (Cash, Investments, Assets) are visible with values", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    const cards = page.getByTestId("metric-card");
    // 2 hero + 3 secondary = 5 total metric cards
    await expect(cards).toHaveCount(5);

    // Check secondary card values
    const values = page.getByTestId("metric-value");
    // 0: Net Worth hero, 1: Budget hero, 2: Cash, 3: Investments, 4: Assets
    await expect(values.nth(2)).toContainText("$15,000.00"); // Cash
    await expect(values.nth(3)).toContainText("$250,000.00"); // Investments
    await expect(values.nth(4)).toContainText("$260,000.00"); // Assets
  });

  test("Spending breakdown section shows expense categories", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    const breakdown = page.getByTestId("spending-breakdown");
    await expect(breakdown).toBeVisible();

    const rows = page.getByTestId("spending-row");
    await expect(rows).toHaveCount(4);

    await expect(rows.first()).toContainText("Housing");
    await expect(rows.first()).toContainText("$1,200.00");
  });

  test("Dashboard uses 2-column hero layout", async ({ page }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    // Both hero cards should be visible
    const heroCards = page.getByTestId("metric-card");
    await expect(heroCards.first()).toBeVisible();
    await expect(heroCards.nth(1)).toBeVisible();
  });

  test("Clicking Net Worth hero card navigates to Net Worth page", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    const netWorthCard = page.getByTestId("metric-card").first();
    await netWorthCard.click();
    await expect(page).toHaveURL(/\/net-worth/);
  });

  test("Clicking Budget Remaining hero card navigates to Budget page", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    const budgetCard = page.getByTestId("metric-card").nth(1);
    await budgetCard.click();
    await expect(page).toHaveURL(/\/budget/);
  });
});

test.describe("Dashboard — Year to Date Card", () => {
  test("YTD card renders spent, gain, and top categories", async ({ page }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    const ytdCard = page.getByTestId("ytd-card");
    await expect(ytdCard).toBeVisible();
    await expect(page.getByTestId("ytd-spent")).toContainText("$4,500.00");
    await expect(page.getByTestId("ytd-gain")).toContainText("$25,000.00");
    await expect(page.getByTestId("ytd-top-categories")).toContainText("Housing");
  });

  test("YTD card shows empty state when no year spending", async ({ page }) => {
    await setupEmptyDashboardMock(page);
    await page.goto("/");

    await expect(page.getByTestId("ytd-card-empty")).toBeVisible();
    await expect(page.getByTestId("ytd-card-empty")).toContainText(
      "No spending recorded yet this year."
    );
  });

  test("clicking YTD card navigates to year summary page", async ({ page }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    await page.getByTestId("ytd-card").click();
    await expect(page).toHaveURL(/\/year-summary/);
  });
});
