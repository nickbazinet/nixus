import { test, expect, type Page } from "@playwright/test";

async function setupTauriMock(page: Page) {
  await page.addInitScript(() => {
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

    const accounts: MockAccount[] = [];
    let nextAccountId = 1;

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: Record<string, unknown>) => {
        switch (cmd) {
          case "get_accounts":
            return Promise.resolve(
              [...accounts].sort((a, b) => a.name.localeCompare(b.name))
            );

          case "create_account": {
            const name = (args.name as string)?.trim();
            const institution = (args.institution as string)?.trim();
            const accountType = args.account_type as string;
            const currency = args.currency as string;

            if (!name) {
              return Promise.reject({
                type: "validation",
                message: "Account name is required",
                field: "name",
              });
            }
            if (!institution) {
              return Promise.reject({
                type: "validation",
                message: "Institution is required",
                field: "institution",
              });
            }

            const account: MockAccount = {
              id: nextAccountId++,
              name,
              institution,
              account_type: accountType,
              currency,
              balance_cents: 0,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            accounts.push(account);
            return Promise.resolve(account);
          }

          case "update_account_balance": {
            const balId = args.id as number;
            const newBalance = args.balance_cents as number;
            const acc = accounts.find((a) => a.id === balId);
            if (!acc)
              return Promise.reject({
                type: "database",
                message: "Account not found",
              });
            acc.balance_cents = newBalance;
            acc.updated_at = new Date().toISOString();
            return Promise.resolve({ ...acc });
          }

          case "update_account": {
            const updId = args.id as number;
            const updName = (args.name as string)?.trim();
            const updInstitution = (args.institution as string)?.trim();
            const updType = args.account_type as string;
            const updCurrency = args.currency as string;

            if (!updName)
              return Promise.reject({
                type: "validation",
                message: "Account name is required",
                field: "name",
              });
            if (!updInstitution)
              return Promise.reject({
                type: "validation",
                message: "Institution is required",
                field: "institution",
              });

            const accToUpdate = accounts.find((a) => a.id === updId);
            if (!accToUpdate)
              return Promise.reject({
                type: "database",
                message: "Account not found",
              });

            accToUpdate.name = updName;
            accToUpdate.institution = updInstitution;
            accToUpdate.account_type = updType;
            accToUpdate.currency = updCurrency;
            accToUpdate.updated_at = new Date().toISOString();
            return Promise.resolve({ ...accToUpdate });
          }

          case "delete_account": {
            const delId = args.id as number;
            const idx = accounts.findIndex((a) => a.id === delId);
            if (idx === -1)
              return Promise.reject({
                type: "database",
                message: "Account not found",
              });
            accounts.splice(idx, 1);
            return Promise.resolve(null);
          }

          case "get_db_status":
            return Promise.resolve({
              db_path: "mock.db",
              wal_mode: true,
              schema_version: 6,
              migrations_applied: 6,
            });

          case "get_current_net_worth":
            return Promise.resolve({
              total_cents: 50000000,
              cash_cents: 500000,
              investments_cents: 0,
              assets_cents: 46500000,
            });

          default:
            return Promise.reject(`Unknown command: ${cmd}`);
        }
      },
      convertFileSrc: (path: string) => path,
    };
  });
}

/** Helper: create an account via the UI form */
async function createAccount(
  page: Page,
  name: string,
  institution: string,
  typeLabel = "Chequing",
  currencyLabel = "CAD"
) {
  await page.getByTestId("add-account-button").click();
  const form = page.getByTestId("add-account-form");
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("Institution").fill(institution);
  await form.getByLabel("Type").click();
  await page.getByRole("option", { name: typeLabel }).click();
  await form.getByLabel("Currency").click();
  await page.getByRole("option", { name: currencyLabel }).click();
  await page.getByRole("button", { name: "Save Account" }).click();
  await expect(page.getByTestId("account-slide-over")).not.toBeVisible();
  await expect(
    page.getByTestId("account-row").filter({ hasText: name })
  ).toBeVisible();
}

