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

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: Record<string, unknown>) => {
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
                };
              })
            );
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

test.describe("Expense Tracking", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/budget");
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
    await expect(page.getByText('Expense "Grocery Store" saved')).toBeVisible();

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
    await expect(page.getByText('Expense "Rent Payment" saved')).toBeVisible();

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
    await expect(page.getByText('Expense "Coffee Shop" saved')).toBeVisible();

    // Expand the Housing category
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();

    // Should show the expense
    await expect(page.getByTestId("expense-list")).toBeVisible();
    await expect(page.getByTestId("expense-merchant")).toContainText("Coffee Shop");
    await expect(page.getByTestId("expense-amount")).toContainText("$5.50");
  });

  test("expense row shows merchant, amount (right-aligned monospace), and date", async ({ page }) => {
    // Add an expense
    await page.getByTestId("add-expense-button").click();
    const form = page.getByTestId("add-expense-form");
    await form.getByLabel("Merchant").fill("Grocery Store");
    await form.getByLabel("Amount").fill("45.99");
    await form.getByLabel("Category").click();
    await page.getByRole("option", { name: "Housing" }).click();
    await page.getByRole("button", { name: "Save Expense" }).click();
    await expect(page.getByText('Expense "Grocery Store" saved')).toBeVisible();

    // Expand
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();

    // Verify amount has monospace font
    const amountEl = page.getByTestId("expense-amount");
    const fontFamily = await amountEl.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(fontFamily.toLowerCase()).toContain("mono");

    // Verify date is displayed
    await expect(page.getByTestId("expense-date")).toBeVisible();
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
    await expect(page.getByText('Expense "Rent" saved')).toBeVisible();

    // Expand Housing category
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();
    await expect(page.getByTestId("expense-merchant")).toContainText("Rent");

    // Navigate to next month — expanded state persists, expenses should update
    await page.getByTestId("next-month-button").click();

    // The category is still expanded — should now show empty state for next month
    await expect(page.getByText("No expenses this month")).toBeVisible();
  });

  test("hovering over an expense row reveals edit and delete action icons", async ({ page }) => {
    // Add an expense
    await page.getByTestId("add-expense-button").click();
    const form = page.getByTestId("add-expense-form");
    await form.getByLabel("Merchant").fill("Coffee Shop");
    await form.getByLabel("Amount").fill("5.50");
    await form.getByLabel("Category").click();
    await page.getByRole("option", { name: "Housing" }).click();
    await page.getByRole("button", { name: "Save Expense" }).click();
    await expect(page.getByText('Expense "Coffee Shop" saved')).toBeVisible();

    // Expand category
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();

    // Hover over expense row
    const expenseRow = page.getByTestId("expense-row").first();
    await expenseRow.hover();

    // Edit and delete buttons should be visible
    await expect(page.getByTestId("edit-expense-button")).toBeVisible();
    await expect(page.getByTestId("delete-expense-button")).toBeVisible();
  });

  test("clicking edit opens form pre-populated with expense values", async ({ page }) => {
    // Add expense
    await page.getByTestId("add-expense-button").click();
    const form = page.getByTestId("add-expense-form");
    await form.getByLabel("Merchant").fill("Coffee Shop");
    await form.getByLabel("Amount").fill("5.50");
    await form.getByLabel("Category").click();
    await page.getByRole("option", { name: "Housing" }).click();
    await page.getByRole("button", { name: "Save Expense" }).click();
    await expect(page.getByText('Expense "Coffee Shop" saved')).toBeVisible();

    // Expand and click edit
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();
    const expenseRow = page.getByTestId("expense-row").first();
    await expenseRow.hover();
    await page.getByTestId("edit-expense-button").click();

    // Edit form should appear with pre-populated values
    const editForm = page.getByTestId("edit-expense-form");
    await expect(editForm).toBeVisible();
    await expect(editForm.getByLabel("Merchant")).toHaveValue("Coffee Shop");
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
    await expect(page.getByText('Expense "Coffee Shop" saved')).toBeVisible();

    // Expand and edit
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();
    const expenseRow = page.getByTestId("expense-row").first();
    await expenseRow.hover();
    await page.getByTestId("edit-expense-button").click();

    // Change merchant name
    const editForm = page.getByTestId("edit-expense-form");
    await editForm.getByLabel("Merchant").fill("Fancy Coffee");
    await editForm.getByRole("button", { name: "Save" }).click();

    // Success toast
    await expect(page.getByText("Expense updated")).toBeVisible();

    // Updated merchant should show
    await expect(page.getByTestId("expense-merchant")).toContainText("Fancy Coffee");
  });

  test("clicking delete shows confirmation dialog with destructive button", async ({ page }) => {
    // Add expense
    await page.getByTestId("add-expense-button").click();
    const form = page.getByTestId("add-expense-form");
    await form.getByLabel("Merchant").fill("Coffee Shop");
    await form.getByLabel("Amount").fill("5.50");
    await form.getByLabel("Category").click();
    await page.getByRole("option", { name: "Housing" }).click();
    await page.getByRole("button", { name: "Save Expense" }).click();
    await expect(page.getByText('Expense "Coffee Shop" saved')).toBeVisible();

    // Expand and click delete
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();
    const expenseRow = page.getByTestId("expense-row").first();
    await expenseRow.hover();
    await page.getByTestId("delete-expense-button").click();

    // Confirmation dialog
    await expect(page.getByTestId("delete-expense-dialog")).toBeVisible();
    await expect(page.getByText("Delete Expense")).toBeVisible();
    await expect(page.getByTestId("confirm-delete-expense-button")).toBeVisible();
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
    await expect(page.getByText('Expense "Coffee Shop" saved')).toBeVisible();

    // Expand and delete
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();
    await expect(page.getByTestId("expense-merchant")).toContainText("Coffee Shop");

    const expenseRow = page.getByTestId("expense-row").first();
    await expenseRow.hover();
    await page.getByTestId("delete-expense-button").click();
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
    await expect(page.getByText('Expense "Rent" saved')).toBeVisible();

    // Verify spent shows $1,200.00
    const spentTargets = page.getByTestId("spent-target");
    await expect(spentTargets.first()).toContainText("$1,200.00");

    // Expand and delete
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();
    const expenseRow = page.getByTestId("expense-row").first();
    await expenseRow.hover();
    await page.getByTestId("delete-expense-button").click();
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
    await expect(page.getByText('Expense "Coffee Shop" saved')).toBeVisible();

    // Expand and click delete
    const statusRows = page.getByTestId("budget-status-row");
    await statusRows.first().getByTestId("category-expand-toggle").click();
    const expenseRow = page.getByTestId("expense-row").first();
    await expenseRow.hover();
    await page.getByTestId("delete-expense-button").click();

    // Cancel
    await page.getByRole("button", { name: "Cancel" }).click();

    // Dialog should close, expense still present
    await expect(page.getByTestId("delete-expense-dialog")).not.toBeVisible();
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
    await expect(page.getByText('Expense "Grocery Store" saved')).toBeVisible();

    await page
      .getByRole("navigation", { name: "Finance navigation" })
      .getByRole("link", { name: "Accounts" })
      .click();
    const accountRow = page.getByTestId("account-row").filter({ hasText: "Main Chequing" });
    await expect(accountRow.getByTestId("account-balance")).toContainText("$950.00");
  });

  test("expense without linked account leaves account balance unchanged", async ({ page }) => {
    await page
      .getByRole("navigation", { name: "Finance navigation" })
      .getByRole("link", { name: "Accounts" })
      .click();
    const accountRow = page.getByTestId("account-row").filter({ hasText: "Main Chequing" });
    await expect(accountRow.getByTestId("account-balance")).toContainText("$1,000.00");

    await page
      .getByRole("navigation", { name: "Finance navigation" })
      .getByRole("link", { name: "Budget" })
      .click();
    await page.getByTestId("add-expense-button").click();
    const form = page.getByTestId("add-expense-form");
    await form.getByLabel("Merchant").fill("Cash Purchase");
    await form.getByLabel("Amount").fill("25");
    await form.getByLabel("Category").click();
    await page.getByRole("option", { name: "Housing" }).click();
    await page.getByRole("button", { name: "Save Expense" }).click();
    await expect(page.getByText('Expense "Cash Purchase" saved')).toBeVisible();

    await page
      .getByRole("navigation", { name: "Finance navigation" })
      .getByRole("link", { name: "Accounts" })
      .click();
    await expect(accountRow.getByTestId("account-balance")).toContainText("$1,000.00");
  });
});
