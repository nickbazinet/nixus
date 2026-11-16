import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * Covers recurring transfers on the recurring page: a transfer between two of the user's accounts
 * shares the table with expenses and income, and the form refuses transfers the backend would.
 *
 * `plugin:` commands MUST resolve null — a truthy updater response mounts an always-open modal
 * that aria-hidden()s the whole app.
 */

const ACCOUNTS = [
  { id: 7, name: "Chequing", institution: "RBC", account_type: "chequing", currency: "CAD", balance_cents: 500000, created_at: "", updated_at: "" },
  { id: 8, name: "Savings", institution: "RBC", account_type: "savings", currency: "CAD", balance_cents: 100000, created_at: "", updated_at: "" },
  { id: 9, name: "US Chequing", institution: "Chase", account_type: "chequing", currency: "USD", balance_cents: 20000, created_at: "", updated_at: "" },
];

async function setupTauriMock(page: Page, accounts: unknown[] = ACCOUNTS) {
  await page.addInitScript((mockAccounts) => {
    interface MockTransferTemplate {
      id: number;
      from_account_id: number;
      to_account_id: number;
      amount_cents: number;
      day_of_month: number;
      frequency: string;
      start_date: string | null;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }

    const state = {
      transferTemplates: [] as MockTransferTemplate[],
      nextId: 1,
      createCalls: 0,
    };
    (window as unknown as { __transferState: typeof state }).__transferState = state;

    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      transformCallback: (cb: unknown) => cb,
      invoke: (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);
        switch (cmd) {
          case "check_picker_gate":
            return Promise.resolve({ needs_picker: false });
          // Deep-copied on read: real IPC hands back fresh JSON, and returning the cached
          // object identity would suppress the re-render React Query would normally do.
          case "get_recurring_transfer_templates":
            return Promise.resolve(JSON.parse(JSON.stringify(state.transferTemplates)));
          case "create_recurring_transfer_template": {
            state.createCalls++;
            const created: MockTransferTemplate = {
              id: state.nextId++,
              from_account_id: args.from_account_id as number,
              to_account_id: args.to_account_id as number,
              amount_cents: args.amount_cents as number,
              day_of_month: args.day_of_month as number,
              frequency: (args.frequency as string) ?? "monthly",
              start_date: (args.start_date as string | null) ?? null,
              is_active: true,
              created_at: "2026-11-01",
              updated_at: "2026-11-01",
            };
            state.transferTemplates.push(created);
            return Promise.resolve(created);
          }
          case "update_recurring_transfer_template": {
            const found = state.transferTemplates.find((tpl) => tpl.id === args.id)!;
            found.from_account_id = args.from_account_id as number;
            found.to_account_id = args.to_account_id as number;
            found.amount_cents = args.amount_cents as number;
            found.day_of_month = args.day_of_month as number;
            found.frequency = args.frequency as string;
            found.start_date = (args.start_date as string | null) ?? null;
            found.is_active = args.is_active as boolean;
            return Promise.resolve(found);
          }
          case "delete_recurring_transfer_template":
            state.transferTemplates = state.transferTemplates.filter((tpl) => tpl.id !== args.id);
            return Promise.resolve(null);
          case "get_accounts":
            return Promise.resolve(mockAccounts);
          case "get_onboarding_status":
            return Promise.resolve({ has_budget: true, has_accounts: true, has_assets: true, has_income: true });
          // Mounted in the app shell on every screen (see project-context.md, Testing).
          case "sync_status":
            return Promise.resolve({
              state: "unlinked",
              dataset_id: "default",
              enabled: false,
              paused: false,
              last_sync_ms: null,
              error_code: null,
              recoverable: true,
              prompt: null,
            });
          case "get_user_avatar":
            return Promise.resolve(null);
          default:
            return Promise.resolve([]);
        }
      },
    };
  }, accounts);
}

