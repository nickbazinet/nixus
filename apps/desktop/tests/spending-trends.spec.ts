import { test, expect, type Page } from "@playwright/test";

interface MockOptions {
  aiConfigured?: boolean;
  insightDelayMs?: number;
  insightError?: boolean;
  insightNotConfigured?: boolean;
}

async function setupSpendingTrendsMock(
  page: Page,
  options: MockOptions = {},
) {
  const {
    aiConfigured = true,
    insightDelayMs = 0,
    insightError = false,
    insightNotConfigured = false,
  } = options;

  let insightCalls = 0;
  let lastInsightMonths: number | null = null;

  await page.addInitScript(
    ({ aiConfigured, insightDelayMs, insightError, insightNotConfigured }) => {
      let currentMonths = 6;

      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args?: { months?: number }) => {
          switch (cmd) {
            case "get_spending_trends": {
              currentMonths = args?.months ?? 6;
              const totals = Array.from({ length: currentMonths }, (_, i) => ({
                month: `2026-${String(i + 1).padStart(2, "0")}`,
                total_cents: 80000 + i * 1000,
              }));
              return Promise.resolve({
                by_category: [
                  {
                    month: "2026-01",
                    category_id: 1,
                    category_name: "Food",
                    spent_cents: 90000,
                  },
                  {
                    month: "2026-01",
                    category_id: 2,
                    category_name: "Transport",
                    spent_cents: 124000,
                  },
                ],
                totals,
                category_compare: [
                  {
                    category_id: 1,
                    category_name: "Food",
                    avg_cents: 45000,
                    target_cents: 50000,
                    delta_pct: -10,
                    status: "on_track",
                  },
                  {
                    category_id: 2,
                    category_name: "Transport",
                    avg_cents: 62000,
                    target_cents: 40000,
                    delta_pct: 55,
                    status: "over",
                  },
                ],
              });
            }
            case "get_ai_config":
              return Promise.resolve({
                provider: "bedrock",
                configured: aiConfigured,
                region: "us-east-1",
              });
            case "generate_trends_insight": {
              const requestedMonths = args?.months ?? currentMonths;
              (window as unknown as Record<string, number>).__insightCalls =
                ((window as unknown as Record<string, number>).__insightCalls ?? 0) + 1;
              (window as unknown as Record<string, number | null>).__lastInsightMonths =
                requestedMonths;

              if (insightNotConfigured) {
                return Promise.reject({
                  type: "not_configured",
                  message: "AI provider not configured",
                  setup_url: "/settings",
                });
              }

              if (insightError) {
                return Promise.reject({
                  type: "ai_service",
                  message: "Service unavailable",
                  recoverable: true,
                });
              }

              const resolveInsight = () =>
                Promise.resolve({
                  headline: `Insight for ${requestedMonths} months`,
                  body: "Food is on track while Transport is over budget.",
                  tone: "caution",
                  window_label: `${requestedMonths} months`,
                });

              if (insightDelayMs > 0) {
                return new Promise((resolve) => {
                  setTimeout(() => resolve(resolveInsight()), insightDelayMs);
                });
              }
              return resolveInsight();
            }
            default:
              return Promise.resolve(null);
          }
        },
      };
    },
    { aiConfigured, insightDelayMs, insightError, insightNotConfigured },
  );

  await page.exposeFunction("__getInsightCalls", () => insightCalls);
  await page.exposeFunction("__setInsightCalls", (n: number) => {
    insightCalls = n;
  });

  page.on("console", () => {});

  return {
    getInsightCalls: async () =>
      page.evaluate(
        () =>
          (window as unknown as Record<string, number>).__insightCalls ?? 0,
      ),
    getLastInsightMonths: async () =>
      page.evaluate(
        () =>
          (window as unknown as Record<string, number | null>).__lastInsightMonths ??
          null,
      ),
  };
}

test.describe("Spending Trends — budget compare + AI insight", () => {
  test("renders compare table columns from category_compare", async ({ page }) => {
    await setupSpendingTrendsMock(page);
    await page.goto("/insights/trends");

    await expect(page.getByRole("heading", { name: "Trends" })).toBeVisible();
    await expect(page.getByTestId("category-spend-table")).toBeVisible();

    const rows = page.getByTestId("category-compare-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Food");
    await expect(rows.first()).toContainText("$450.00");
    await expect(rows.first()).toContainText("$500.00");
    await expect(rows.first().getByTestId("category-status-badge")).toContainText(
      "On track",
    );
    await expect(rows.nth(1).getByTestId("category-status-badge")).toContainText(
      "Over",
    );
  });

  test("shows AI insight after load without blocking chart and table", async ({
    page,
  }) => {
    const mock = await setupSpendingTrendsMock(page, { insightDelayMs: 300 });
    await page.goto("/insights/trends");

    await expect(page.getByTestId("category-spend-table")).toBeVisible();
    await expect(page.getByText("Average Monthly Spend")).toBeVisible();

    await expect(page.getByTestId("trends-insight-skeleton")).toBeVisible();

    await expect(page.getByTestId("trends-insight-panel")).toContainText(
      "Insight for 6 months",
      { timeout: 5000 },
    );
    await expect(page.getByTestId("trends-insight-panel")).toContainText(
      "Food is on track",
    );

    expect(await mock.getInsightCalls()).toBe(1);
  });

  test("does not invoke insight when AI is not configured", async ({ page }) => {
    const mock = await setupSpendingTrendsMock(page, { aiConfigured: false });
    await page.goto("/insights/trends");

    await expect(page.getByTestId("trends-insight-panel")).toBeVisible();
    await expect(page.getByTestId("trends-insight-settings-link")).toBeVisible();
    await expect(page.getByTestId("category-spend-table")).toBeVisible();

    await page.waitForTimeout(500);
    expect(await mock.getInsightCalls()).toBe(0);
  });

  test("shows soft error with retry on insight failure", async ({ page }) => {
    await setupSpendingTrendsMock(page, { insightError: true });
    await page.goto("/insights/trends");

    await expect(page.getByTestId("trends-insight-error")).toBeVisible();
    await expect(page.getByTestId("trends-insight-retry")).toBeVisible();
    await expect(page.getByTestId("category-spend-table")).toBeVisible();
  });

  test("window switch shows insight for current window only", async ({ page }) => {
    const mock = await setupSpendingTrendsMock(page);
    await page.goto("/insights/trends");

    await expect(page.getByTestId("trends-insight-panel")).toContainText(
      "Insight for 6 months",
    );

    await page.getByRole("button", { name: "3M" }).click();

    await expect(page.getByTestId("trends-insight-panel")).toContainText(
      "Insight for 3 months",
      { timeout: 5000 },
    );

    expect(await mock.getLastInsightMonths()).toBe(3);
  });
});
