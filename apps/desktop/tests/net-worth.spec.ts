import { test, expect, type Page } from "@playwright/test";

async function setupEmptyNetWorthMock(page: Page) {
  await page.addInitScript(() => {
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
          default:
            return Promise.resolve(null);
        }
      },
    };
  });
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

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: (cmd: string) => {
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

    await expect(page.getByTestId("period-tab-6m")).toContainText("6M");
    await expect(page.getByTestId("period-tab-1y")).toContainText("1Y");
    await expect(page.getByTestId("period-tab-all")).toContainText("ALL");
  });

  test("clicking a different period tab updates chart", async ({ page }) => {
    await setupSeededNetWorthMock(page);
    await page.goto("/net-worth");

    // Default is 1Y
    const tab6m = page.getByTestId("period-tab-6m");
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
});
