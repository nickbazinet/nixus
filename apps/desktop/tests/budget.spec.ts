import { test, expect, type Page } from "@playwright/test";

/**
 * Sets up Tauri IPC mocks so invoke() calls work in a browser context.
 * Maintains in-memory state for budget groups and categories.
 */
async function setupTauriMock(page: Page) {
  await page.addInitScript(() => {
    const groups: MockGroup[] = [];
    const categories: MockCategory[] = [];
    let nextGroupId = 1;
    let nextCategoryId = 1;

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

    // Mock the Tauri IPC internals
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: Record<string, unknown>) => {
        switch (cmd) {
          case "get_budget_groups":
            return Promise.resolve(groups);

          case "create_budget_group": {
            const name = args.name as string;
            if (!name || !name.trim()) {
              return Promise.reject({
                type: "validation",
                message: "Group name is required",
                field: "name",
              });
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
            return Promise.resolve(
              categories.filter((c) => c.group_id === groupId)
            );
          }

          case "create_budget_category": {
            const catName = args.name as string;
            const targetCents = args.target_cents as number;
            const catGroupId = args.group_id as number;
            if (!catName || !catName.trim()) {
              return Promise.reject({
                type: "validation",
                message: "Category name is required",
                field: "name",
              });
            }
            if (!targetCents || targetCents <= 0) {
              return Promise.reject({
                type: "validation",
                message: "Target must be greater than 0",
                field: "target_cents",
              });
            }
            const category: MockCategory = {
              id: nextCategoryId++,
              group_id: catGroupId,
              name: catName.trim(),
              target_cents: targetCents,
              sort_order: categories.filter((c) => c.group_id === catGroupId)
                .length,
              created_at: new Date().toISOString(),
            };
            categories.push(category);
            return Promise.resolve(category);
          }

          case "update_budget_group": {
            const updateGroupId = args.id as number;
            const newGroupName = (args.name as string)?.trim();
            if (!newGroupName) {
              return Promise.reject({
                type: "validation",
                message: "Group name is required",
                field: "name",
              });
            }
            const groupToUpdate = groups.find((g) => g.id === updateGroupId);
            if (!groupToUpdate) {
              return Promise.reject({
                type: "database",
                message: "Budget group not found",
              });
            }
            groupToUpdate.name = newGroupName;
            return Promise.resolve({ ...groupToUpdate });
          }

          case "update_budget_category": {
            const updateCatId = args.id as number;
            const newCatName = args.name as string | null;
            const newTargetCents = args.target_cents as number | null;
            const catToUpdate = categories.find((c) => c.id === updateCatId);
            if (!catToUpdate) {
              return Promise.reject({
                type: "database",
                message: "Budget category not found",
              });
            }
            if (newCatName !== null && newCatName !== undefined) {
              const trimmed = newCatName.trim();
              if (!trimmed) {
                return Promise.reject({
                  type: "validation",
                  message: "Category name is required",
                  field: "name",
                });
              }
              catToUpdate.name = trimmed;
            }
            if (newTargetCents !== null && newTargetCents !== undefined) {
              if (newTargetCents <= 0) {
                return Promise.reject({
                  type: "validation",
                  message: "Target must be greater than 0",
                  field: "target_cents",
                });
              }
              catToUpdate.target_cents = newTargetCents;
            }
            return Promise.resolve({ ...catToUpdate });
          }

          case "delete_budget_category": {
            const delCatId = args.id as number;
            const idx = categories.findIndex((c) => c.id === delCatId);
            if (idx === -1) {
              return Promise.reject({
                type: "database",
                message: "Budget category not found",
              });
            }
            categories.splice(idx, 1);
            return Promise.resolve(null);
          }

          case "delete_budget_group": {
            const delGroupId = args.id as number;
            const hasCats = categories.some(
              (c) => c.group_id === delGroupId
            );
            if (hasCats) {
              return Promise.reject({
                type: "validation",
                message: "Remove all categories first",
              });
            }
            const gIdx = groups.findIndex((g) => g.id === delGroupId);
            if (gIdx === -1) {
              return Promise.reject({
                type: "database",
                message: "Budget group not found",
              });
            }
            groups.splice(gIdx, 1);
            return Promise.resolve(null);
          }

          case "get_budget_status": {
            return Promise.resolve(
              categories.map((c) => ({
                id: c.id,
                group_id: c.group_id,
                name: c.name,
                target_cents: c.target_cents,
                spent_cents: 0,
              }))
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
            return Promise.reject(
              `Unknown command: ${cmd}`
            );
        }
      },
      convertFileSrc: (path: string) => path,
    };
  });
}

test.describe("Budget Page", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/budget");
  });

  test("user can create a budget group and see it appear on the page", async ({
    page,
  }) => {
    // Click Add Group button
    await page.getByTestId("add-group-button").click();

    // Fill in the group name
    await page.getByLabel("Group Name").fill("Essentials");

    // Submit
    await page.getByRole("button", { name: "Save Group" }).click();

    // Verify the group card appears with the name
    await expect(page.getByRole("heading", { name: "Essentials" })).toBeVisible();

    // Verify success toast
    await expect(page.getByText('Group "Essentials" created')).toBeVisible();
  });

  test("user can add a category with a dollar target to a group", async ({
    page,
  }) => {
    // First create a group
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill("Essentials");
    await page.getByRole("button", { name: "Save Group" }).click();
    await expect(
      page.getByRole("heading", { name: "Essentials" })
    ).toBeVisible();

    // Click Add Category
    await page.getByTestId("add-category-button").click();

    // Fill in the category form
    await page.getByLabel("Category Name").fill("Housing");
    await page.getByLabel("Monthly Target").fill("700");

    // Submit
    await page.getByRole("button", { name: "Save Category" }).click();

    // Verify the category appears in the category row
    await expect(
      page.getByTestId("budget-category-row").getByText("Housing")
    ).toBeVisible();

    // Verify success toast
    await expect(page.getByText('Category "Housing" added')).toBeVisible();
  });

  test("category displays with formatted target amount in monospace", async ({
    page,
  }) => {
    // Create a group
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill("Essentials");
    await page.getByRole("button", { name: "Save Group" }).click();
    await expect(
      page.getByRole("heading", { name: "Essentials" })
    ).toBeVisible();

    // Add a category with $1,234.56
    await page.getByTestId("add-category-button").click();
    await page.getByLabel("Category Name").fill("Housing");
    await page.getByLabel("Monthly Target").fill("1234.56");
    await page.getByRole("button", { name: "Save Category" }).click();

    // Verify the formatted amount appears in the inline edit target
    const amountEl = page.getByTestId("category-target");
    await expect(amountEl).toContainText("$1,234.56");

    // Verify monospace font
    const fontFamily = await amountEl.evaluate(
      (el) => getComputedStyle(el).fontFamily
    );
    expect(fontFamily.toLowerCase()).toContain("jetbrains mono");
  });

  test("form validation prevents saving without a group name", async ({
    page,
  }) => {
    // Open the form
    await page.getByTestId("add-group-button").click();

    // Submit empty
    await page.getByRole("button", { name: "Save Group" }).click();

    // Validation message should appear
    await expect(page.getByText("Group name is required")).toBeVisible();
  });

  test("form validation prevents saving category without name or with target <= 0", async ({
    page,
  }) => {
    // Create a group first
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill("Essentials");
    await page.getByRole("button", { name: "Save Group" }).click();
    await expect(
      page.getByRole("heading", { name: "Essentials" })
    ).toBeVisible();

    // Open category form
    await page.getByTestId("add-category-button").click();

    // Submit without filling name
    await page.getByRole("button", { name: "Save Category" }).click();
    await expect(page.getByText("Name is required")).toBeVisible();

    // Fill name but leave target at 0, then submit
    await page.getByLabel("Category Name").fill("Food");
    await page.getByRole("button", { name: "Save Category" }).click();
    await expect(
      page.getByText("Target must be greater than $0")
    ).toBeVisible();
  });

  test("success toast appears after saving a group", async ({ page }) => {
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill("Fun Money");
    await page.getByRole("button", { name: "Save Group" }).click();

    // Toast should appear and auto-dismiss
    const toastMessage = page.getByText('Group "Fun Money" created');
    await expect(toastMessage).toBeVisible();
  });

  test("clicking a target amount makes it editable inline", async ({
    page,
  }) => {
    // Create a group and category
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill("Essentials");
    await page.getByRole("button", { name: "Save Group" }).click();
    await expect(
      page.getByRole("heading", { name: "Essentials" })
    ).toBeVisible();

    await page.getByTestId("add-category-button").click();
    await page.getByLabel("Category Name").fill("Housing");
    await page.getByLabel("Monthly Target").fill("700");
    await page.getByRole("button", { name: "Save Category" }).click();
    await expect(
      page.getByTestId("budget-category-row").getByText("Housing")
    ).toBeVisible();

    // Click the target amount to enter edit mode
    const target = page.getByTestId("category-target");
    await expect(target).toContainText("$700.00");
    await target.click();

    // Should now show an input (MoneyInput)
    const inputWrapper = page.getByTestId("category-target-input");
    await expect(inputWrapper).toBeVisible();
  });

  test("pressing Enter on edited target saves and shows success toast", async ({
    page,
  }) => {
    // Create a group and category
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill("Essentials");
    await page.getByRole("button", { name: "Save Group" }).click();
    await expect(
      page.getByRole("heading", { name: "Essentials" })
    ).toBeVisible();

    await page.getByTestId("add-category-button").click();
    await page.getByLabel("Category Name").fill("Housing");
    await page.getByLabel("Monthly Target").fill("700");
    await page.getByRole("button", { name: "Save Category" }).click();
    await expect(
      page.getByTestId("budget-category-row").getByText("Housing")
    ).toBeVisible();

    // Click the target to edit it
    await page.getByTestId("category-target").click();

    // Clear and type a new value, then press Enter
    const moneyInput = page.getByTestId("category-target-input").locator("input");
    await moneyInput.fill("800");
    await moneyInput.press("Enter");

    // Verify success toast
    await expect(page.getByText("Budget target updated to $800.00")).toBeVisible();
  });

  test("pressing Escape on edited target reverts without saving", async ({
    page,
  }) => {
    // Create a group and category
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill("Essentials");
    await page.getByRole("button", { name: "Save Group" }).click();
    await expect(
      page.getByRole("heading", { name: "Essentials" })
    ).toBeVisible();

    await page.getByTestId("add-category-button").click();
    await page.getByLabel("Category Name").fill("Housing");
    await page.getByLabel("Monthly Target").fill("700");
    await page.getByRole("button", { name: "Save Category" }).click();
    await expect(
      page.getByTestId("budget-category-row").getByText("Housing")
    ).toBeVisible();

    // Click the target to edit it
    await page.getByTestId("category-target").click();

    // Type a new value, then press Escape
    const moneyInput = page.getByTestId("category-target-input").locator("input");
    await moneyInput.fill("999");
    await moneyInput.press("Escape");

    // Should revert to original value display
    await expect(page.getByTestId("category-target")).toContainText("$700.00");

    // No success toast should appear
    await expect(page.getByText("Budget target updated")).not.toBeVisible();
  });

  test("deleting a category shows confirmation dialog; confirming removes it", async ({
    page,
  }) => {
    // Create a group and category
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill("Essentials");
    await page.getByRole("button", { name: "Save Group" }).click();
    await expect(
      page.getByRole("heading", { name: "Essentials" })
    ).toBeVisible();

    await page.getByTestId("add-category-button").click();
    await page.getByLabel("Category Name").fill("Housing");
    await page.getByLabel("Monthly Target").fill("700");
    await page.getByRole("button", { name: "Save Category" }).click();
    await expect(
      page.getByTestId("budget-category-row").getByText("Housing")
    ).toBeVisible();

    // Hover to reveal delete button, then click it
    await page.getByTestId("budget-category-row").hover();
    await page.getByTestId("delete-category-button").click();

    // Confirmation dialog should appear
    await expect(page.getByTestId("delete-category-dialog")).toBeVisible();
    await expect(
      page.getByText("Are you sure you want to delete Housing?")
    ).toBeVisible();

    // Confirm deletion
    await page.getByTestId("confirm-delete-button").click();

    // Success toast
    await expect(page.getByText("Category deleted")).toBeVisible({ timeout: 10000 });

    // Category row should be gone
    await expect(page.getByTestId("budget-category-row")).not.toBeVisible();
  });

  test("budget page header shows current month and year", async ({ page }) => {
    const now = new Date();
    const monthYear = now.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
    await expect(page.getByText(monthYear)).toBeVisible();
  });

  test("category displays with progress bar after creation", async ({
    page,
  }) => {
    // Create a group and category
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill("Essentials");
    await page.getByRole("button", { name: "Save Group" }).click();
    await expect(
      page.getByRole("heading", { name: "Essentials" })
    ).toBeVisible();

    await page.getByTestId("add-category-button").click();
    await page.getByLabel("Category Name").fill("Housing");
    await page.getByLabel("Monthly Target").fill("700");
    await page.getByRole("button", { name: "Save Category" }).click();
    await expect(
      page.getByTestId("budget-category-row").getByText("Housing")
    ).toBeVisible();

    // Wait for status row to appear with progress bar
    const progressBar = page.getByTestId("progress-bar");
    await expect(progressBar).toBeVisible();
    await expect(progressBar).toHaveAttribute("role", "progressbar");
  });

  test("with no expenses, progress bar shows 0% and teal color", async ({
    page,
  }) => {
    // Create a group and category
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill("Essentials");
    await page.getByRole("button", { name: "Save Group" }).click();
    await expect(
      page.getByRole("heading", { name: "Essentials" })
    ).toBeVisible();

    await page.getByTestId("add-category-button").click();
    await page.getByLabel("Category Name").fill("Housing");
    await page.getByLabel("Monthly Target").fill("700");
    await page.getByRole("button", { name: "Save Category" }).click();

    // Wait for progress bar container to appear
    const progressBar = page.getByTestId("progress-bar");
    await expect(progressBar).toBeVisible();

    // Check the fill element has 0% width and teal color
    const progressBarFill = page.getByTestId("progress-bar-fill");
    await expect(progressBarFill).toBeAttached();

    const width = await progressBarFill.evaluate(
      (el) => el.style.width
    );
    expect(width).toBe("0%");

    const classList = await progressBarFill.evaluate((el) =>
      Array.from(el.classList)
    );
    expect(classList).toContain("bg-teal-600");
  });

  test("spent / target text shows $0.00 with no expenses", async ({
    page,
  }) => {
    // Create a group and category
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill("Essentials");
    await page.getByRole("button", { name: "Save Group" }).click();
    await expect(
      page.getByRole("heading", { name: "Essentials" })
    ).toBeVisible();

    await page.getByTestId("add-category-button").click();
    await page.getByLabel("Category Name").fill("Housing");
    await page.getByLabel("Monthly Target").fill("700");
    await page.getByRole("button", { name: "Save Category" }).click();

    // Wait for the status display
    const spentTarget = page.getByTestId("spent-target");
    await expect(spentTarget).toBeVisible();
    await expect(spentTarget).toContainText("$0.00 / $700.00");

    // Verify monospace font
    const fontFamily = await spentTarget.evaluate(
      (el) => getComputedStyle(el).fontFamily
    );
    expect(fontFamily.toLowerCase()).toContain("mono");
  });

  test("status badge shows 'on track' with no expenses", async ({ page }) => {
    // Create a group and category
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill("Essentials");
    await page.getByRole("button", { name: "Save Group" }).click();
    await expect(
      page.getByRole("heading", { name: "Essentials" })
    ).toBeVisible();

    await page.getByTestId("add-category-button").click();
    await page.getByLabel("Category Name").fill("Housing");
    await page.getByLabel("Monthly Target").fill("700");
    await page.getByRole("button", { name: "Save Category" }).click();

    // Wait for the status badge
    const badge = page.getByTestId("status-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("on track");
  });

  test("month navigation arrows are visible", async ({ page }) => {
    await expect(page.getByTestId("month-navigator")).toBeVisible();
    await expect(page.getByTestId("prev-month-button")).toBeVisible();
    await expect(page.getByTestId("next-month-button")).toBeVisible();
    await expect(page.getByTestId("current-month-label")).toBeVisible();
  });

  test("clicking right arrow advances to next month", async ({ page }) => {
    const now = new Date();
    const nextDate = new Date(now.getFullYear(), now.getMonth() + 1);
    const expectedLabel = nextDate.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });

    await page.getByTestId("next-month-button").click();
    await expect(page.getByTestId("current-month-label")).toHaveText(expectedLabel);
  });

  test("clicking left arrow goes to previous month", async ({ page }) => {
    const now = new Date();
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1);
    const expectedLabel = prevDate.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });

    await page.getByTestId("prev-month-button").click();
    await expect(page.getByTestId("current-month-label")).toHaveText(expectedLabel);
  });

  test("budget categories remain visible after navigating months", async ({
    page,
  }) => {
    // Create a group and category
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill("Essentials");
    await page.getByRole("button", { name: "Save Group" }).click();
    await expect(
      page.getByRole("heading", { name: "Essentials" })
    ).toBeVisible();

    await page.getByTestId("add-category-button").click();
    await page.getByLabel("Category Name").fill("Housing");
    await page.getByLabel("Monthly Target").fill("700");
    await page.getByRole("button", { name: "Save Category" }).click();
    await expect(
      page.getByTestId("budget-category-row").getByText("Housing")
    ).toBeVisible();

    // Navigate to next month
    await page.getByTestId("next-month-button").click();

    // Categories should still be visible
    await expect(
      page.getByTestId("budget-category-row").getByText("Housing")
    ).toBeVisible();
  });

  test("year rollover works when navigating backward from January", async ({
    page,
  }) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-based

    // Navigate backward to January
    for (let i = 0; i < currentMonth; i++) {
      await page.getByTestId("prev-month-button").click();
    }

    // Should now be December of previous year
    await expect(page.getByTestId("current-month-label")).toHaveText(
      `December ${currentYear - 1}`
    );
  });

  test("deleting a group with categories shows 'Remove all categories first' error", async ({
    page,
  }) => {
    // Create a group and category
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill("Essentials");
    await page.getByRole("button", { name: "Save Group" }).click();
    await expect(
      page.getByRole("heading", { name: "Essentials" })
    ).toBeVisible();

    await page.getByTestId("add-category-button").click();
    await page.getByLabel("Category Name").fill("Housing");
    await page.getByLabel("Monthly Target").fill("700");
    await page.getByRole("button", { name: "Save Category" }).click();
    await expect(
      page.getByTestId("budget-category-row").getByText("Housing")
    ).toBeVisible();

    // Try to delete the group
    await page.getByTestId("delete-group-button").click();

    // Should show inline error, NOT a dialog
    await expect(page.getByTestId("group-error")).toBeVisible();
    await expect(page.getByTestId("group-error")).toContainText(
      "Remove all categories first"
    );
  });
});