test.describe("Accounts Page", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/accounts");
  });

  // === Story 4.1 Tests ===

  test("displays page header with Add Account button", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Accounts" })
    ).toBeVisible();
    await expect(page.getByTestId("add-account-button")).toBeVisible();
    await expect(page.getByTestId("add-account-button")).toContainText(
      "Add Account"
    );
    await expect(page.getByTestId("view-net-worth-button")).toBeVisible();
  });

  test("shows empty state when no accounts exist", async ({ page }) => {
    const emptyState = page.getByTestId("accounts-empty-state");
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText("No accounts yet");
    await expect(emptyState).toContainText(
      "Add chequing, savings, and investment accounts"
    );
    await expect(
      emptyState.getByRole("button", { name: /Add Account/ })
    ).toBeVisible();
    await expect(page.getByTestId("empty-view-net-worth")).toBeVisible();
    await expect(page.getByTestId("empty-import-statement")).toBeVisible();
  });

  test("clicking Add Account opens form with name, institution, type, and currency fields", async ({
    page,
  }) => {
    await page.getByTestId("add-account-button").click();

    const form = page.getByTestId("add-account-form");
    await expect(form).toBeVisible();

    await expect(form.getByLabel("Name")).toBeVisible();
    await expect(form.getByLabel("Institution")).toBeVisible();
    await expect(form.getByLabel("Type")).toBeVisible();
    await expect(form.getByLabel("Currency")).toBeVisible();
  });

  test("submitting creates account and it appears in list with $0.00 balance", async ({
    page,
  }) => {
    await page.getByTestId("add-account-button").click();

    const form = page.getByTestId("add-account-form");
    await form.getByLabel("Name").fill("Main Chequing");
    await form.getByLabel("Institution").fill("TD Bank");
    await form.getByLabel("Type").click();
    await page.getByRole("option", { name: "Chequing" }).click();
    await form.getByLabel("Currency").click();
    await page.getByRole("option", { name: "CAD" }).click();

    await page.getByRole("button", { name: "Save Account" }).click();

    const accountRow = page.getByTestId("account-row");
    await expect(accountRow).toBeVisible();
    await expect(accountRow).toContainText("Main Chequing");
    await expect(page.getByTestId("account-balance")).toContainText("$0.00");
    await expect(page.getByTestId("accounts-total")).toContainText("$0.00");
  });

  test("account row shows name, institution, type + currency, and balance in monospace", async ({
    page,
  }) => {
    await createAccount(page, "TFSA Investment", "Wealthsimple", "TFSA");

    const accountRow = page.getByTestId("account-row");
    await expect(accountRow).toContainText("TFSA Investment");
    await expect(accountRow).toContainText("Wealthsimple");
    await expect(accountRow).toContainText("TFSA");
    await expect(accountRow).toContainText("CAD");

    const balanceEl = page.getByTestId("account-balance");
    const fontFamily = await balanceEl.evaluate(
      (el) => getComputedStyle(el).fontFamily
    );
    expect(fontFamily.toLowerCase()).toContain("mono");
  });

  test("success toast appears after adding an account", async ({ page }) => {
    await page.getByTestId("add-account-button").click();

    const form = page.getByTestId("add-account-form");
    await form.getByLabel("Name").fill("Savings");
    await form.getByLabel("Institution").fill("EQ Bank");

    await page.getByRole("button", { name: "Save Account" }).click();

    await expect(page.getByText("Changes saved successfully")).toBeVisible();
  });

  test("empty state shows message and button when no accounts exist", async ({
    page,
  }) => {
    const emptyState = page.getByTestId("accounts-empty-state");
    await emptyState.getByRole("button", { name: /Add Account/ }).click();
    await expect(page.getByTestId("add-account-form")).toBeVisible();
  });

  test("form validation shows error for empty name on submit", async ({
    page,
  }) => {
    await page.getByTestId("add-account-button").click();
    await page.getByRole("button", { name: "Save Account" }).click();
    await expect(page.getByText("Account name is required")).toBeVisible();
  });

  test("form validation shows error for empty institution on submit", async ({
    page,
  }) => {
    await page.getByTestId("add-account-button").click();
    await page.getByLabel("Name").fill("Test Account");
    await page.getByRole("button", { name: "Save Account" }).click();
    await expect(page.getByText("Institution is required")).toBeVisible();
  });

  test("form closes after Cancel is clicked", async ({ page }) => {
    await page.getByTestId("add-account-button").click();
    await expect(page.getByTestId("add-account-form")).toBeVisible();

    await page.getByTestId("cancel-add-account").dispatchEvent("click");
    await expect(page.getByTestId("add-account-form")).not.toBeVisible();
  });

  // === Story 4.2 Tests ===

  test("clicking an account balance makes it an editable input field", async ({
    page,
  }) => {
    await createAccount(page, "Main Chequing", "TD Bank");

    const balance = page.getByTestId("account-balance");
    await balance.click();

    await expect(page.getByTestId("balance-edit-input")).toBeVisible();
  });

  test("typing a new balance and pressing Enter updates and shows toast", async ({
    page,
  }) => {
    await createAccount(page, "Main Chequing", "TD Bank");

    // Click balance to edit
    await page.getByTestId("account-balance").click();

    // Type new value
    const input = page.getByTestId("balance-edit-input").locator("input");
    await input.fill("1500.00");
    await input.press("Enter");

    // Toast should appear
    await expect(
      page.getByText("Changes saved successfully").last()
    ).toBeVisible();

    // Balance should show updated value
    await expect(page.getByTestId("account-balance")).toContainText(
      "$1,500.00"
    );
  });

  test("pressing Escape reverts the balance without saving", async ({
    page,
  }) => {
    await createAccount(page, "Main Chequing", "TD Bank");

    await page.getByTestId("account-balance").click();
    const input = page.getByTestId("balance-edit-input").locator("input");
    await input.fill("9999.99");
    await input.press("Escape");

    // Should revert to original
    await expect(page.getByTestId("account-balance")).toContainText("$0.00");
  });

  test("negative balances display in rose color", async ({ page }) => {
    await createAccount(page, "Credit Card", "TD Bank", "Credit Card");

    // Directly update the mock's in-memory state to have a negative balance
    await page.evaluate(() => {
      const internals = (window as unknown as Record<string, unknown>)
        .__TAURI_INTERNALS__ as {
        invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
      };
      return internals.invoke("update_account_balance", {
        id: 1,
        balance_cents: -150000,
      });
    });

    // Force TanStack Query to refetch by clicking on a link and back
    await page.getByRole("link", { name: "Budget" }).click();
    await page.getByRole("link", { name: "Accounts" }).click();

    const balance = page.getByTestId("account-balance");
    await expect(balance).toContainText("-$1,500.00");
    // Verify rose-500 class is applied (text-rose-500)
    const hasRoseClass = await balance.evaluate((el) =>
      el.classList.contains("text-rose-500")
    );
    expect(hasRoseClass).toBe(true);
  });

  test("hovering over account row reveals edit and delete actions", async ({
    page,
  }) => {
    await createAccount(page, "Main Chequing", "TD Bank");

    const row = page.getByTestId("account-row");
    await row.hover();

    await expect(page.getByTestId("edit-account-button")).toBeVisible();
    await expect(page.getByTestId("delete-account-button")).toBeVisible();
  });

  test("deleting account shows confirmation dialog and removes from list", async ({
    page,
  }) => {
    await createAccount(page, "Old Savings", "Tangerine");

    const row = page.getByTestId("account-row");
    await row.hover();
    await page.getByTestId("delete-account-button").dispatchEvent("click");

    // Dialog should show
    await expect(page.getByTestId("delete-account-dialog")).toBeVisible();
    await expect(
      page.getByText("Are you sure you want to delete Old Savings?")
    ).toBeVisible();

    // Confirm delete
    await page
      .getByTestId("confirm-delete-account-button")
      .dispatchEvent("click");

    // Toast and account gone
    await expect(page.getByText("Successfully deleted")).toBeVisible();
    await expect(page.getByTestId("accounts-empty-state")).toBeVisible();
  });

  test("multiple accounts show hero total, breakdown bar, and type groups", async ({
    page,
  }) => {
    await createAccount(page, "Main Chequing", "TD Bank", "Chequing");
    await page.getByTestId("account-balance").click();
    const input = page.getByTestId("balance-edit-input").locator("input");
    await input.fill("5000.00");
    await input.press("Enter");
    await createAccount(page, "TFSA Investment", "Wealthsimple", "TFSA");

    await expect(page.getByTestId("accounts-total")).toContainText("$5,000.00");
    await expect(page.getByTestId("accounts-breakdown")).toBeVisible();
    await expect(page.getByTestId("breakdown-bar")).toBeVisible();
    await expect(page.getByTestId("account-type-group")).toHaveCount(2);
    await expect(page.getByTestId("accounts-net-worth-context")).toBeVisible();
  });

  test("credit card accounts appear in liabilities section", async ({ page }) => {
    await createAccount(page, "Main Chequing", "TD Bank", "Chequing");
    await createAccount(page, "Visa", "TD Bank", "Credit Card");

    await expect(page.getByTestId("accounts-liability-section")).toBeVisible();
    await expect(page.getByTestId("accounts-assets-total")).toBeVisible();
    await expect(page.getByTestId("accounts-debt-total")).toBeVisible();
  });

  test("mixed currency accounts show note", async ({ page }) => {
    await createAccount(page, "CAD Account", "TD Bank", "Chequing", "CAD");
    await createAccount(page, "USD Account", "Chase", "Chequing", "USD");

    await expect(page.getByTestId("accounts-mixed-currency")).toBeVisible();
  });
});
