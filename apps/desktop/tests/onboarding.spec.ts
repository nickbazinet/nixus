import { test, expect, type Page } from "@playwright/test";

/**
 * Sets up Tauri IPC mocks for the onboarding wizard tests.
 * Starts with empty state (needs_onboarding: true) by default.
 */
async function setupTauriMock(page: Page, options?: { hasData?: boolean }) {
  const hasData = options?.hasData ?? false;

  await page.addInitScript(
    ({ hasData }) => {
      interface MockGroup {
        id: number;
        name: string;
        sort_order: number;
        created_at: string;
      }
      interface MockCategory {
        id: number;
        group_id: number;
        name: string;
        target_cents: number;
        sort_order: number;
        created_at: string;
      }
      interface MockAccount {
        id: number;
        name: string;
        institution: string;
        account_type: string;
        currency: string;
        balance_cents: number;
        created_at: string;
        updated_at: string;
      }
      interface MockAsset {
        id: number;
        name: string;
        asset_type: string;
        value_cents: number;
        created_at: string;
        updated_at: string;
      }

      const groups: MockGroup[] = hasData
        ? [{ id: 1, name: "Essentials", sort_order: 0, created_at: new Date().toISOString() }]
        : [];
      const categories: MockCategory[] = [];
      const accounts: MockAccount[] = [];
      const assets: MockAsset[] = [];
      let nextGroupId = hasData ? 2 : 1;
      let nextCategoryId = 1;
      let nextAccountId = 1;
      let nextAssetId = 1;

      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: Record<string, unknown>) => {
          switch (cmd) {
            case "check_onboarding_status":
              return Promise.resolve({ needs_onboarding: groups.length === 0 });

            case "get_budget_groups":
              return Promise.resolve(groups);

            case "create_budget_group": {
              const name = args.name as string;
              if (!name?.trim()) {
                return Promise.reject({ type: "validation", message: "Group name is required", field: "name" });
              }
              const group: MockGroup = {
                id: nextGroupId++,
                name: name.trim(),
                sort_order: groups.length,
                created_at: new Date().toISOString(),
              };
              groups.push(group);
              return Promise.resolve(group);
            }

            case "get_budget_categories": {
              const groupId = args.group_id as number;
              return Promise.resolve(categories.filter((c) => c.group_id === groupId));
            }

            case "create_budget_category": {
              const catName = args.name as string;
              const targetCents = args.target_cents as number;
              const catGroupId = args.group_id as number;
              if (!catName?.trim()) {
                return Promise.reject({ type: "validation", message: "Category name is required", field: "name" });
              }
              const category: MockCategory = {
                id: nextCategoryId++,
                group_id: catGroupId,
                name: catName.trim(),
                target_cents: targetCents,
                sort_order: categories.filter((c) => c.group_id === catGroupId).length,
                created_at: new Date().toISOString(),
              };
              categories.push(category);
              return Promise.resolve(category);
            }

            case "get_accounts":
              return Promise.resolve(accounts);

            case "create_account": {
              const account: MockAccount = {
                id: nextAccountId++,
                name: args.name as string,
                institution: args.institution as string,
                account_type: args.account_type as string,
                currency: args.currency as string,
                balance_cents: 0,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };
              accounts.push(account);
              return Promise.resolve(account);
            }

            case "get_assets":
              return Promise.resolve(assets);

            case "create_asset": {
              const asset: MockAsset = {
                id: nextAssetId++,
                name: args.name as string,
                asset_type: args.asset_type as string,
                value_cents: args.value_cents as number,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };
              assets.push(asset);
              return Promise.resolve(asset);
            }

            case "get_budget_status":
              return Promise.resolve([]);

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
              return Promise.resolve({ total_cents: 0, cash_cents: 0, investments_cents: 0, assets_cents: 0 });

            case "get_recent_net_worth_snapshots":
              return Promise.resolve([]);

            case "get_spending_breakdown":
              return Promise.resolve([]);

            case "get_db_status":
              return Promise.resolve({ db_path: "mock.db", wal_mode: true, schema_version: 3, migrations_applied: 3 });

            default:
              return Promise.reject(`Unknown command: ${cmd}`);
          }
        },
        convertFileSrc: (path: string) => path,
      };
    },
    { hasData }
  );
}

