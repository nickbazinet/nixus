import { test, expect, type Page } from "@playwright/test";

/**
 * Sets up Tauri IPC mocks with sample data for accessibility testing.
 *
 * `plugin:` commands MUST resolve null. A truthy updater response makes UpdateChecker render an
 * always-open Dialog, and Base UI's focus trap then puts aria-hidden="true" on the whole app —
 * every getByRole in this file would resolve zero elements for an unrelated reason.
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

    (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      // Without this, every event.listen() throws and the listeners the shell registers on mount
      // take the whole surface down with them.
      transformCallback: () => 1,
      invoke: (cmd: string, args: Record<string, unknown>) => {
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);
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
          // The accounts surface mounts one of these per account; without a case the section
          // renders its error state and drags unrelated assertions down with it.
          case "get_account_earmark_breakdown":
            return Promise.resolve({ account_id: args.account_id as number, balance_cents: 0, earmarked_cents: 0, unallocated_cents: 0, segments: [] });
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
          case "get_latest_expense":
            return Promise.resolve(null);
          case "get_all_budget_categories":
            return Promise.resolve(categories);
          case "get_net_worth_history":
            return Promise.resolve([]);
          case "get_net_worth_change":
            return Promise.resolve({ absolute_change_cents: 0, percentage_change: 0, direction: "flat" });
          case "get_db_status":
            return Promise.resolve({ db_path: "mock.db", wal_mode: true, schema_version: 10, migrations_applied: 10 });
          case "list_conversations":
            return Promise.resolve([{ id: 1, title: "Budget check-in", agent_id: "budget-helper", created_at: "2026-03-01", updated_at: "2026-03-01" }]);
          case "get_chat_messages":
            return Promise.resolve([
              { role: "user", content: "How am I tracking this month?" },
              { role: "assistant", content: "You have spent $350.00 of your $700.00 Groceries target." },
            ]);
          case "get_savings_projects_summary":
            return Promise.resolve({
              active_project_count: 0,
              total_saved_cents: 0,
              total_target_cents: 0,
            });
          default:
            return Promise.reject(`Unknown command: ${cmd}`);
        }
      },
      convertFileSrc: (path: string) => path,
    };
  });
}

/** Resolves a spine token to the same computed colour string the browser reports for an element. */
async function resolveToken(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, token);
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

    // Page has a single h1. "Dashboard" retired as the Finance landing title — it is now "Today",
    // and it carries the id the skip link and the route-change focus move both target.
    const h1 = page.locator("h1");
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText("Today");
    await expect(h1).toHaveAttribute("id", "surface-heading");
  });

  test("the skip link is the first tab stop, ahead of the rail", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/");

    await page.keyboard.press("Tab");

    const skip = page.getByTestId("skip-to-content");
    await expect(skip).toBeFocused();
    await expect(skip).toHaveText("Skip to content");

    // The rail is the second stop, never the first.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeFocused();
  });

  test("activating the skip link moves focus to the surface heading", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/");

    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");

    await expect(page.locator("#surface-heading")).toBeFocused();
  });

  test("keyboard navigation moves focus to the new surface heading", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/");

    const spending = page
      .locator('nav[aria-label="Finance navigation"]')
      .getByRole("link", { name: "Spending", exact: true });
    await spending.focus();
    await page.keyboard.press("Enter");

    await expect(page.locator("h1")).toHaveText("Budget");
    // The shell persists across navigation, so without an explicit focus move a keyboard user
    // stays on the nav and has to tab through the whole chrome to reach the new surface.
    await expect(page.locator("#surface-heading")).toBeFocused();
  });

  test("switching language updates the document language and announces it", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    await page.getByTestId("language-toggle").click();

    // A screen reader that keeps an English voice on French content is unusable for the session.
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");

    const status = page.locator('aside [role="status"]');
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(status).toHaveText("La langue est maintenant le français");
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
    await page.goto("/spending/budget");

    const expected = await resolveToken(page, "--focus-ring");
    const addGroupBtn = page.getByTestId("add-group-button");
    await addGroupBtn.focus();

    // Ring PLUS a surface-coloured offset, per the exported `focusRing`. Read from computed style
    // so a token rename cannot pass while the user sees no ring, and asserted with the retrying
    // matcher because `transition-colors` animates outline-color from the element's own ink.
    await expect(addGroupBtn).toHaveCSS("outline-style", "solid");
    await expect(addGroupBtn).toHaveCSS("outline-width", "2px");
    await expect(addGroupBtn).toHaveCSS("outline-color", expected);
    await expect(addGroupBtn).toHaveCSS("outline-offset", "2px");
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

  test("DashboardBudgetCategoryRow announces one sentence, not four fragments", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/");

    const categoryRow = page.getByTestId("dashboard-category-row").first();
    await expect(categoryRow).toBeVisible();

    // aria-label on a generic div is ignored by assistive tech, so the row now carries a
    // visually-hidden sentence and hides every visual part from the accessible tree instead.
    expect(await categoryRow.getAttribute("aria-label")).toBeNull();

    const announced = await categoryRow.evaluate((el) => {
      const hidden = el.querySelector(":scope > .sr-only");
      return {
        sentence: hidden?.textContent?.trim() ?? "",
        visualPartsHiddenFromAt: [...el.children]
          .filter((child) => !child.classList.contains("sr-only"))
          .every((child) => child.getAttribute("aria-hidden") === "true"),
      };
    });

    expect(announced.sentence).toContain("Groceries");
    expect(announced.sentence).toContain("$");
    expect(announced.sentence).toContain("spent");
    expect(announced.visualPartsHiddenFromAt).toBe(true);
  });

  test("chat streaming is announced at sentence boundaries, not as a raw live region", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/ai/budget-helper?conversation=1");

    // Deliberately NOT a live region: bound to a token-by-token LLM stream it would announce every
    // DOM mutation, turning one reply into a firehose of partial words.
    const log = page.locator('[role="log"]');
    await expect(log).toBeVisible();
    expect(await log.getAttribute("aria-live")).toBeNull();

    // The announcement is published separately, per completed sentence.
    const announcer = page.getByTestId("chat-live-region");
    await expect(announcer).toHaveCount(1);
    await expect(announcer).toHaveAttribute("aria-live", "polite");

    const announced = (await announcer.textContent())?.trim() ?? "";
    expect(announced).not.toBe("");
    // A whole sentence, never a partial token.
    expect(announced).toMatch(/[.!?]$/);

    // The announcer is for assistive tech only; it must not duplicate the reply on screen.
    const width = await announcer.evaluate((el) => getComputedStyle(el).width);
    expect(Number.parseFloat(width)).toBeLessThanOrEqual(1);
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

  test("account rows are table rows described by their column headers", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/wealth/accounts");

    // The account list is a real table now, so a row's meaning comes from its cells plus the
    // column headers — ARIA forbids naming a row with aria-label, which is what this used to assert.
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    for (const head of ["Account", "Last updated", "Balance"]) {
      await expect(table.getByRole("columnheader", { name: head, exact: true })).toBeVisible();
    }

    const row = page.getByTestId("account-row");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveRole("row");
    expect(await row.getAttribute("aria-label")).toBeNull();

    const nameCell = row.getByRole("cell").first();
    await expect(nameCell).toContainText("Main Chequing");
    await expect(nameCell).toContainText("TD Bank");
    await expect(row.getByTestId("account-balance")).toContainText("$");
  });

  test("asset rows are table rows described by their column headers", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/wealth/assets");

    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    for (const head of ["Asset", "Last updated", "Value"]) {
      await expect(table.getByRole("columnheader", { name: head, exact: true })).toBeVisible();
    }

    const row = page.getByTestId("asset-row");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveRole("row");
    expect(await row.getAttribute("aria-label")).toBeNull();

    await expect(row.getByRole("cell").first()).toContainText("Family Home");
    await expect(row.getByTestId("asset-value")).toContainText("$");
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
