import { test, expect, type Page } from "@playwright/test";

const CATEGORIES = [
  { id: 1, name: "Groceries", group_name: "Everyday", target_cents: 55000, spent_cents: 51240, percentage: 93.2 },
  { id: 2, name: "Restaurants", group_name: "Everyday", target_cents: 25000, spent_cents: 33600, percentage: 134.4 },
  { id: 3, name: "Mortgage", group_name: "Home", target_cents: 165000, spent_cents: 165000, percentage: 100 },
];
const EXPENSES = Array.from({ length: 9 }, (_v, i) => ({
  id: i + 1,
  merchant: ["METRO PLUS 4471", "METRO ETS 8812", "TIM HORTONS"][i % 3],
  amount_cents: 3120 + i * 977,
  budget_category_id: (i % 3) + 1,
  account_id: i % 2 === 0 ? 1 : null,
  date: `2026-03-${String(i + 2).padStart(2, "0")}`,
  source: i % 2 === 0 ? "manual" : "import",
  created_at: "2026-03-02T12:00:00.000Z",
}));

async function mock(page: Page) {
  await page.addInitScript((data) => {
    // The event plugin keeps its own internals object; unlisten() reaches into it on cleanup.
    (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      // Real Tauri exposes this; event.listen() calls it, and without it every listener throws.
      transformCallback: (cb: unknown) => {
        const id = Math.floor(Math.random() * 1e9);
        (window as unknown as Record<string, unknown>)[`_${id}`] = cb;
        return id;
      },
      invoke: (cmd: string) => {
        // Tauri plugins must answer with their real contract. The updater returning a truthy
        // value opens an always-modal dialog that aria-hidden()s the entire app.
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);
        switch (cmd) {
          case "get_budget_summary":
            return Promise.resolve({ total_target_cents: 300000, total_spent_cents: 249840, remaining_cents: 50160, month: "2026-03" });
          case "get_top_budget_categories":
          case "get_budget_status":
            return Promise.resolve(data.categories);
          case "get_budget_groups":
            return Promise.resolve([{ id: 1, name: "Everyday", sort_order: 0, created_at: "" }, { id: 2, name: "Home", sort_order: 1, created_at: "" }]);
          case "get_expenses":
            return Promise.resolve(data.expenses);
          case "get_all_budget_categories":
          case "get_budget_categories":
            return Promise.resolve(data.categories);
          case "get_accounts":
            return Promise.resolve([{ id: 1, name: "Chequing", institution: "RBC", account_type: "chequing", currency: "CAD", balance_cents: 872000, updated_at: "2026-03-01T00:00:00Z" }]);
          case "get_assets":
            return Promise.resolve([]);
          case "get_current_net_worth":
            return Promise.resolve({ total_cents: 4210000, cash_cents: 1432000, investments_cents: 1978000, assets_cents: 800000 });
          case "get_recent_net_worth_snapshots":
            return Promise.resolve([]);
          case "get_spending_breakdown":
            return Promise.resolve(data.categories.map((c: { id: number; name: string; spent_cents: number }) => ({ category_id: c.id, category_name: c.name, spent_cents: c.spent_cents })));
          case "get_income_total":
            return Promise.resolve({ total_cents: 520000 });
          case "get_income_sources":
          case "get_income_entries":
          case "get_recurring_templates":
            return Promise.resolve([]);
          case "get_yearly_summary":
            return Promise.resolve({ year: 2026, is_current_year: true, total_spent_cents: 749520, total_income_cents: 1560000, cash_flow_net_cents: 810480, net_worth_gain_cents: 250000, net_worth_gain_available: true, top_categories: [], monthly_totals: [], all_categories: [], available_years: [2026] });
          case "get_financial_health_summary":
          case "get_financial_health_detail":
            return Promise.resolve({ data_sufficient: false, emergency_fund: null, savings: null, waterfall: { current_step: "build_emergency_fund", action_line_key: "build_emergency_fund" }, figures: { expense_month_count: 1 } });
          case "get_latest_expense":
            return Promise.resolve(data.expenses[0]);
          case "get_onboarding_status":
            return Promise.resolve({ has_budget: true, has_accounts: true, has_assets: true, has_income: true });
          case "get_projection_input":
            return Promise.resolve({
              account_balances: [
                { account_type: "chequing", balance_cents: 872000 },
                { account_type: "tfsa", balance_cents: 1978000 },
              ],
              asset_values: [{ asset_type: "real_estate", value_cents: 800000 }],
              avg_monthly_income_cents: 520000,
              avg_monthly_expense_cents: 249840,
              income_month_count: 5,
              expense_month_count: 5,
            });
          case "get_spending_trends":
          case "get_category_compare":
            return Promise.resolve([]);
          default:
            return Promise.resolve([]);
        }
      },
    };
  }, { categories: CATEGORIES, expenses: EXPENSES });
}

