import { test, expect, type Page } from "@playwright/test";

/**
 * Outcome of one template command. `delayMs` keeps the pending window observable so a test can
 * assert the label swap before the mutation settles.
 */
type CommandOutcome =
  | { kind: "resolve"; value: unknown; delayMs?: number }
  | {
      kind: "reject";
      error: { type: string; message: string; field?: string };
      delayMs?: number;
    };

interface TemplateOutcomes {
  import_budget_template?: CommandOutcome;
  export_budget_template?: CommandOutcome;
  list_system_templates?: CommandOutcome;
  apply_system_template?: CommandOutcome;
}

/**
 * Boots the Your Data surface against a mocked Tauri IPC layer.
 *
 * `plugin:` commands MUST resolve null: a truthy updater response makes UpdateChecker render an
 * always-open Dialog, and Base UI's focus trap then puts aria-hidden="true" on the whole app.
 *
 * Neither `plugin:dialog|open` nor `plugin:dialog|save` is stubbed. Both template dialogs are
 * opened inside the Rust command, so the only IPC traffic is the command itself — unlike the
 * statement-import flow, where the frontend opens the picker via @tauri-apps/plugin-dialog.
 */
async function setupTauriMock(page: Page, outcomes: TemplateOutcomes = {}) {
  await page.addInitScript((templateOutcomes: TemplateOutcomes) => {
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
    // Mirrors the English-only Rust consts: no target amounts cross this boundary.
    const systemTemplates = [
      {
        id: "canadian-starter",
        name: "Canadian Starter Budget",
        description:
          "Common Canadian household categories with suggested monthly targets. Adjust every target to match your situation.",
      },
    ];

    const settle = (outcome: CommandOutcome): Promise<unknown> => {
      const run = () =>
        outcome.kind === "reject"
          ? Promise.reject(outcome.error)
          : Promise.resolve(outcome.value);
      if (outcome.delayMs === undefined) return run();
      return new Promise((resolve, reject) => {
        setTimeout(() => run().then(resolve, reject), outcome.delayMs);
      });
    };

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
          case "import_budget_template":
          case "export_budget_template": {
            const outcome = templateOutcomes[cmd];
            return outcome === undefined ? Promise.resolve(null) : settle(outcome);
          }
          case "list_system_templates": {
            const outcome = templateOutcomes.list_system_templates;
            return outcome === undefined
              ? Promise.resolve(systemTemplates)
              : settle(outcome);
          }
          case "apply_system_template": {
            const outcome = templateOutcomes.apply_system_template;
            return outcome === undefined
              ? Promise.resolve({ groups_created: 4, categories_created: 12, skipped_groups: [] })
              : settle(outcome);
          }
          case "check_picker_gate":
            return Promise.resolve({ needs_picker: false });
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
            return Promise.resolve([]);
          case "get_accounts":
            return Promise.resolve(accounts);
          case "get_assets":
            return Promise.resolve(assets);
          case "get_current_net_worth":
            return Promise.resolve({ total_cents: 50150000, cash_cents: 150000, investments_cents: 0, assets_cents: 50000000 });
          case "get_recent_net_worth_snapshots":
            return Promise.resolve([]);
          case "get_spending_breakdown":
            return Promise.resolve([]);
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
          default:
            return Promise.reject(`Unknown command: ${cmd}`);
        }
      },
      convertFileSrc: (path: string) => path,
    };
  }, outcomes);
}

/** The Your Data tab is a `?section=` sub-surface of one route: `/settings` lands on General. */
async function gotoYourData(page: Page) {
  await page.goto("/settings/ai-provider?section=data");
  await expect(page.getByTestId("settings-your-data")).toBeVisible();
}

