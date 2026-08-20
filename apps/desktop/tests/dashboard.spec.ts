import { test, expect, type Locator, type Page } from "@playwright/test";

// Hero-row position is not a contract; card identity is. Scoping by the card's own label is what
// keeps these tests honest about which figure they are reading after the row order changed.
function metricCard(page: Page, label: string): Locator {
  return page.getByTestId("metric-card").filter({ hasText: label });
}

// The largest computed font size inside a figure block is the figure itself. Read from computed
// style rather than from a class name so the assertion survives a token rename.
function figureSize(figure: Locator): Promise<number> {
  return figure.evaluate((el) =>
    Math.max(
      parseFloat(getComputedStyle(el).fontSize),
      ...Array.from(el.querySelectorAll("*"), (node) =>
        parseFloat(getComputedStyle(node).fontSize)
      )
    )
  );
}

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

const financialHealthInsufficientMock = {
  data_sufficient: false,
  emergency_fund: null,
  savings: null,
  waterfall: {
    current_step: "build_emergency_fund" as const,
    action_line_key: "build_emergency_fund",
  },
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
  // addInitScript takes a single argument, so the two mocks travel as one object. Passing them as
  // two arguments silently dropped the second, and get_financial_health_summary resolved undefined.
  await page.addInitScript(
    ({ yearlyMock, healthMock }) => {
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        invoke: (cmd: string) => {
          switch (cmd) {
            case "check_picker_gate":
              return Promise.resolve({ needs_picker: false });
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
            case "get_financial_health_summary":
              return Promise.resolve(healthMock);
            case "get_latest_expense":
              return Promise.resolve(null);
            case "get_savings_projects_summary":
              return Promise.resolve({
                active_project_count: 0,
                total_saved_cents: 0,
                total_target_cents: 0,
              });
            default:
              return Promise.resolve(null);
          }
        },
      };
    },
    {
      yearlyMock: emptyYearlySummaryMock,
      healthMock: financialHealthInsufficientMock,
    }
  );
}

async function setupSeededDashboardMock(page: Page) {
  await page.addInitScript((yearlyMock) => {
    const latestExpense = {
      id: 99,
      merchant: "Costco",
      amount_cents: 4500,
      budget_category_id: 1,
      account_id: null,
      date: "2026-03-20",
      source: "manual",
      created_at: "2026-03-20T12:00:00.000Z",
    };
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
          case "check_picker_gate":
            return Promise.resolve({ needs_picker: false });
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
          case "get_income_total":
            return Promise.resolve({ total_cents: 210000 });
          case "get_financial_health_summary":
            return Promise.resolve({
              data_sufficient: true,
              emergency_fund: {
                coverage_months: 2.4,
                target_months: 6,
                progress_ratio: 0.4,
                status: "underfunded",
              },
              savings: {
                savings_rate_percent: 14,
                avg_monthly_surplus_cents: 62000,
              },
              waterfall: {
                current_step: "build_emergency_fund",
                action_line_key: "build_emergency_fund",
              },
            });
          case "get_latest_expense":
            return Promise.resolve(latestExpense);
          case "get_savings_projects_summary":
            return Promise.resolve({
              active_project_count: 0,
              total_saved_cents: 0,
              total_target_cents: 0,
            });
          default:
            return Promise.resolve(null);
        }
      },
    };
  }, yearlySummaryMock);
}