// Waits for the popup to close, so the next trigger click is not swallowed by its exit animation.
async function pick(page: Page, trigger: Locator, option: string) {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

async function openTransferForm(page: Page) {
  await page.getByRole("button", { name: "Add a bill" }).click();
  await page.getByTestId("recurring-add-kind-transfer").click();
  return page.getByTestId("add-recurring-transfer-form");
}

test("a weekly transfer can be added, seen in the list, toggled, edited and deleted", async ({
  page,
}) => {
  await setupTauriMock(page);
  await page.goto("/spending/recurring");

  const form = await openTransferForm(page);
  await expect(form).toBeVisible();

  await pick(page, form.locator("#recurring-transfer-from"), "Chequing — RBC");
  await pick(page, form.locator("#recurring-transfer-to"), "Savings — RBC");
  await form.locator("#recurring-transfer-amount").fill("200.00");
  await pick(page, form.locator("#recurring-transfer-frequency"), "Weekly");
  await form.getByRole("button", { name: "Save Template" }).click();

  const weekday = new Intl.DateTimeFormat("en", { weekday: "long" }).format(new Date());
  const row = page.getByTestId("recurring-transfer-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Transfer");
  await expect(row).toContainText("Chequing → Savings");
  await expect(row).toContainText("Between accounts");
  await expect(row).toContainText(`Every ${weekday}`);
  await expect(row).toContainText("$200.00");
  await expect(page.getByTestId("recurring-active-transfer-count")).toContainText(
    "1 transfer running automatically"
  );

  // Pausing it from the list keeps the row but stops counting it.
  await row.getByTestId("recurring-toggle").click();
  await expect(page.getByTestId("recurring-active-transfer-count")).toContainText(
    "0 transfers running automatically"
  );

  // The edit form reopens on the saved accounts and amount.
  await row.getByText("Chequing → Savings").click();
  const editForm = page.getByTestId("edit-recurring-transfer-form");
  await expect(editForm).toBeVisible();
  await expect(editForm.locator("#edit-recurring-transfer-from")).toContainText("Chequing — RBC");
  await expect(editForm.locator("#edit-recurring-transfer-to")).toContainText("Savings — RBC");
  await editForm.locator("#edit-recurring-transfer-amount").fill("250.00");
  await editForm.getByRole("button", { name: "Save Template" }).click();
  await expect(row).toContainText("$250.00");

  await row.getByRole("button", { name: "Delete Chequing → Savings" }).click();
  await expect(page.getByTestId("delete-recurring-template-dialog")).toContainText(
    "This stops the $250.00 transfer from being made"
  );
  await page.getByTestId("confirm-delete-recurring-button").click();
  await expect(page.getByTestId("recurring-transfer-row")).toHaveCount(0);
});

test("the transfer form refuses the same account twice and accounts in different currencies", async ({
  page,
}) => {
  await setupTauriMock(page);
  await page.goto("/spending/recurring");

  const form = await openTransferForm(page);
  await pick(page, form.locator("#recurring-transfer-from"), "Chequing — RBC");
  await pick(page, form.locator("#recurring-transfer-to"), "Chequing — RBC");
  await form.locator("#recurring-transfer-amount").fill("200.00");
  await form.getByRole("button", { name: "Save Template" }).click();
  await expect(form).toContainText("Pick two different accounts");

  await pick(page, form.locator("#recurring-transfer-to"), "US Chequing — Chase");
  await form.getByRole("button", { name: "Save Template" }).click();
  await expect(form).toContainText("Both accounts must use the same currency");

  const createCalls = await page.evaluate(
    () => (window as unknown as { __transferState: { createCalls: number } }).__transferState.createCalls
  );
  expect(createCalls).toBe(0);
});

test("the transfer form explains itself when there are fewer than two accounts", async ({ page }) => {
  await setupTauriMock(page, [ACCOUNTS[0]]);
  await page.goto("/spending/recurring");

  await openTransferForm(page);

  await expect(page.getByTestId("recurring-transfer-needs-accounts")).toBeVisible();
});