test.describe("budget template import", () => {
  test("applies a shared template and reports the groups it skipped", async ({ page }) => {
    await setupTauriMock(page, {
      import_budget_template: {
        kind: "resolve",
        value: { groups_created: 2, categories_created: 7, skipped_groups: ["Housing", "Transportation"] },
      },
    });
    await gotoYourData(page);

    await page.getByTestId("your-data-template-import").click();

    await expect(
      page.getByText(/Skipped: Housing, Transportation \(already exist\)/)
    ).toBeVisible();
    await expect(page.getByTestId("your-data-error")).toHaveCount(0);
  });

  test("says nothing was added when every group already exists", async ({ page }) => {
    await setupTauriMock(page, {
      import_budget_template: {
        kind: "resolve",
        value: { groups_created: 0, categories_created: 0, skipped_groups: ["Housing"] },
      },
    });
    await gotoYourData(page);

    await page.getByTestId("your-data-template-import").click();

    // "Template applied — added 0 groups" would be a near-lie: nothing was created.
    await expect(
      page.getByText(/every group in this template already exists: Housing/)
    ).toBeVisible();
    await expect(page.getByText(/Template applied/)).toHaveCount(0);
    await expect(page.getByTestId("your-data-error")).toHaveCount(0);
  });

  test("stays silent when the user cancels the file picker", async ({ page }) => {
    await setupTauriMock(page, {
      import_budget_template: { kind: "resolve", value: null, delayMs: 400 },
    });
    await gotoYourData(page);

    const importButton = page.getByTestId("your-data-template-import");
    await importButton.click();

    // The delayed null makes the pending label observable, then proves the mutation settled —
    // so the "no toast" assertions below run after the only moment a toast could have appeared.
    await expect(importButton).toHaveText("Opening…");
    await expect(importButton).toHaveText("Open a template");

    await expect(page.getByText(/Template applied/)).toHaveCount(0);
    await expect(page.getByText(/Nothing to add/)).toHaveCount(0);
    await expect(page.getByTestId("your-data-error")).toHaveCount(0);
  });

  test("shows the backend message when the file is not a template", async ({ page }) => {
    await setupTauriMock(page, {
      import_budget_template: {
        kind: "reject",
        error: { type: "file", message: "This file is not a valid Nixus budget template." },
      },
    });
    await gotoYourData(page);

    await page.getByTestId("your-data-template-import").click();

    await expect(page.getByTestId("your-data-error")).toContainText(
      "This file is not a valid Nixus budget template."
    );
  });

  test("disables the backup and restore controls while an import is in flight", async ({ page }) => {
    await setupTauriMock(page, {
      import_budget_template: { kind: "resolve", value: null, delayMs: 600 },
    });
    await gotoYourData(page);

    await page.getByTestId("your-data-template-import").click();

    await expect(page.getByTestId("your-data-save-copy")).toBeDisabled();
    await expect(page.getByTestId("your-data-restore")).toBeDisabled();
    await expect(page.getByTestId("your-data-template-export")).toBeDisabled();
  });
});

test.describe("budget template export", () => {
  test("saves the budget as a template and reports where it landed", async ({ page }) => {
    await setupTauriMock(page, {
      export_budget_template: {
        kind: "resolve",
        value: { path: "/tmp/budget-template-my-budget-2026-08-04.json" },
      },
    });
    await gotoYourData(page);

    await page.getByTestId("your-data-template-export").click();

    await expect(
      page.getByText("/tmp/budget-template-my-budget-2026-08-04.json")
    ).toBeVisible();
    await expect(page.getByTestId("your-data-error")).toHaveCount(0);
  });

  test("stays silent when the user cancels the save dialog", async ({ page }) => {
    await setupTauriMock(page, {
      export_budget_template: { kind: "resolve", value: null, delayMs: 400 },
    });
    await gotoYourData(page);

    const exportButton = page.getByTestId("your-data-template-export");
    await exportButton.click();

    await expect(exportButton).toHaveText("Saving…");
    await expect(exportButton).toHaveText("Save as template");

    await expect(page.getByText(/Template saved to/)).toHaveCount(0);
    await expect(page.getByTestId("your-data-error")).toHaveCount(0);
  });

  test("shows the backend message when there is nothing to export", async ({ page }) => {
    await setupTauriMock(page, {
      export_budget_template: {
        kind: "reject",
        error: {
          type: "file",
          message: "There is nothing to export yet. Create at least one budget category first.",
        },
      },
    });
    await gotoYourData(page);

    await page.getByTestId("your-data-template-export").click();

    await expect(page.getByTestId("your-data-error")).toContainText(
      "There is nothing to export yet. Create at least one budget category first."
    );
  });
});