// Over target, exactly at target, and under target — the three states that replaced the deleted
// ">=75% is a Warning" rule.
async function setupPacingDashboardMock(page: Page) {
  await page.addInitScript((yearlyMock) => {
    const categories = [
      {
        id: 1,
        name: "Groceries",
        group_name: "Essentials",
        target_cents: 40000,
        spent_cents: 46000,
        percentage: 115.0,
      },
      {
        id: 2,
        name: "Mortgage",
        group_name: "Essentials",
        target_cents: 165000,
        spent_cents: 165000,
        percentage: 100.0,
      },
      {
        id: 3,
        name: "Transport",
        group_name: "Essentials",
        target_cents: 20000,
        spent_cents: 11200,
        percentage: 56.0,
      },
    ];

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: (cmd: string) => {
        switch (cmd) {
          case "check_picker_gate":
            return Promise.resolve({ needs_picker: false });
          case "get_budget_summary":
            return Promise.resolve({
              total_target_cents: 225000,
              total_spent_cents: 222200,
              remaining_cents: 2800,
              month: "2026-03",
            });
          case "get_top_budget_categories":
            return Promise.resolve(categories);
          case "get_current_net_worth":
            return Promise.resolve({
              total_cents: 52500000,
              cash_cents: 1500000,
              investments_cents: 25000000,
              assets_cents: 26000000,
            });
          case "get_recent_net_worth_snapshots":
            return Promise.resolve([]);
          case "get_spending_breakdown":
            return Promise.resolve([]);
          case "get_yearly_summary":
            return Promise.resolve(yearlyMock);
          case "get_financial_health_summary":
            return Promise.resolve(null);
          case "get_latest_expense":
            return Promise.resolve(null);
          case "get_savings_projects_summary":
            return Promise.resolve({
              active_project_count: 0,
              total_saved_cents: 0,
              total_target_cents: 0,
            });
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
    // The Finance module's landing surface is "Today". "Dashboard" survives only as the CAR
    // module's sub-nav label, so it must not appear as this surface's heading.
    await expect(
      page.getByRole("heading", { name: "Today", exact: true })
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toHaveCount(0);
  });

  test("Budget Remaining is the surface's single display figure", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    const hero = metricCard(page, "Budget Remaining").getByTestId("metric-value");
    await expect(hero).toContainText("$1,250.00");
    // Exactly one 34px figure on `/`: two competing display figures mean neither is the answer to
    // the surface's question.
    expect(await figureSize(hero)).toBe(34);
    const allFigures = await page.getByTestId("metric-value").all();
    const displaySized = await Promise.all(allFigures.map(figureSize));
    expect(displaySized.filter((size) => size === 34)).toHaveLength(1);
  });

  test("Budget category rows announce as one sentence with a status dot", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    const categoryRows = page.getByTestId("dashboard-category-row");
    await expect(categoryRows).toHaveCount(4);

    const firstRow = categoryRows.first();
    // AttentionRow replaced the per-row progress bar: the visible figure is the spend, the target
    // and remainder are carried by the row's one accessible sentence, and pacing by the dot.
    await expect(firstRow.getByTestId("category-amount")).toHaveText("$1,200.00");
    await expect(firstRow).toContainText(
      "Housing, $1,200.00 of $1,500.00 spent, $300.00 left"
    );
    await expect(firstRow.locator("[data-slot='status-dot']")).toHaveAttribute(
      "data-status",
      "good"
    );
    await expect(firstRow.getByRole("progressbar")).toHaveCount(0);
  });

  test("Import Statement button is visible in the page header", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    const importBtn = page.getByTestId("import-statement-btn");
    await expect(importBtn).toBeVisible();
    await expect(importBtn).toContainText("Import Statement");

    // The Sparkles icon is decorative: hidden from assistive tech, leading the label.
    const icon = importBtn.locator("svg.lucide-sparkles");
    await expect(icon).toHaveCount(1);
    await expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(
      await importBtn.evaluate(
        (el) => el.firstElementChild?.matches("svg.lucide-sparkles") ?? false
      )
    ).toBe(true);
  });

  test("Skeleton loading states appear before data renders", async ({
    page,
  }) => {
    await page.addInitScript((mock) => {
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        invoke: (cmd: string) => {
          switch (cmd) {
            case "check_picker_gate":
              return Promise.resolve({ needs_picker: false });
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
            case "get_financial_health_summary":
              return new Promise((resolve) =>
                setTimeout(
                  () =>
                    resolve({
                      data_sufficient: true,
                      emergency_fund: {
                        coverage_months: 2.4,
                        target_months: 6,
                        progress_ratio: 0.4,
                        status: "underfunded",
                      },
                      savings: {
                        savings_rate_percent: 14,
                        avg_monthly_surplus_cents: 62000,
                      },
                      waterfall: {
                        current_step: "build_emergency_fund",
                        action_line_key: "build_emergency_fund",
                      },
                    }),
                  500
                )
              );
            case "get_latest_expense":
              return new Promise((resolve) =>
                setTimeout(() => resolve(null), 500)
              );
            case "get_savings_projects_summary":
              return Promise.resolve({
                active_project_count: 0,
                total_saved_cents: 0,
                total_target_cents: 0,
              });
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

  test("Category badges name the amount for over, at, and under target", async ({
    page,
  }) => {
    await setupPacingDashboardMock(page);
    await page.goto("/");

    const rows = page.getByTestId("dashboard-category-row");
    await expect(rows).toHaveCount(3);

    const badgeFor = (name: string) =>
      rows.filter({ hasText: name }).getByTestId("category-badge");
    const dotFor = (name: string) =>
      rows.filter({ hasText: name }).locator("[data-slot='status-dot']");

    await expect(badgeFor("Groceries")).toHaveText("Over by $60.00");
    await expect(dotFor("Groceries")).toHaveAttribute("data-status", "over");

    // The deleted ">=75% is a Warning" rule read a mortgage at exactly $1,650/$1,650 as a problem.
    // A commitment that has simply been met is neutral.
    await expect(badgeFor("Mortgage")).toHaveText("Fully spent");
    await expect(dotFor("Mortgage")).toHaveAttribute("data-status", "neutral");

    await expect(badgeFor("Transport")).toHaveText("$88.00 left");
    await expect(dotFor("Transport")).toHaveAttribute("data-status", "good");

    // Every badge carries a figure; none is a bare adjective.
    for (const bareAdjective of ["Warning", "On track"]) {
      await expect(
        page.getByTestId("category-badge").filter({ hasText: bareAdjective })
      ).toHaveCount(0);
    }
  });
});

test.describe("Dashboard — Story 5.2", () => {
  test("Net worth is a secondary figure, not a second hero", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    const netWorth = metricCard(page, "Net worth").getByTestId("metric-value");
    await expect(netWorth).toContainText("$525,000.00");

    // Net worth was demoted from a 34px hero to a 26px secondary figure so that budget remaining
    // is the only number answering "am I OK this month?".
    const heroSize = await figureSize(
      metricCard(page, "Budget Remaining").getByTestId("metric-value")
    );
    expect(await figureSize(netWorth)).toBe(26);
    expect(await figureSize(netWorth)).toBeLessThan(heroSize);
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
    // 0: Budget hero, 1: Net worth, 2: Cash, 3: Investments, 4: Assets
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

  test("hero row carries the budget figure, cash flow, and the next-step card", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    // The hero row is three cards wide now, and the next-action card is the only 3px brand
    // left-border on the surface.
    await expect(metricCard(page, "Budget Remaining")).toBeVisible();
    await expect(page.getByTestId("cash-flow-card")).toBeVisible();
    await expect(page.getByTestId("financial-health-card")).toBeVisible();
  });

  test("Clicking the Net worth card navigates to the Net worth surface", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    await metricCard(page, "Net worth").click();
    await expect(page).toHaveURL(/\/wealth\/net-worth/);
  });

  test("Clicking the Budget Remaining card navigates to the Budget surface", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    await metricCard(page, "Budget Remaining").click();
    await expect(page).toHaveURL(/\/spending\/budget/);
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
    await expect(page).toHaveURL(/\/insights\/year-summary/);
  });
});

test.describe("Dashboard — Suggested Next Step Card", () => {
  test("card names the action and the figures behind it", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    const card = page.getByTestId("financial-health-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Suggested next step");
    // No user-facing string says "Financial Health" any more, and "View details →" was replaced by
    // a link that says what it opens.
    await expect(card).not.toContainText("Financial Health");
    await expect(card).not.toContainText("View details");
    await expect(
      card.getByRole("button", { name: "See the plan" })
    ).toBeVisible();

    await expect(page.getByTestId("financial-health-action")).toHaveText(
      "Build your emergency fund"
    );
    await expect(page.getByTestId("financial-health-months")).toHaveText(
      "You have 2.4 months of spending covered — you're aiming for 6."
    );
    // Rate and surplus are one sentence now, not two standalone figures in a three-column grid.
    await expect(page.getByTestId("financial-health-savings-rate")).toHaveText(
      "You're keeping 14% of what you earn — about $620.00 left over in a typical month."
    );

    // The full disclaimer expands on demand: stacking a complete hedge beside the very first
    // recommendation a user ever receives reads as the app retracting itself.
    await expect(page.getByTestId("financial-health-disclaimer")).toHaveCount(0);
    await page.getByTestId("financial-health-disclaimer-toggle").click();
    await expect(page.getByTestId("financial-health-disclaimer")).toContainText(
      "This isn't financial advice."
    );
  });

  test("financial health card shows skeleton while loading", async ({
    page,
  }) => {
    await page.addInitScript((yearlyMock) => {
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        invoke: (cmd: string) => {
          switch (cmd) {
            case "check_picker_gate":
              return Promise.resolve({ needs_picker: false });
            case "get_financial_health_summary":
              return new Promise((resolve) =>
                setTimeout(
                  () =>
                    resolve({
                      data_sufficient: true,
                      emergency_fund: {
                        coverage_months: 2.4,
                        target_months: 6,
                        progress_ratio: 0.4,
                        status: "underfunded",
                      },
                      savings: {
                        savings_rate_percent: 14,
                        avg_monthly_surplus_cents: 62000,
                      },
                      waterfall: {
                        current_step: "build_emergency_fund",
                        action_line_key: "build_emergency_fund",
                      },
                    }),
                  500
                )
              );
            case "get_budget_summary":
              return Promise.resolve({
                total_target_cents: 0,
                total_spent_cents: 0,
                remaining_cents: 0,
                month: "2026-03",
              });
            case "get_yearly_summary":
              return Promise.resolve(yearlyMock);
            case "get_latest_expense":
              return Promise.resolve(null);
            case "get_savings_projects_summary":
              return Promise.resolve({
                active_project_count: 0,
                total_saved_cents: 0,
                total_target_cents: 0,
              });
            default:
              return Promise.resolve(null);
          }
        },
      };
    }, yearlySummaryMock);

    await page.goto("/");

    await expect(
      page.getByTestId("financial-health-skeleton")
    ).toBeVisible();
    await expect(page.getByTestId("financial-health-card")).toBeVisible({
      timeout: 5000,
    });
  });

  test("card shows the wait-for-data state without inventing a month count", async ({
    page,
  }) => {
    await setupEmptyDashboardMock(page);
    await page.goto("/");

    const empty = page.getByTestId("financial-health-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("Come back in a couple of months");
    await expect(empty).toContainText(
      "To suggest what to do next, Nixus needs about three finished months of spending to see a pattern."
    );
    // get_financial_health_summary carries no completed-month count, so this card cannot honestly
    // show the "n of 3 months" indicator that the Where-to-put-your-money surface can.
    await expect(empty).not.toContainText("of 3 months");
    await expect(
      empty.getByTestId("financial-health-months-progress")
    ).toHaveCount(0);
  });

  test("card is placed above top categories", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    const healthCard = page.getByTestId("financial-health-card");
    const topCategories = page.getByTestId("top-categories");
    await expect(healthCard).toBeVisible();
    await expect(topCategories).toBeVisible();

    const healthBox = await healthCard.boundingBox();
    const categoriesBox = await topCategories.boundingBox();
    expect(healthBox).not.toBeNull();
    expect(categoriesBox).not.toBeNull();
    expect(healthBox!.y).toBeLessThan(categoriesBox!.y);
  });

  test("the card's one link opens the Where to put your money surface", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    // The whole card is no longer a click target; the action-card carries one explicit link.
    await page
      .getByTestId("financial-health-card")
      .getByRole("button", { name: "See the plan" })
      .click();
    await expect(page).toHaveURL(/\/wealth\/where-to-put-your-money/);
  });
});