const SURFACES = [
  ["today", "/"],
  ["spending-budget", "/spending/budget"],
  ["spending-transactions", "/spending/transactions"],
  ["spending-income", "/spending/income"],
  ["spending-recurring", "/spending/recurring"],
  ["wealth-accounts", "/wealth/accounts"],
  ["wealth-assets", "/wealth/assets"],
  ["wealth-networth", "/wealth/net-worth"],
  ["wealth-where", "/wealth/where-to-put-your-money"],
  ["insights-trends", "/insights/trends"],
  ["insights-year", "/insights/year-summary"],
  ["insights-projection", "/insights/projection"],
] as const;

for (const [mode, dark] of [["light", false], ["dark", true]] as const) {
  for (const [size, w, h] of [["1280x800", 1280, 800], ["1024x680", 1024, 680]] as const) {
    test(`${mode} ${size}`, async ({ page }) => {
      await mock(page);
      await page.setViewportSize({ width: w, height: h });
      const problems: string[] = [];
      let current = "";
      page.on("console", async (m) => {
        if (m.type() !== "error") return;
        const parts = await Promise.all(m.args().map((a) => a.jsonValue().catch(() => "<unserializable>")));
        problems.push(`[${current}] ${parts.map((p) => String(p)).join(" ")}`.slice(0, 400));
      });

      for (const [name, path] of SURFACES) {
        current = name;
        await page.goto(path);
        if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
        await page.waitForLoadState("networkidle");
        await page.screenshot({ path: `test-results/qa/${mode}-${size}-${name}.png` });
      }
      expect(problems, `console errors: ${problems.join(" | ")}`).toEqual([]);
    });
  }
}

test("four destinations, brand underline, and the period is rendered once", async ({ page }) => {
  await mock(page);
  await page.goto("/spending/budget");
  const nav = page.getByRole("navigation", { name: "Finance navigation" });
  await expect(nav.getByRole("link")).toHaveCount(4);
  await expect(nav.getByRole("link", { name: "Today" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Spending" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Wealth" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Insights" })).toBeVisible();
  await expect(page.getByTestId("month-navigator")).toHaveCount(1);
});

test("period survives a destination change and is mirrored to the URL", async ({ page }) => {
  await mock(page);
  await page.goto("/spending/budget");
  await page.getByTestId("prev-month-button").click();
  const label = await page.getByTestId("current-month-label").textContent();
  await expect(page).toHaveURL(/period=\d{4}-\d{2}/);

  await page.getByRole("link", { name: "Today" }).click();
  await expect(page.getByTestId("current-month-label")).toHaveText(label!);
  await expect(page).toHaveURL(/period=\d{4}-\d{2}/);

  await page.goBack();
  await expect(page.getByTestId("current-month-label")).toHaveText(label!);
});

test("sub-nav is a real link list, not a tablist", async ({ page }) => {
  await mock(page);
  await page.goto("/wealth/accounts");
  const sub = page.locator('[data-slot="segmented-nav"]');
  await expect(sub).toBeVisible();
  await expect(sub.getByRole("link")).toHaveCount(4);
  await expect(sub.locator('[role="tab"]')).toHaveCount(0);
  await expect(sub.getByRole("link", { name: "Accounts" })).toHaveAttribute("aria-current", "page");
});

test("destination index paths redirect to their first sub-surface", async ({ page }) => {
  await mock(page);
  for (const [from, to] of [["/spending", "/spending/budget"], ["/wealth", "/wealth/accounts"], ["/insights", "/insights/trends"]]) {
    await page.goto(from);
    await expect(page).toHaveURL(new RegExp(to.replace(/\//g, "\\/")));
  }
});
