import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * MoneyInput reformats its own display on focus, and only when it already holds an amount.
 * A bare fill() focuses and writes in one action, so that reformat lands on top of the typed
 * value. Clicking first lets it settle — which is also what a human does.
 */
async function fillMoneyInput(input: Locator, dollars: string) {
  await input.click();
  await input.fill(dollars);
}


/**
 * Sets up Tauri IPC mocks for the onboarding wizard tests.
 * Starts with empty state (needs_onboarding: true) by default.
 */
async function setupTauriMock(
  page: Page,
  options?: {
    hasData?: boolean;
    completed?: boolean;
    starterUnavailable?: boolean;
    applyFails?: boolean;
  }
) {
  const hasData = options?.hasData ?? false;
  const completed = options?.completed ?? false;
  const starterUnavailable = options?.starterUnavailable ?? false;
  const applyFails = options?.applyFails ?? false;

  await page.addInitScript(
    ({ hasData, completed, starterUnavailable, applyFails }) => {
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
      let onboardingCompleted = completed;

      // Mirrors the Rust const closely enough to exercise the real preview/override path
      // without shipping all twelve categories into the assertions.
      const STARTER_DETAIL = {
        id: "canadian-starter",
        name: "Canadian Starter Budget",
        description: "Common Canadian household categories.",
        groups: [
          {
            name: "Housing",
            categories: [
              { name: "Rent / Mortgage", target_cents: 180_000 },
              { name: "Utilities", target_cents: 20_000 },
            ],
          },
          {
            name: "Savings",
            categories: [{ name: "TFSA Contribution", target_cents: 50_000 }],
          },
        ],
      };

      // Read back by the tests: the override payload is the whole contract of an edited apply.
      const appliedTemplateCalls: Record<string, unknown>[] = [];
      (window as unknown as Record<string, unknown>).__APPLIED_TEMPLATE_CALLS =
        appliedTemplateCalls;

      (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: () => {},
      };

      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: Record<string, unknown>) => {
          // Every plugin channel resolves null. A truthy updater response mounts an always-open
          // Dialog that aria-hidden's the whole app, which makes every getByRole find nothing.
          if (cmd.startsWith("plugin:")) return Promise.resolve(null);

          switch (cmd) {
            case "check_onboarding_status": {
              const hasBudgetData = groups.length > 0;
              return Promise.resolve({
                needs_onboarding: !hasBudgetData && !onboardingCompleted,
                setup_incomplete: onboardingCompleted && !hasBudgetData,
              });
            }

            case "complete_onboarding":
              onboardingCompleted = true;
              return Promise.resolve(null);

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

            case "list_system_templates":
              return Promise.resolve(
                starterUnavailable
                  ? []
                  : [
                      {
                        id: STARTER_DETAIL.id,
                        name: STARTER_DETAIL.name,
                        description: STARTER_DETAIL.description,
                      },
                    ]
              );

            case "get_system_template_detail": {
              if (args.template_id !== STARTER_DETAIL.id) {
                return Promise.reject({
                  type: "validation",
                  message: "That starter template is not available.",
                  field: "template_id",
                });
              }
              return Promise.resolve(STARTER_DETAIL);
            }

            case "apply_system_template": {
              appliedTemplateCalls.push({
                template_id: args.template_id,
                overrides: args.overrides ?? null,
              });

              if (applyFails) {
                return Promise.reject({
                  type: "database",
                  message: "Could not write to the database.",
                });
              }

              const overrides = (args.overrides ?? []) as {
                group_name: string;
                category_name: string;
                target_cents: number;
              }[];
              const taken = groups.map((g) => g.name.trim().toLowerCase());
              const skipped: string[] = [];
              let groupsCreated = 0;
              let categoriesCreated = 0;

              for (const templateGroup of STARTER_DETAIL.groups) {
                if (taken.includes(templateGroup.name.trim().toLowerCase())) {
                  skipped.push(templateGroup.name);
                  continue;
                }
                const created: MockGroup = {
                  id: nextGroupId++,
                  name: templateGroup.name,
                  sort_order: groups.length,
                  created_at: new Date().toISOString(),
                };
                groups.push(created);
                taken.push(created.name.trim().toLowerCase());
                groupsCreated += 1;

                for (const templateCategory of templateGroup.categories) {
                  const edited = overrides.find(
                    (o) =>
                      o.group_name.trim().toLowerCase() ===
                        templateGroup.name.trim().toLowerCase() &&
                      o.category_name.trim().toLowerCase() ===
                        templateCategory.name.trim().toLowerCase()
                  );
                  categories.push({
                    id: nextCategoryId++,
                    group_id: created.id,
                    name: templateCategory.name,
                    target_cents: edited?.target_cents ?? templateCategory.target_cents,
                    sort_order: categories.filter((c) => c.group_id === created.id).length,
                    created_at: new Date().toISOString(),
                  });
                  categoriesCreated += 1;
                }
              }

              return Promise.resolve({
                groups_created: groupsCreated,
                categories_created: categoriesCreated,
                skipped_groups: skipped,
              });
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

            case "get_latest_expense":
              return Promise.resolve(null);

            case "get_db_status":
              return Promise.resolve({ db_path: "mock.db", wal_mode: true, schema_version: 3, migrations_applied: 3 });

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
        transformCallback: () => 1,
        unregisterCallback: () => {},
        convertFileSrc: (path: string) => path,
      };
    },
    { hasData, completed, starterUnavailable, applyFails }
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

  test("step indicator is a labelled progress indicator, not a tab list", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/onboarding");

    const indicator = page.getByTestId("step-indicator");
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveAttribute("role", "progressbar");
    await expect(indicator).toHaveAccessibleName("Setup steps");
    await expect(indicator).toHaveAttribute("aria-valuemin", "1");
    await expect(indicator).toHaveAttribute("aria-valuemax", "5");
    await expect(indicator).toHaveAttribute("aria-valuenow", "1");
    await expect(indicator).toHaveAttribute("aria-valuetext", "Step 1 of 5");

    // A wizard's progress is not a set of tabs: the pips are not activatable, so tab semantics
    // promised navigation the indicator never offered.
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(0);

    for (const step of ["budget", "accounts", "assets", "income", "import"]) {
      await expect(page.getByTestId(`step-dot-${step}`)).toBeAttached();
    }

    // The step the user is on is named by its own heading, which is what the pips cannot carry.
    await expect(page.getByRole("heading", { name: "Set up your budget" })).toBeVisible();
  });

  test("Step 1 (Budget) allows creating a group and category; Next advances to Step 2", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/onboarding");

    // Verify budget step is shown
    await expect(page.getByTestId("onboarding-budget-step")).toBeVisible();

    // The starter template is now the step's primary choice, so the manual path is one
    // click behind "Start from scratch instead".
    await page.getByTestId("onboarding-start-from-scratch").click();

    // Create a budget group
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill("Essentials");
    await page.getByRole("button", { name: "Save Group" }).click();
    await expect(page.getByText('"Essentials" created')).toBeVisible();

    // Click Next to advance to Step 2
    await page.getByTestId("next-button").click();

    // Verify Step 2 (Accounts) is now shown
    await expect(page.getByTestId("onboarding-accounts-step")).toBeVisible();
    await expect(page.getByTestId("step-indicator")).toHaveAttribute("aria-valuenow", "2");
    await expect(page.getByTestId("step-indicator")).toHaveAttribute(
      "aria-valuetext",
      "Step 2 of 5"
    );
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

  test("after completing onboarding, user lands on the Today surface", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/onboarding");

    // Step 1: Create a budget group (required — budget data prevents re-redirect)
    await page.getByTestId("onboarding-start-from-scratch").click();
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill("Essentials");
    await page.getByRole("button", { name: "Save Group" }).click();
    await expect(page.getByText('"Essentials" created')).toBeVisible();

    await page.getByTestId("next-button").click(); // Step 2
    await page.getByTestId("skip-button").click();  // Step 3
    await page.getByTestId("skip-button").click();  // Step 4
    await page.getByTestId("skip-button").click();  // Step 5

    // Finish
    await page.getByTestId("finish-button").click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
  });

  test("on next launch with data, Today loads directly (no onboarding redirect)", async ({ page }) => {
    await setupTauriMock(page, { hasData: true });
    await page.goto("/");

    // Should stay on the Finance home surface, not redirect to onboarding
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
    await expect(page.getByTestId("onboarding-wizard")).not.toBeVisible();
  });

  test("Skip for now on Step 1 with no data lands on Today and stays there", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/onboarding");

    await expect(page.getByTestId("onboarding-budget-step")).toBeVisible();
    await expect(page.getByTestId("skip-onboarding-button")).toBeVisible();
    await page.getByTestId("skip-onboarding-button").click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
    await expect(page.getByTestId("onboarding-wizard")).not.toBeVisible();

    // The redirect effect re-runs on every status refetch — confirm no bounce back
    await expect(page.getByTestId("setup-incomplete-banner")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("relaunch after skipping with no data shows the setup-incomplete banner", async ({ page }) => {
    await setupTauriMock(page, { hasData: false, completed: true });
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
    await expect(page.getByTestId("onboarding-wizard")).not.toBeVisible();

    const banner = page.getByTestId("setup-incomplete-banner");
    await expect(banner).toBeVisible();
    await expect(banner.getByTestId("setup-incomplete-cta")).toHaveAttribute("href", "/onboarding");
    await expect(page.getByTestId("empty-budget")).toBeVisible();
    await expect(page.getByTestId("empty-net-worth")).toBeVisible();
  });

  test("with budget data present the setup-incomplete banner is absent", async ({ page }) => {
    await setupTauriMock(page, { hasData: true, completed: true });
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
    await expect(page.getByTestId("setup-incomplete-banner")).not.toBeVisible();
  });

  test("dismissing the setup-incomplete banner keeps it hidden on revisit", async ({ page }) => {
    await setupTauriMock(page, { hasData: false, completed: true });
    await page.goto("/");

    await page.getByTestId("setup-incomplete-dismiss").click();
    await expect(page.getByTestId("setup-incomplete-banner")).not.toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
    await expect(page.getByTestId("setup-incomplete-banner")).not.toBeVisible();
    await expect(page.getByTestId("empty-budget")).toBeVisible();
  });

  test("Step 1 presents the starter template with pre-filled, editable targets", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/onboarding");

    const starter = page.getByTestId("onboarding-starter-template");
    await expect(starter).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Start with a ready-made budget" })
    ).toBeVisible();

    // Every authored target arrives pre-filled and writable — not read-only text.
    const rent = page.getByLabel("Rent / Mortgage");
    await expect(rent).toHaveValue("1,800.00");
    await expect(rent).toBeEditable();
    await expect(page.getByLabel("Utilities")).toHaveValue("200.00");
    await expect(page.getByLabel("TFSA Contribution")).toHaveValue("500.00");

    // The manual path is available, but secondary
    await expect(page.getByTestId("onboarding-start-from-scratch")).toBeVisible();
    await expect(page.getByTestId("add-group-button")).not.toBeVisible();
  });
  test("editing a target sends only that override and lands on the dashboard", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/onboarding");

    await expect(page.getByTestId("onboarding-starter-template")).toBeVisible();

    const rent = page.getByLabel("Rent / Mortgage");
    await fillMoneyInput(rent, "2200");
    await rent.blur();
    await expect(rent).toHaveValue("2,200.00");

    await page.getByTestId("onboarding-starter-confirm").click();

    // Two clicks total (edit aside): the user is on the dashboard with a budget
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
    await expect(page.getByTestId("onboarding-wizard")).not.toBeVisible();

    const calls = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__APPLIED_TEMPLATE_CALLS
    );
    expect(calls).toEqual([
      {
        template_id: "canadian-starter",
        overrides: [
          {
            group_name: "Housing",
            category_name: "Rent / Mortgage",
            target_cents: 220_000,
          },
        ],
      },
    ]);
  });

  test("confirming without edits sends no overrides at all", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/onboarding");

    await expect(page.getByTestId("onboarding-starter-template")).toBeVisible();
    await page.getByTestId("onboarding-starter-confirm").click();

    await expect(page).toHaveURL(/\/$/);

    const calls = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__APPLIED_TEMPLATE_CALLS
    );
    // null, not []: Rust reads a missing argument as "apply the authored defaults".
    expect(calls).toEqual([{ template_id: "canadian-starter", overrides: null }]);
  });

  test("re-typing a target's own default is not sent as an override", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/onboarding");

    await expect(page.getByTestId("onboarding-starter-template")).toBeVisible();

    const rent = page.getByLabel("Rent / Mortgage");
    await fillMoneyInput(rent, "1800");
    await rent.blur();

    await page.getByTestId("onboarding-starter-confirm").click();
    await expect(page).toHaveURL(/\/$/);

    const calls = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__APPLIED_TEMPLATE_CALLS
    );
    expect(calls).toEqual([{ template_id: "canadian-starter", overrides: null }]);
  });

  test("an all-collided apply says nothing was added instead of reading as success", async ({ page }) => {
    // Creating both of the starter's groups by hand is what makes every group a duplicate,
    // which is the only way to reach the zero-created branch.
    await setupTauriMock(page);
    await page.goto("/onboarding");

    await page.getByTestId("onboarding-start-from-scratch").click();
    for (const name of ["Housing", "Savings"]) {
      await page.getByTestId("add-group-button").click();
      await page.getByLabel("Group Name").fill(name);
      await page.getByRole("button", { name: "Save Group" }).click();
      await expect(page.getByText(`"${name}" created`)).toBeVisible();
    }

    await page.getByTestId("onboarding-starter-confirm").click();

    // Zero created is not a silent success: it names every group it refused to duplicate
    await expect(
      page.getByText(
        "Nothing was added — you already have every one of these groups: Housing, Savings"
      )
    ).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("a partially collided apply names what it skipped", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/onboarding");

    await page.getByTestId("onboarding-start-from-scratch").click();
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill("Housing");
    await page.getByRole("button", { name: "Save Group" }).click();
    await expect(page.getByText('"Housing" created')).toBeVisible();

    await page.getByTestId("onboarding-starter-confirm").click();

    // A partial apply must name what it skipped rather than claim a clean success
    await expect(
      page.getByText("Skipped, because you already have them: Housing")
    ).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("when the starter template is unavailable the manual path is immediately usable", async ({ page }) => {
    await setupTauriMock(page, { starterUnavailable: true });
    await page.goto("/onboarding");

    await expect(page.getByTestId("onboarding-budget-step")).toBeVisible();
    await expect(page.getByTestId("onboarding-starter-template")).not.toBeVisible();
    await expect(page.getByTestId("onboarding-start-from-scratch")).not.toBeVisible();

    // Onboarding is a first-run gate: no starter must never mean no way forward
    await expect(page.getByTestId("add-group-button")).toBeVisible();
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill("Essentials");
    await page.getByRole("button", { name: "Save Group" }).click();
    await expect(page.getByText('"Essentials" created')).toBeVisible();
  });

  test("a failed apply keeps the user on the step with the reason shown", async ({ page }) => {
    await setupTauriMock(page, { applyFails: true });
    await page.goto("/onboarding");

    await expect(page.getByTestId("onboarding-starter-template")).toBeVisible();
    await page.getByTestId("onboarding-starter-confirm").click();

    await expect(page.getByText("Could not write to the database.")).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding/);

    // The fallback survives the failure
    await page.getByTestId("onboarding-start-from-scratch").click();
    await expect(page.getByTestId("add-group-button")).toBeVisible();
  });

  test("the skip path still works while the starter template is offered", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/onboarding");

    await expect(page.getByTestId("onboarding-starter-template")).toBeVisible();
    await page.getByTestId("skip-onboarding-button").click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("setup-incomplete-banner")).toBeVisible();
  });
});