test.describe("Dashboard — Last Expense Line", () => {
  test("empty dashboard shows no expenses yet", async ({ page }) => {
    await setupEmptyDashboardMock(page);
    await page.goto("/");

    const line = page.getByTestId("last-expense-line");
    await expect(line).toBeVisible();
    await expect(line).toContainText("No expenses yet");
    await expect(line).not.toContainText("Import your first CC statement");
  });

  test("seeded dashboard shows latest expense merchant and amount", async ({
    page,
  }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    const line = page.getByTestId("last-expense-line");
    await expect(line).toBeVisible();
    await expect(line).toContainText("Costco");
    await expect(line).toContainText("$45.00");
    await expect(line).toContainText("Mar 20, 2026");
  });

  test("last expense line is display-only", async ({ page }) => {
    await setupSeededDashboardMock(page);
    await page.goto("/");

    const line = page.getByTestId("last-expense-line");
    await expect(line).toBeVisible();
    await expect(line).not.toHaveRole("link");
    await expect(line).not.toHaveRole("button");
  });
});

async function setupSavingsDashboardMock(
  page: Page,
  savingsMock: {
    active_project_count: number;
    total_saved_cents: number;
    total_target_cents: number;
  }
) {
  // Single-object argument for the same reason as setupEmptyDashboardMock: a second addInitScript
  // argument is silently dropped.
  await page.addInitScript(
    ({ yearlyMock, healthMock, savings }) => {
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        invoke: (cmd: string) => {
          switch (cmd) {
            case "check_picker_gate":
              return Promise.resolve({ needs_picker: false });
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
            case "get_financial_health_summary":
              return Promise.resolve(healthMock);
            case "get_latest_expense":
              return Promise.resolve(null);
            case "get_savings_projects_summary":
              return Promise.resolve(savings);
            default:
              return Promise.resolve(null);
          }
        },
      };
    },
    {
      yearlyMock: emptyYearlySummaryMock,
      healthMock: financialHealthInsufficientMock,
      savings: savingsMock,
    }
  );
}

