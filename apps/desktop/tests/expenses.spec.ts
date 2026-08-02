import { test, expect, type Page } from "@playwright/test";

/**
 * Sets up Tauri IPC mocks with budget groups, categories, and expense support.
 */
async function setupTauriMock(page: Page) {
  await page.addInitScript(() => {
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
    interface MockExpense {
      id: number;
      merchant: string;
      amount_cents: number;
      budget_category_id: number;
      account_id: number | null;
      date: string;
      source: string;
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
    interface MockState {
      groups: MockGroup[];
      categories: MockCategory[];
      expenses: MockExpense[];
      accounts: MockAccount[];
      nextExpenseId: number;
      nextGroupId: number;
      nextCategoryId: number;
    }

    const win = window as typeof window & { __EXPENSE_MOCK_STATE__?: MockState };
    if (!win.__EXPENSE_MOCK_STATE__) {
      win.__EXPENSE_MOCK_STATE__ = {
        groups: [
          { id: 1, name: "Essentials", sort_order: 0, created_at: new Date().toISOString() },
        ],
        categories: [
          { id: 1, group_id: 1, name: "Housing", target_cents: 70000, sort_order: 0, created_at: new Date().toISOString() },
          { id: 2, group_id: 1, name: "Food", target_cents: 30000, sort_order: 1, created_at: new Date().toISOString() },
        ],
        expenses: [],
        accounts: [
          {
            id: 1,
            name: "Main Chequing",
            institution: "TD Bank",
            account_type: "chequing",
            currency: "CAD",
            balance_cents: 100_000,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        nextExpenseId: 1,
        nextGroupId: 2,
        nextCategoryId: 3,
      };
    }

    const state = win.__EXPENSE_MOCK_STATE__;
    const { groups, categories, expenses, accounts } = state;

    function adjustChequingBalance(accountId: number, deltaCents: number) {
      const account = accounts.find((a) => a.id === accountId);
      if (account && account.account_type === "chequing") {
        account.balance_cents += deltaCents;
        account.updated_at = new Date().toISOString();
      }
    }

    // Unlisten cleanup calls into this namespace; without it teardown throws.
    (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ =
      { unregisterListener: () => {} };

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: (cmd: string, args: Record<string, unknown>) => {
        // Plugin commands (updater, etc.) must resolve null: a truthy updater
        // response opens a modal Dialog that aria-hides the whole app.
        if (cmd.startsWith("plugin:")) {
          return Promise.resolve(null);
        }
        switch (cmd) {
          case "get_budget_groups":
            return Promise.resolve(groups);

          case "create_budget_group": {
            const name = args.name as string;
            if (!name || !name.trim()) {
              return Promise.reject({ type: "validation", message: "Group name is required", field: "name" });
            }
            const group: MockGroup = {
              id: state.nextGroupId++,
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

          case "get_all_budget_categories":
            return Promise.resolve([...categories]);

          case "get_accounts":
            return Promise.resolve(
              [...accounts].sort((a, b) => a.name.localeCompare(b.name))
            );

          case "get_current_net_worth":
            return Promise.resolve({
              total_cents: accounts.reduce((sum, a) => sum + a.balance_cents, 0),
              cash_cents: accounts.reduce((sum, a) => sum + a.balance_cents, 0),
              investments_cents: 0,
              assets_cents: 0,
              liabilities_cents: 0,
            });

          case "create_budget_category": {
            const catName = args.name as string;
            const targetCents = args.target_cents as number;
            const catGroupId = args.group_id as number;
            if (!catName || !catName.trim()) {
              return Promise.reject({ type: "validation", message: "Category name is required", field: "name" });
            }
            if (!targetCents || targetCents <= 0) {
              return Promise.reject({ type: "validation", message: "Target must be greater than 0", field: "target_cents" });
            }
            const category: MockCategory = {
              id: state.nextCategoryId++,
              group_id: catGroupId,
              name: catName.trim(),
              target_cents: targetCents,
              sort_order: categories.filter((c) => c.group_id === catGroupId).length,
              created_at: new Date().toISOString(),
            };
            categories.push(category);
            return Promise.resolve(category);
          }

          case "update_budget_group": {
            const updateGroupId = args.id as number;
            const newGroupName = (args.name as string)?.trim();
            if (!newGroupName) {
              return Promise.reject({ type: "validation", message: "Group name is required", field: "name" });
            }
            const g = groups.find((g) => g.id === updateGroupId);
            if (!g) return Promise.reject({ type: "database", message: "Budget group not found" });
            g.name = newGroupName;
            return Promise.resolve({ ...g });
          }

          case "update_budget_category": {
            const updateCatId = args.id as number;
            const newCatName = args.name as string | null;
            const newTargetCents = args.target_cents as number | null;
            const cat = categories.find((c) => c.id === updateCatId);
            if (!cat) return Promise.reject({ type: "database", message: "Budget category not found" });
            if (newCatName !== null && newCatName !== undefined) {
              const trimmed = newCatName.trim();
              if (!trimmed) return Promise.reject({ type: "validation", message: "Category name is required", field: "name" });
              cat.name = trimmed;
            }
            if (newTargetCents !== null && newTargetCents !== undefined) {
              if (newTargetCents <= 0) return Promise.reject({ type: "validation", message: "Target must be greater than 0", field: "target_cents" });
              cat.target_cents = newTargetCents;
            }
            return Promise.resolve({ ...cat });
          }

          case "delete_budget_category": {
            const delCatId = args.id as number;
            const idx = categories.findIndex((c) => c.id === delCatId);
            if (idx === -1) return Promise.reject({ type: "database", message: "Budget category not found" });
            categories.splice(idx, 1);
            return Promise.resolve(null);
          }

          case "delete_budget_group": {
            const delGroupId = args.id as number;
            if (categories.some((c) => c.group_id === delGroupId)) {
              return Promise.reject({ type: "validation", message: "Remove all categories first" });
            }
            const gIdx = groups.findIndex((g) => g.id === delGroupId);
            if (gIdx === -1) return Promise.reject({ type: "database", message: "Budget group not found" });
            groups.splice(gIdx, 1);
            return Promise.resolve(null);
          }

          case "create_expense": {
            const merchant = (args.merchant as string)?.trim();
            const amountCents = args.amount_cents as number;
            const categoryId = args.budget_category_id as number;
            const date = args.date as string;
            const accountId = (args.account_id as number | null | undefined) ?? null;

            if (!merchant) {
              return Promise.reject({ type: "validation", message: "Merchant name is required", field: "merchant" });
            }
            if (!amountCents || amountCents <= 0) {
              return Promise.reject({ type: "validation", message: "Amount must be greater than 0", field: "amount_cents" });
            }
            if (!categories.some((c) => c.id === categoryId)) {
              return Promise.reject({ type: "validation", message: "Budget category not found", field: "budget_category_id" });
            }
            if (accountId !== null && !accounts.some((a) => a.id === accountId)) {
              return Promise.reject({ type: "validation", message: "Account not found", field: "account_id" });
            }

            const expense: MockExpense = {
              id: state.nextExpenseId++,
              merchant,
              amount_cents: amountCents,
              budget_category_id: categoryId,
              account_id: accountId,
              date,
              source: "manual",
              created_at: new Date().toISOString(),
            };
            expenses.push(expense);
            if (accountId !== null) {
              adjustChequingBalance(accountId, -amountCents);
            }
            return Promise.resolve(expense);
          }

          case "update_expense": {
            const updateId = args.id as number;
            const updMerchant = (args.merchant as string)?.trim();
            const updAmount = args.amount_cents as number;
            const updCategoryId = args.budget_category_id as number;
            const updDate = args.date as string;
            const updAccountId = (args.account_id as number | null | undefined) ?? null;

            if (!updMerchant) {
              return Promise.reject({ type: "validation", message: "Merchant name is required", field: "merchant" });
            }
            if (!updAmount || updAmount <= 0) {
              return Promise.reject({ type: "validation", message: "Amount must be greater than 0", field: "amount_cents" });
            }

            const expToUpdate = expenses.find((e) => e.id === updateId);
            if (!expToUpdate) {
              return Promise.reject({ type: "database", message: "Expense not found" });
            }

            if (expToUpdate.account_id !== null) {
              adjustChequingBalance(expToUpdate.account_id, expToUpdate.amount_cents);
            }
            if (updAccountId !== null) {
              adjustChequingBalance(updAccountId, -updAmount);
            }

            expToUpdate.merchant = updMerchant;
            expToUpdate.amount_cents = updAmount;
            expToUpdate.budget_category_id = updCategoryId;
            expToUpdate.date = updDate;
            expToUpdate.account_id = updAccountId;
            return Promise.resolve({ ...expToUpdate });
          }

          case "delete_expense": {
            const delExpId = args.id as number;
            const expIdx = expenses.findIndex((e) => e.id === delExpId);
            if (expIdx === -1) {
              return Promise.reject({ type: "database", message: "Expense not found" });
            }
            const deleted = expenses[expIdx];
            if (deleted.account_id !== null) {
              adjustChequingBalance(deleted.account_id, deleted.amount_cents);
            }
            expenses.splice(expIdx, 1);
            return Promise.resolve(null);
          }

          case "get_expenses": {
            const expYear = args.year as number;
            const expMonth = args.month as number;
            const startDate = `${String(expYear).padStart(4, "0")}-${String(expMonth).padStart(2, "0")}-01`;
            const nextMonth = expMonth === 12 ? 1 : expMonth + 1;
            const nextYear = expMonth === 12 ? expYear + 1 : expYear;
            const endDate = `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
            return Promise.resolve(
              expenses.filter((e) => e.date >= startDate && e.date < endDate)
            );
          }

          case "get_budget_status": {
            // Compute spent from expenses for each category
            return Promise.resolve(
              categories.map((c) => {
                const spent = expenses
                  .filter((e) => e.budget_category_id === c.id)
                  .reduce((sum, e) => sum + e.amount_cents, 0);
                return {
                  id: c.id,
                  group_id: c.group_id,
                  name: c.name,
                  target_cents: c.target_cents,
                  spent_cents: spent,
                  is_deleted: false,
                };
              })
            );
          }

          case "get_budget_summary": {
            const totalTarget = categories.reduce((sum, c) => sum + c.target_cents, 0);
            const summaryYear = args.year as number;
            const summaryMonth = args.month as number;
            const prefix = `${String(summaryYear).padStart(4, "0")}-${String(summaryMonth).padStart(2, "0")}`;
            const totalSpent = expenses
              .filter((e) => e.date.startsWith(prefix))
              .reduce((sum, e) => sum + e.amount_cents, 0);
            return Promise.resolve({
              total_target_cents: totalTarget,
              total_spent_cents: totalSpent,
              remaining_cents: totalTarget - totalSpent,
              month: prefix,
            });
          }

          case "get_db_status":
            return Promise.resolve({
              db_path: "mock.db",
              wal_mode: true,
              schema_version: 3,
              migrations_applied: 3,
            });

          default:
            return Promise.reject(`Unknown command: ${cmd}`);
        }
      },
      convertFileSrc: (path: string) => path,
    };
  });
}

function financeNav(page: Page) {
  return page.getByRole("navigation", { name: "Finance navigation" });
}

async function gotoAccounts(page: Page) {
  await financeNav(page).getByRole("link", { name: "Wealth" }).click();
  await expect(
    page.getByRole("link", { name: "Accounts" })
  ).toHaveAttribute("aria-current", "page");
}

async function gotoBudget(page: Page) {
  await financeNav(page).getByRole("link", { name: "Spending" }).click();
  await expect(page.getByRole("link", { name: "Budget" })).toHaveAttribute(
    "aria-current",
    "page"
  );
}

test.describe("Expense Tracking", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/spending/budget");
  });

  test("clicking Add Expense opens the form with all fields including optional account", async ({ page }) => {
    await page.getByTestId("add-expense-button").click();

    const form = page.getByTestId("add-expense-form");
    await expect(form).toBeVisible();

    await expect(form.getByLabel("Merchant")).toBeVisible();
    await expect(form.getByLabel("Amount")).toBeVisible();
    await expect(form.getByLabel("Category")).toBeVisible();
    await expect(form.getByLabel("Account (optional)")).toBeVisible();
    await expect(form.getByLabel("Date")).toBeVisible();
  });

  test("submitting a valid expense shows a success toast", async ({ page }) => {
    await page.getByTestId("add-expense-button").click();
    const form = page.getByTestId("add-expense-form");

    // Fill the form
    await form.getByLabel("Merchant").fill("Grocery Store");
    await form.getByLabel("Amount").fill("45.99");
    await form.getByLabel("Category").click();
    await page.getByRole("option", { name: "Housing" }).click();

    // Date defaults to today, leave it

    // Submit
    await page.getByRole("button", { name: "Save Expense" }).click();

    // Success toast should appear
    await expect(page.getByText('"Grocery Store" saved')).toBeVisible();

    // Form should close
    await expect(page.getByTestId("add-expense-form")).not.toBeVisible();
  });

  test("budget category spent amount updates after adding an expense", async ({ page }) => {
    // Verify initial spent is $0.00
    const spentTargets = page.getByTestId("spent-target");
    await expect(spentTargets.first()).toContainText("$0.00");

    // Add an expense to Housing category
    await page.getByTestId("add-expense-button").click();
    const form = page.getByTestId("add-expense-form");
    await form.getByLabel("Merchant").fill("Rent Payment");
    await form.getByLabel("Amount").fill("1200");
    await form.getByLabel("Category").click();
    await page.getByRole("option", { name: "Housing" }).click();
    await page.getByRole("button", { name: "Save Expense" }).click();

    // Wait for success toast
    await expect(page.getByText('"Rent Payment" saved')).toBeVisible();

    // The Housing category's spent amount should now show $1,200.00
    await expect(spentTargets.first()).toContainText("$1,200.00");
  });

  test("form validation prevents submission with empty merchant", async ({ page }) => {
    await page.getByTestId("add-expense-button").click();

    // Submit without filling merchant
    await page.getByRole("button", { name: "Save Expense" }).click();

    await expect(page.getByText("Merchant name is required")).toBeVisible();
  });

  test("form validation prevents submission with zero amount", async ({ page }) => {
    await page.getByTestId("add-expense-button").click();
    const form = page.getByTestId("add-expense-form");

    // Fill merchant but leave amount at 0, then submit
    await form.getByLabel("Merchant").fill("Test");
    await form.getByLabel("Category").click();
    await page.getByRole("option", { name: "Housing" }).click();
    await page.getByRole("button", { name: "Save Expense" }).click();

    await expect(page.getByText("Amount must be greater than $0")).toBeVisible();
  });

  test("expanding a category with no expenses shows 'No expenses this month'", async ({ page }) => {
    // Click the category expand toggle on Housing
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();

    // Should show empty state
    await expect(page.getByTestId("no-expenses-message")).toBeVisible();
    await expect(page.getByText("No expenses this month")).toBeVisible();
  });

  test("expanding a category after adding an expense shows the expense row", async ({ page }) => {
    // Add an expense
    await page.getByTestId("add-expense-button").click();
    const form = page.getByTestId("add-expense-form");
    await form.getByLabel("Merchant").fill("Coffee Shop");
    await form.getByLabel("Amount").fill("5.50");
    await form.getByLabel("Category").click();
    await page.getByRole("option", { name: "Housing" }).click();
    await page.getByRole("button", { name: "Save Expense" }).click();
    await expect(page.getByText('"Coffee Shop" saved')).toBeVisible();

    // Expand the Housing category
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();

    // Should show the expense
    await expect(page.getByTestId("expense-list")).toBeVisible();
    await expect(page.getByTestId("expense-merchant")).toContainText("Coffee Shop");
    await expect(page.getByTestId("expense-amount")).toContainText("$5.50");
  });

  test("expense list is a real table: sentence-case sortable heads, right-aligned tabular amount", async ({ page }) => {
    // Add an expense
    await page.getByTestId("add-expense-button").click();
    const form = page.getByTestId("add-expense-form");
    await form.getByLabel("Merchant").fill("Grocery Store");
    await form.getByLabel("Amount").fill("45.99");
    await form.getByLabel("Category").click();
    await page.getByRole("option", { name: "Housing" }).click();
    await page.getByRole("button", { name: "Save Expense" }).click();
    await expect(page.getByText('"Grocery Store" saved')).toBeVisible();

    // Expand
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();

    const table = page.getByTestId("expense-list").getByRole("table");
    await expect(table).toBeVisible();

    const heads = table.getByRole("columnheader");
    // Select-all, Date, Merchant, Account, Amount — no Category column inside a category row.
    await expect(heads).toHaveCount(5);
    await expect(heads.nth(1)).toHaveText("Date");
    await expect(heads.nth(2)).toHaveText("Merchant");
    await expect(heads.nth(3)).toHaveText("Account");
    await expect(heads.nth(4)).toHaveText("Amount");

    // Sortable heads must carry aria-sort: the arrow glyph alone is invisible to a screen reader.
    await expect(heads.nth(1)).toHaveAttribute("aria-sort", "descending");
    await expect(heads.nth(2)).toHaveAttribute("aria-sort", "none");
    await expect(heads.nth(4)).toHaveAttribute("aria-sort", "none");
    await expect(heads.nth(3)).not.toHaveAttribute("aria-sort", /.*/);

    // Sentence case, not the uppercase shouting the old header used.
    expect(
      await heads.nth(1).evaluate((el) => getComputedStyle(el).textTransform)
    ).toBe("none");

    const row = table.getByRole("row").filter({ hasText: "Grocery Store" });
    await expect(row.getByTestId("expense-date")).toBeVisible();
    await expect(row.getByTestId("expense-merchant")).toHaveText("Grocery Store");

    // Amounts are right-aligned and tabular so a column of them is comparable at a glance — the
    // alignment monospace used to buy, without a code font on a financial figure.
    const amountCell = row.getByTestId("expense-amount");
    await expect(amountCell).toContainText("$45.99");
    const { textAlign, fontFamily, fontVariantNumeric } = await amountCell.evaluate(
      (el) => {
        const style = getComputedStyle(el);
        return {
          textAlign: style.textAlign,
          fontFamily: style.fontFamily,
          fontVariantNumeric: style.fontVariantNumeric,
        };
      }
    );
    expect(textAlign).toBe("right");
    expect(fontVariantNumeric).toContain("tabular-nums");
    expect(fontFamily.toLowerCase()).not.toContain("mono");
  });

  test("search placeholder promises only what it does: merchant substrings", async ({ page }) => {
    for (const merchant of ["Coffee Shop", "Grocery Store"]) {
      await page.getByTestId("add-expense-button").click();
      const addForm = page.getByTestId("add-expense-form");
      await addForm.getByLabel("Merchant").fill(merchant);
      await addForm.getByLabel("Amount").fill("10");
      await addForm.getByLabel("Category").click();
      await page.getByRole("option", { name: "Housing" }).click();
      await page.getByRole("button", { name: "Save Expense" }).click();
      await expect(page.getByText(`"${merchant}" saved`)).toBeVisible();
    }

    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();

    const search = page.getByTestId("expense-search");
    await expect(search).toHaveAttribute("placeholder", "Search merchants");

    await search.fill("coffee");
    await expect(page.getByTestId("expense-merchant")).toHaveText("Coffee Shop");
    await expect(page.getByTestId("expense-count")).toHaveText("1 expense");

    // Matching is merchant-only, so a category name must not match.
    await search.fill("Housing");
    await expect(page.getByTestId("expense-no-match")).toBeVisible();
    await expect(
      page.getByText("Nixus searches merchant names only — not categories or notes.")
    ).toBeVisible();
  });

  test("navigating to a different month clears expenses if none exist for that month", async ({ page }) => {
    // Add an expense for current month
    await page.getByTestId("add-expense-button").click();
    const form = page.getByTestId("add-expense-form");
    await form.getByLabel("Merchant").fill("Rent");
    await form.getByLabel("Amount").fill("1200");
    await form.getByLabel("Category").click();
    await page.getByRole("option", { name: "Housing" }).click();
    await page.getByRole("button", { name: "Save Expense" }).click();
    await expect(page.getByText('"Rent" saved')).toBeVisible();

    // Expand Housing category
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();
    await expect(page.getByTestId("expense-merchant")).toContainText("Rent");

    // Navigate to next month — expanded state persists, expenses should update
    await page.getByTestId("next-month-button").click();

    // The category is still expanded — should now show empty state for next month
    await expect(page.getByText("No expenses this month")).toBeVisible();
  });

  test("expense row actions need no hover: row activates, select control rests visible", async ({ page }) => {
    // Add an expense
    await page.getByTestId("add-expense-button").click();
    const form = page.getByTestId("add-expense-form");
    await form.getByLabel("Merchant").fill("Coffee Shop");
    await form.getByLabel("Amount").fill("5.50");
    await form.getByLabel("Category").click();
    await page.getByRole("option", { name: "Housing" }).click();
    await page.getByRole("button", { name: "Save Expense" }).click();
    await expect(page.getByText('"Coffee Shop" saved')).toBeVisible();

    // Expand category
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();

    // Hover-revealed icons are gone. Editing is the row itself and deleting is the row's checkbox,
    // both of which rest visible — deliberately, since a keyboard user never hovers. No hover() call
    // appears below on purpose.
    const expenseRow = page.getByTestId("expense-row").first();
    await expect(expenseRow.getByTestId("select-expense")).toBeVisible();
    await expect(expenseRow).toHaveAttribute("aria-label", "Open Coffee Shop");
    await expect(expenseRow).toHaveAttribute("tabindex", "0");

    // Keyboard activation must reach the same editor a click does.
    await expenseRow.focus();
    await expenseRow.press("Enter");
    await expect(page.getByTestId("edit-expense-form")).toBeVisible();
  });

  test("activating a row opens the editor pre-populated with expense values", async ({ page }) => {
    // Add expense
    await page.getByTestId("add-expense-button").click();
    const form = page.getByTestId("add-expense-form");
    await form.getByLabel("Merchant").fill("Coffee Shop");
    await form.getByLabel("Amount").fill("5.50");
    await form.getByLabel("Category").click();
    await page.getByRole("option", { name: "Housing" }).click();
    await page.getByRole("button", { name: "Save Expense" }).click();
    await expect(page.getByText('"Coffee Shop" saved')).toBeVisible();

    // Expand and open the row
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();
    await page.getByTestId("expense-row").first().click();

    // Edit form should appear in the slide-over with pre-populated values
    await expect(page.getByTestId("edit-expense-slide-over")).toBeVisible();
    const editForm = page.getByTestId("edit-expense-form");
    await expect(editForm).toBeVisible();
    await expect(editForm.getByLabel("Merchant")).toHaveValue("Coffee Shop");
    await expect(editForm.getByLabel("Amount")).toHaveValue("5.50");
  });

  test("saving an edited expense updates displayed values and shows success toast", async ({ page }) => {
    // Add expense
    await page.getByTestId("add-expense-button").click();
    const form = page.getByTestId("add-expense-form");
    await form.getByLabel("Merchant").fill("Coffee Shop");
    await form.getByLabel("Amount").fill("5.50");
    await form.getByLabel("Category").click();
    await page.getByRole("option", { name: "Housing" }).click();
    await page.getByRole("button", { name: "Save Expense" }).click();
    await expect(page.getByText('"Coffee Shop" saved')).toBeVisible();

    // Expand and edit
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();
    await page.getByTestId("expense-row").first().click();

    // Change merchant name
    const editForm = page.getByTestId("edit-expense-form");
    await editForm.getByLabel("Merchant").fill("Fancy Coffee");
    await editForm.getByRole("button", { name: "Save", exact: true }).click();

    // Success toast
    await expect(page.getByText("Expense updated")).toBeVisible();

    // Updated merchant should show
    await expect(page.getByTestId("expense-merchant")).toContainText("Fancy Coffee");
  });

  test("selecting a row and deleting shows confirmation dialog with destructive button", async ({ page }) => {
    // Add expense
    await page.getByTestId("add-expense-button").click();
    const form = page.getByTestId("add-expense-form");
    await form.getByLabel("Merchant").fill("Coffee Shop");
    await form.getByLabel("Amount").fill("5.50");
    await form.getByLabel("Category").click();
    await page.getByRole("option", { name: "Housing" }).click();
    await page.getByRole("button", { name: "Save Expense" }).click();
    await expect(page.getByText('"Coffee Shop" saved')).toBeVisible();

    // Expand, select the row, then delete from the bulk bar
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();
    await page.getByTestId("expense-row").first().getByTestId("select-expense").check();

    const bulkBar = page.getByTestId("expense-bulk-bar");
    await expect(bulkBar).toBeVisible();
    await expect(bulkBar).toContainText("1 selected");
    await expect(bulkBar).toContainText("$5.50");
    await bulkBar.getByTestId("bulk-delete-button").click();

    // Confirmation dialog names the figure being removed, not just the count
    const dialog = page.getByTestId("delete-expense-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Delete Expense");
    await expect(dialog).toContainText("This expense of $5.50 will be removed.");
    await expect(dialog.getByTestId("confirm-delete-expense-button")).toBeVisible();
  });

  test("confirming delete removes expense and shows success toast", async ({ page }) => {
    // Add expense
    await page.getByTestId("add-expense-button").click();
    const form = page.getByTestId("add-expense-form");
    await form.getByLabel("Merchant").fill("Coffee Shop");
    await form.getByLabel("Amount").fill("5.50");
    await form.getByLabel("Category").click();
    await page.getByRole("option", { name: "Housing" }).click();
    await page.getByRole("button", { name: "Save Expense" }).click();
    await expect(page.getByText('"Coffee Shop" saved')).toBeVisible();

    // Expand and delete
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();
    await expect(page.getByTestId("expense-merchant")).toContainText("Coffee Shop");

    await page.getByTestId("expense-row").first().getByTestId("select-expense").check();
    await page.getByTestId("bulk-delete-button").click();
    await page.getByTestId("confirm-delete-expense-button").click();

    // Toast
    await expect(page.getByText("Expense deleted")).toBeVisible();

    // Expense should be gone
    await expect(page.getByTestId("no-expenses-message")).toBeVisible();
  });

  test("after deleting an expense, budget spent amount decreases", async ({ page }) => {
    // Add expense to Housing
    await page.getByTestId("add-expense-button").click();
    const form = page.getByTestId("add-expense-form");
    await form.getByLabel("Merchant").fill("Rent");
    await form.getByLabel("Amount").fill("1200");
    await form.getByLabel("Category").click();
    await page.getByRole("option", { name: "Housing" }).click();
    await page.getByRole("button", { name: "Save Expense" }).click();
    await expect(page.getByText('"Rent" saved')).toBeVisible();

    // Verify spent shows $1,200.00
    const spentTargets = page.getByTestId("spent-target");
    await expect(spentTargets.first()).toContainText("$1,200.00");

    // Expand and delete
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();
    await page.getByTestId("expense-row").first().getByTestId("select-expense").check();
    await page.getByTestId("bulk-delete-button").click();
    await page.getByTestId("confirm-delete-expense-button").click();
    await expect(page.getByText("Expense deleted")).toBeVisible();

    // Spent should go back to $0.00
    await expect(spentTargets.first()).toContainText("$0.00");
  });

  test("pressing Cancel in delete dialog does not remove the expense", async ({ page }) => {
    // Add expense
    await page.getByTestId("add-expense-button").click();
    const form = page.getByTestId("add-expense-form");
    await form.getByLabel("Merchant").fill("Coffee Shop");
    await form.getByLabel("Amount").fill("5.50");
    await form.getByLabel("Category").click();
    await page.getByRole("option", { name: "Housing" }).click();
    await page.getByRole("button", { name: "Save Expense" }).click();
    await expect(page.getByText('"Coffee Shop" saved')).toBeVisible();

    // Expand, select the row, then open the delete dialog
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();
    await page.getByTestId("expense-row").first().getByTestId("select-expense").check();
    await page.getByTestId("bulk-delete-button").click();

    // Cancel
    const dialog = page.getByTestId("delete-expense-dialog");
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // Dialog should close, expense still present
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId("expense-merchant")).toContainText("Coffee Shop");
  });

  test("creating expense with linked chequing account decreases account balance on accounts page", async ({
    page,
  }) => {
    await page.getByTestId("add-expense-button").click();
    const form = page.getByTestId("add-expense-form");
    await form.getByLabel("Merchant").fill("Grocery Store");
    await form.getByLabel("Amount").fill("50");
    await form.getByLabel("Category").click();
    await page.getByRole("option", { name: "Housing" }).click();
    await form.getByLabel("Account (optional)").click();
    await page.getByRole("option", { name: /Main Chequing/ }).click();
    await page.getByRole("button", { name: "Save Expense" }).click();
    await expect(page.getByText('"Grocery Store" saved')).toBeVisible();

    // Accounts is no longer a top-level tab: the four destinations are Today, Spending, Wealth and
    // Insights, and Accounts is a Wealth sub-surface that the destination link deep-links straight to.
    await gotoAccounts(page);
    const accountRow = page.getByTestId("account-row").filter({ hasText: "Main Chequing" });
    await expect(accountRow.getByTestId("account-balance")).toContainText("$950.00");
  });

  test("expense without linked account leaves account balance unchanged", async ({ page }) => {
    await gotoAccounts(page);
    const accountRow = page.getByTestId("account-row").filter({ hasText: "Main Chequing" });
    await expect(accountRow.getByTestId("account-balance")).toContainText("$1,000.00");

    await gotoBudget(page);
    await page.getByTestId("add-expense-button").click();
    const form = page.getByTestId("add-expense-form");
    await form.getByLabel("Merchant").fill("Cash Purchase");
    await form.getByLabel("Amount").fill("25");
    await form.getByLabel("Category").click();
    await page.getByRole("option", { name: "Housing" }).click();
    await page.getByRole("button", { name: "Save Expense" }).click();
    await expect(page.getByText('"Cash Purchase" saved')).toBeVisible();

    await gotoAccounts(page);
    await expect(accountRow.getByTestId("account-balance")).toContainText("$1,000.00");
  });
});