test.describe("Onboarding Wizard", () => {
  test("with empty database, app redirects to onboarding wizard", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/");

    // Should redirect to /onboarding
    await expect(page.getByTestId("onboarding-wizard")).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding/);
  });

  test("4-step horizontal indicator shows Budget, Accounts, Assets, Import", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/onboarding");

    const indicator = page.getByTestId("step-indicator");
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveAttribute("role", "tablist");

    await expect(page.getByTestId("step-tab-budget")).toBeVisible();
    await expect(page.getByTestId("step-tab-accounts")).toBeVisible();
    await expect(page.getByTestId("step-tab-assets")).toBeVisible();
    await expect(page.getByTestId("step-tab-import")).toBeVisible();

    // First step should be selected
    await expect(page.getByTestId("step-tab-budget")).toHaveAttribute("aria-selected", "true");
  });

  test("Step 1 (Budget) allows creating a group and category; Next advances to Step 2", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/onboarding");

    // Verify budget step is shown
    await expect(page.getByTestId("onboarding-budget-step")).toBeVisible();

    // Create a budget group
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill("Essentials");
    await page.getByRole("button", { name: "Save Group" }).click();
    await expect(page.getByText('Group "Essentials" created')).toBeVisible();

    // Click Next to advance to Step 2
    await page.getByTestId("next-button").click();

    // Verify Step 2 (Accounts) is now shown
    await expect(page.getByTestId("onboarding-accounts-step")).toBeVisible();
    await expect(page.getByTestId("step-tab-accounts")).toHaveAttribute("aria-selected", "true");
  });

  test("Steps 2-4 show a Skip button that advances to the next step", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/onboarding");

    // Step 1 should NOT have a Skip button
    await expect(page.getByTestId("skip-button")).not.toBeVisible();

    // Advance to Step 2
    await page.getByTestId("next-button").click();

    // Step 2 should have Skip
    await expect(page.getByTestId("skip-button")).toBeVisible();
    await page.getByTestId("skip-button").click();

    // Should be on Step 3
    await expect(page.getByTestId("onboarding-assets-step")).toBeVisible();

    // Step 3 should have Skip
    await expect(page.getByTestId("skip-button")).toBeVisible();
    await page.getByTestId("skip-button").click();

    // Should be on Step 4 (Income)
    await expect(page.getByTestId("skip-button")).toBeVisible();
    await page.getByTestId("skip-button").click();

    // Should be on Step 5 (Import)
    await expect(page.getByTestId("onboarding-import-step")).toBeVisible();
  });

  test("Back button returns to the previous step", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/onboarding");

    // Step 1 should NOT have a Back button
    await expect(page.getByTestId("back-button")).not.toBeVisible();

    // Advance to Step 2
    await page.getByTestId("next-button").click();
    await expect(page.getByTestId("onboarding-accounts-step")).toBeVisible();

    // Back should return to Step 1
    await expect(page.getByTestId("back-button")).toBeVisible();
    await page.getByTestId("back-button").click();
    await expect(page.getByTestId("onboarding-budget-step")).toBeVisible();
  });

  test("after completing onboarding, user lands on Dashboard", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/onboarding");

    // Step 1: Create a budget group (required — budget data prevents re-redirect)
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill("Essentials");
    await page.getByRole("button", { name: "Save Group" }).click();
    await expect(page.getByText('Group "Essentials" created')).toBeVisible();

    await page.getByTestId("next-button").click(); // Step 2
    await page.getByTestId("skip-button").click();  // Step 3
    await page.getByTestId("skip-button").click();  // Step 4
    await page.getByTestId("skip-button").click();  // Step 5

    // Finish
    await page.getByTestId("finish-button").click();

    // Should land on Dashboard
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("h1")).toHaveText("Dashboard");
  });

  test("on next launch with data, dashboard loads directly (no onboarding redirect)", async ({ page }) => {
    await setupTauriMock(page, { hasData: true });
    await page.goto("/");

    // Should stay on dashboard, not redirect to onboarding
    await expect(page.locator("h1")).toHaveText("Dashboard");
    await expect(page.getByTestId("onboarding-wizard")).not.toBeVisible();
  });
});