test.describe("Dashboard — Saved toward goals card", () => {
  const label = "Saved toward goals";

  test("card shows the total saved across active projects", async ({ page }) => {
    await setupSavingsDashboardMock(page, {
      active_project_count: 2,
      total_saved_cents: 450000,
      total_target_cents: 1000000,
    });
    await page.goto("/");

    const card = metricCard(page, label);
    await expect(card).toBeVisible();
    await expect(card).toContainText("$4,500.00");
    // A secondary figure, never the surface's single text-display one.
    const hero = metricCard(page, "Budget remaining");
    await expect(hero).toHaveCount(0);
    await expect(card.getByTestId("savings-projects-progress")).toHaveAttribute(
      "aria-valuetext",
      "$4,500.00 of $10,000.00 across 2 goals"
    );
  });

  test("card links to the projects surface", async ({ page }) => {
    await setupSavingsDashboardMock(page, {
      active_project_count: 1,
      total_saved_cents: 25000,
      total_target_cents: 100000,
    });
    await page.goto("/");

    await metricCard(page, label).click();
    await expect(page).toHaveURL(/\/wealth\/projects/);
  });

  test("card still renders at zero saved when a goal exists", async ({
    page,
  }) => {
    await setupSavingsDashboardMock(page, {
      active_project_count: 1,
      total_saved_cents: 0,
      total_target_cents: 500000,
    });
    await page.goto("/");

    await expect(metricCard(page, label)).toContainText("$0.00");
  });

  test("no card at all when there are no active projects", async ({ page }) => {
    await setupSavingsDashboardMock(page, {
      active_project_count: 0,
      total_saved_cents: 0,
      total_target_cents: 0,
    });
    await page.goto("/");

    // The other secondary cards prove the surface rendered before asserting an absence.
    await expect(metricCard(page, "Cash")).toBeVisible();
    await expect(metricCard(page, label)).toHaveCount(0);
  });
});
