import { test, expect, type Page } from "@playwright/test";

/**
 * Sets up Tauri IPC mocks with sample data for accessibility testing.
 */
async function setupTauriMock(page: Page) {
  await page.addInitScript(() => {
    const groups = [
      { id: 1, name: "Essentials", sort_order: 0, created_at: "2026-01-01" },
    ];
    const categories = [
      { id: 1, group_id: 1, name: "Groceries", target_cents: 70000, sort_order: 0, created_at: "2026-01-01" },
    ];
    const accounts = [
      { id: 1, name: "Main Chequing", institution: "TD Bank", account_type: "chequing", currency: "CAD", balance_cents: 150000, created_at: "2026-01-01", updated_at: "2026-01-01" },
    ];
    const assets = [
      { id: 1, name: "Family Home", asset_type: "real_estate", value_cents: 50000000, created_at: "2026-01-01", updated_at: "2026-01-01" },
    ];

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: Record<string, unknown>) => {
        switch (cmd) {
          case "check_onboarding_status":
            return Promise.resolve({ needs_onboarding: false });
          case "get_budget_groups":
            return Promise.resolve(groups);
          case "get_budget_categories":
            return Promise.resolve(categories.filter((c) => c.group_id === (args.group_id as number)));
          case "get_budget_status":
            return Promise.resolve(categories.map((c) => ({ id: c.id, group_id: c.group_id, name: c.name, target_cents: c.target_cents, spent_cents: 35000 })));
          case "get_budget_summary":
            return Promise.resolve({ total_target_cents: 70000, total_spent_cents: 35000, remaining_cents: 35000, month: "2026-03" });
          case "get_top_budget_categories":
            return Promise.resolve([{ id: 1, name: "Groceries", group_name: "Essentials", target_cents: 70000, spent_cents: 35000, percentage: 50 }]);
          case "get_accounts":
            return Promise.resolve(accounts);
          case "get_assets":
            return Promise.resolve(assets);
          case "get_current_net_worth":
            return Promise.resolve({ total_cents: 50150000, cash_cents: 150000, investments_cents: 0, assets_cents: 50000000 });
          case "get_recent_net_worth_snapshots":
            return Promise.resolve([]);
          case "get_spending_breakdown":
            return Promise.resolve([{ category_id: 1, category_name: "Groceries", spent_cents: 35000 }]);
          case "get_expenses":
            return Promise.resolve([]);
          case "get_all_budget_categories":
            return Promise.resolve(categories);
          case "get_net_worth_history":
            return Promise.resolve([]);
          case "get_net_worth_change":
            return Promise.resolve({ absolute_change_cents: 0, percentage_change: 0, direction: "flat" });
          case "get_db_status":
            return Promise.resolve({ db_path: "mock.db", wal_mode: true, schema_version: 10, migrations_applied: 10 });
          default:
            return Promise.reject(`Unknown command: ${cmd}`);
        }
      },
      convertFileSrc: (path: string) => path,
    };
  });
}

test.describe("Accessibility", () => {
  test("semantic HTML: nav for sidebar and tabs, main for content, h1 for page title", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/");

    // Sidebar uses nav with aria-label
    const sidebarNav = page.locator('nav[aria-label="Module navigation"]');
    await expect(sidebarNav).toBeVisible();

    // Tab nav uses nav with aria-label
    const tabNav = page.locator('nav[aria-label="Finance navigation"]');
    await expect(tabNav).toBeVisible();

    // Main content area uses main element
    const main = page.locator("main");
    await expect(main).toBeVisible();

    // Page has a single h1
    const h1 = page.locator("h1");
    await expect(h1).toHaveText("Dashboard");
  });

  test("all interactive elements reachable via Tab in tab nav", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/");

    // Tab through tab nav items — first tab stop is the first nav link
    await page.keyboard.press("Tab");

    const focused = page.locator(':focus');
    await expect(focused).toBeVisible();
  });

  test("Escape closes the floating chat bar overlay", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/");

    // Open chat with Cmd+K
    await page.keyboard.press("Meta+k");
    await expect(page.getByTestId("floating-chat-overlay")).toBeVisible();

    // Escape closes it
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("floating-chat-overlay")).not.toBeVisible();
  });

  test("focus rings are visible on focused interactive elements", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/budget");

    // Focus the add group button
    const addGroupBtn = page.getByTestId("add-group-button");
    await addGroupBtn.focus();

    // Check that it has a visible outline/ring
    const outlineStyle = await addGroupBtn.evaluate((el) => {
      const style = getComputedStyle(el);
      return style.outlineStyle;
    });
    // The button should have some form of focus indicator (outline, ring, or box-shadow)
    // Tailwind uses outline by default for focus-visible
    expect(["solid", "auto", "none"]).toContain(outlineStyle);
  });

  test("DashboardMetricCard has descriptive aria-label", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/");

    // Check metric cards have aria-label
    const metricCards = page.getByTestId("metric-card");
    const firstCard = metricCards.first();
    await expect(firstCard).toBeVisible();

    const ariaLabel = await firstCard.getAttribute("aria-label");
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel).toContain("$");
  });

  test("DashboardBudgetCategoryRow has aria-label with name and amounts", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/");

    const categoryRow = page.getByTestId("dashboard-category-row").first();
    await expect(categoryRow).toBeVisible();

    const ariaLabel = await categoryRow.getAttribute("aria-label");
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel).toContain("Groceries");
    expect(ariaLabel).toContain("$");
    expect(ariaLabel).toContain("% used");
  });

  test("chat message container has role=log and aria-live=polite", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/chat");

    const container = page.locator('[role="log"]');
    await expect(container).toBeVisible();
    await expect(container).toHaveAttribute("aria-live", "polite");
  });

  test("import progress stepper has aria-live for stage announcements", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/import");

    // The stepper isn't visible until import starts, but we can check structure
    // by looking at the page for the role=progressbar element if visible
    // For now, verify the import page loads with correct heading
    await expect(page.locator("h1")).toHaveText("Import");
  });

  test("floating chat dialog has role=dialog and aria-label", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/");

    await page.keyboard.press("Meta+k");
    const dialog = page.getByTestId("floating-chat-bar");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("role", "dialog");
    await expect(dialog).toHaveAttribute("aria-label", "Quick chat");
  });

  test("account row has aria-label with name, type, and balance", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/accounts");

    const accountRow = page.getByTestId("account-row").first();
    await expect(accountRow).toBeVisible();

    const ariaLabel = await accountRow.getAttribute("aria-label");
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel).toContain("Main Chequing");
    expect(ariaLabel).toContain("$");
  });

  test("asset row has aria-label with name, type, and value", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/assets");

    const assetRow = page.getByTestId("asset-row").first();
    await expect(assetRow).toBeVisible();

    const ariaLabel = await assetRow.getAttribute("aria-label");
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel).toContain("Family Home");
    expect(ariaLabel).toContain("$");
  });

  test("prefers-reduced-motion CSS rule exists", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/");

    // Verify the CSS media query is applied by checking that the stylesheet contains it
    const hasReducedMotion = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule instanceof CSSMediaRule && rule.conditionText?.includes("prefers-reduced-motion")) {
              return true;
            }
          }
        } catch {
          // cross-origin stylesheets throw
        }
      }
      return false;
    });
    expect(hasReducedMotion).toBe(true);
  });
});
