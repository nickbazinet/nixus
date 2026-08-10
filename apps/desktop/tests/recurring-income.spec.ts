import { test, expect, type Page } from "@playwright/test";

/**
 * Covers the combined recurring page: expense and income templates share one table, and the
 * two summary boxes track their own active totals.
 *
 * `plugin:` commands MUST resolve null — a truthy updater response mounts an always-open modal
 * that aria-hidden()s the whole app.
 */

async function setupTauriMock(page: Page) {
  await page.addInitScript(() => {
    interface MockIncomeTemplate {
      id: number;
      source_id: number;
      source_name: string;
      income_type: string;
      amount_cents: number;
      day_of_month: number;
      account_id: number | null;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }

    const state = {
      incomeTemplates: [] as MockIncomeTemplate[],
      nextId: 1,
      expenseTemplates: [
        {
          id: 1,
          merchant: "Rent",
          amount_cents: 150000,
          budget_category_id: 1,
          day_of_month: 1,
          is_active: true,
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
        },
      ],
    };

    const sources = [
      { id: 1, name: "Acme Payroll", income_type: "employment", created_at: "", updated_at: "" },
      { id: 2, name: "Consulting", income_type: "freelance", created_at: "", updated_at: "" },
    ];

    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      transformCallback: (cb: unknown) => cb,
      invoke: (cmd: string, args: Record<string, unknown> = {}) => {
        // Plugin commands must resolve null: a truthy updater answer mounts an always-open
        // modal that aria-hidden()s the whole app.
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);
        switch (cmd) {
          // Deep-copied on read: real IPC hands back fresh JSON, and returning the cached
          // object identity would suppress the re-render React Query would normally do.
          case "get_recurring_templates":
            return Promise.resolve(JSON.parse(JSON.stringify(state.expenseTemplates)));
          case "get_recurring_income_templates":
            return Promise.resolve(JSON.parse(JSON.stringify(state.incomeTemplates)));
          case "create_recurring_income_template": {
            const source = sources.find((s) => s.id === args.source_id)!;
            const created: MockIncomeTemplate = {
              id: state.nextId++,
              source_id: source.id,
              source_name: source.name,
              income_type: source.income_type,
              amount_cents: args.amount_cents as number,
              day_of_month: args.day_of_month as number,
              account_id: (args.account_id as number | null) ?? null,
              is_active: true,
              created_at: "2026-08-01",
              updated_at: "2026-08-01",
            };
            state.incomeTemplates.push(created);
            return Promise.resolve(created);
          }
          case "update_recurring_income_template": {
            const found = state.incomeTemplates.find((tpl) => tpl.id === args.id)!;
            found.amount_cents = args.amount_cents as number;
            found.day_of_month = args.day_of_month as number;
            found.account_id = (args.account_id as number | null) ?? null;
            found.is_active = args.is_active as boolean;
            return Promise.resolve(found);
          }
          case "delete_recurring_income_template":
            state.incomeTemplates = state.incomeTemplates.filter(
              (tpl) => tpl.id !== args.id
            );
            return Promise.resolve(null);
          case "get_all_budget_categories":
          case "get_budget_categories":
            return Promise.resolve([
              { id: 1, group_id: 1, name: "Housing", target_cents: 150000, sort_order: 0, created_at: "" },
            ]);
          case "get_budget_groups":
            return Promise.resolve([{ id: 1, name: "Essentials", sort_order: 0, created_at: "" }]);
          case "get_income_sources":
            return Promise.resolve(sources);
          case "get_accounts":
            return Promise.resolve([
              { id: 7, name: "Chequing", institution: "RBC", account_type: "chequing", currency: "CAD", balance_cents: 500000, created_at: "", updated_at: "" },
            ]);
          case "get_onboarding_status":
            return Promise.resolve({ has_budget: true, has_accounts: true, has_assets: true, has_income: true });
          default:
            return Promise.resolve([]);
        }
      },
    };
  });
}

test("recurring income can be added, seen in the combined list, toggled and deleted", async ({
  page,
}) => {
  await setupTauriMock(page);
  await page.goto("/spending/recurring");

  // Two summary boxes, expense on the left and income on the right.
  await expect(page.getByTestId("recurring-committed-total")).toBeVisible();
  await expect(page.getByTestId("recurring-expected-total")).toBeVisible();
  await expect(page.getByTestId("recurring-expected-total")).toContainText("$0.00");

  // Existing expense row is tagged as an expense.
  await expect(page.getByTestId("recurring-template-row")).toHaveCount(1);
  await expect(page.getByTestId("recurring-template-row")).toContainText("Expense");
  await expect(page.getByTestId("recurring-template-row")).toContainText("Rent");

  // Add slide-over opens on the expense tab, then switches to income.
  await page.getByRole("button", { name: "Add Template" }).click();
  const slideOver = page.getByTestId("add-recurring-template-slide-over");
  await expect(slideOver.getByTestId("add-recurring-template-form")).toBeVisible();

  await page.getByTestId("recurring-add-kind-income").click();
  const form = slideOver.getByTestId("add-recurring-income-form");
  await expect(form).toBeVisible();

  await form.locator("#recurring-income-source").click();
  await page.getByRole("option", { name: "Acme Payroll" }).click();
  await form.locator("#recurring-income-amount").fill("3200.00");
  await form.locator("#recurring-income-day").fill("15");
  await form.locator("#recurring-income-account").click();
  await page.getByRole("option", { name: /Chequing/ }).click();
  await form.getByRole("button", { name: "Save Template" }).click();

  // Row lands in the same table with an Income badge, and the income box updates.
  const incomeRow = page.getByTestId("recurring-income-row");
  await expect(incomeRow).toHaveCount(1);
  await expect(incomeRow).toContainText("Income");
  await expect(incomeRow).toContainText("Acme Payroll");
  await expect(incomeRow).toContainText("Employment");
  await expect(incomeRow).toContainText("Day 15 of each month");
  await expect(incomeRow).toContainText("$3,200.00");
  await expect(page.getByTestId("recurring-expected-total")).toContainText("$3,200.00");
  await expect(page.getByTestId("recurring-active-income-count")).toContainText("1");

  // Toggling the income row off drops it out of the expected total.
  await incomeRow.getByTestId("recurring-toggle").click();
  await expect(page.getByTestId("recurring-expected-total")).toContainText("$0.00");

  // Opening the row loads the income edit form, not the expense one.
  await incomeRow.getByText("Acme Payroll").click();
  await expect(page.getByTestId("edit-recurring-income-form")).toBeVisible();
  await expect(page.locator("#edit-recurring-income-day")).toHaveValue("15");
  await page.getByRole("button", { name: "Cancel" }).click();

  // Delete removes only the income row; the expense row survives.
  await incomeRow.getByRole("button", { name: "Delete Acme Payroll" }).click();
  await page.getByTestId("confirm-delete-recurring-button").click();
  await expect(page.getByTestId("recurring-income-row")).toHaveCount(0);
  await expect(page.getByTestId("recurring-template-row")).toHaveCount(1);
});

test("recurring income form explains itself when no income source exists", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      transformCallback: (cb: unknown) => cb,
      invoke: (cmd: string) =>
        cmd.startsWith("plugin:") ? Promise.resolve(null) : Promise.resolve([]),
    };
  });
  await page.goto("/spending/recurring");

  await page.getByRole("button", { name: "Add a bill" }).click();
  await page.getByTestId("recurring-add-kind-income").click();

  await expect(page.getByTestId("recurring-income-no-sources")).toBeVisible();
});