test.describe("system starter budget", () => {
  const applyButton = "your-data-template-apply-canadian-starter";

  test("applies the starter budget and reports the counts", async ({ page }) => {
    await setupTauriMock(page, {
      apply_system_template: {
        kind: "resolve",
        value: { groups_created: 4, categories_created: 12, skipped_groups: [] },
      },
    });
    await gotoYourData(page);

    const button = page.getByTestId(applyButton);
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    await expect(page.getByTestId("setting-template-starter-canadian-starter")).toContainText(
      "Canadian starter budget"
    );

    await button.click();

    // The counts alone are not enough: the starter's targets are authored in Rust, so the toast
    // has to say they are not locked in.
    await expect(
      page.getByText(
        /Added 4 groups and 12 categories to your budget\. Every target is editable from the Budget page\./
      )
    ).toBeVisible();
    await expect(page.getByTestId("your-data-error")).toHaveCount(0);
  });

  test("names the groups it skipped", async ({ page }) => {
    await setupTauriMock(page, {
      apply_system_template: {
        kind: "resolve",
        value: { groups_created: 2, categories_created: 6, skipped_groups: ["Housing", "Savings"] },
      },
    });
    await gotoYourData(page);

    await page.getByTestId(applyButton).click();

    await expect(
      page.getByText(/Added 2 groups and 6 categories\. Skipped: Housing, Savings \(already exist\)/)
    ).toBeVisible();
    await expect(page.getByTestId("your-data-error")).toHaveCount(0);
  });

  test("says nothing was added when every group already existed", async ({ page }) => {
    await setupTauriMock(page, {
      apply_system_template: {
        kind: "resolve",
        value: {
          groups_created: 0,
          categories_created: 0,
          skipped_groups: ["Housing", "Transportation", "Living", "Savings"],
        },
      },
    });
    await gotoYourData(page);

    await page.getByTestId(applyButton).click();

    // "Added 0 groups and 0 categories" would read as a success while nothing happened.
    await expect(
      page.getByText(
        /Nothing added — you already have every group in this starter budget: Housing, Transportation, Living, Savings/
      )
    ).toBeVisible();
    await expect(page.getByText(/Added \d+ groups/)).toHaveCount(0);
    await expect(page.getByTestId("your-data-error")).toHaveCount(0);
  });

  test("surfaces a rejected apply in the page alert", async ({ page }) => {
    await setupTauriMock(page, {
      apply_system_template: {
        kind: "reject",
        error: {
          type: "validation",
          message: "That starter template is not available.",
          field: "template_id",
        },
      },
    });
    await gotoYourData(page);

    const button = page.getByTestId(applyButton);
    await button.click();

    await expect(page.getByTestId("your-data-error")).toContainText(
      "That starter template is not available."
    );
    await expect(button).toHaveText("Add to my budget");
    await expect(page.getByText(/Added \d+ groups/)).toHaveCount(0);
  });

  test("shows a fallback row when no starter budget exists", async ({ page }) => {
    await setupTauriMock(page, {
      list_system_templates: { kind: "resolve", value: [] },
    });
    await gotoYourData(page);

    await expect(page.getByTestId("setting-template-starter-empty")).toBeVisible();
    await expect(page.getByTestId("setting-template-starter-empty")).toContainText(
      "No starter budget is available."
    );
    await expect(page.getByTestId(applyButton)).toHaveCount(0);
  });

  test("falls back to the backend copy for a template with no i18n keys", async ({ page }) => {
    await setupTauriMock(page, {
      list_system_templates: {
        kind: "resolve",
        value: [
          { id: "future-starter", name: "Future Starter", description: "Backend description." },
        ],
      },
    });
    await gotoYourData(page);

    // A system template added in Rust before its i18n keys exist must still read as copy, not as
    // a raw "settings.template…" key string.
    const row = page.getByTestId("setting-template-starter-future-starter");
    await expect(row).toContainText("Future Starter");
    await expect(row).toContainText("Backend description.");
    await expect(row).not.toContainText("settings.template");
    await expect(page.getByTestId("your-data-template-apply-future-starter")).toBeEnabled();
  });

  test("disables every other data control while a starter apply is in flight", async ({ page }) => {
    await setupTauriMock(page, {
      apply_system_template: {
        kind: "resolve",
        value: { groups_created: 4, categories_created: 12, skipped_groups: [] },
        delayMs: 600,
      },
    });
    await gotoYourData(page);

    const button = page.getByTestId(applyButton);
    await button.click();

    await expect(button).toHaveText("Adding…");
    await expect(page.getByTestId("your-data-save-copy")).toBeDisabled();
    await expect(page.getByTestId("your-data-restore")).toBeDisabled();
    await expect(page.getByTestId("your-data-template-export")).toBeDisabled();
    await expect(page.getByTestId("your-data-template-import")).toBeDisabled();

    await expect(button).toHaveText("Add to my budget");
  });
});
