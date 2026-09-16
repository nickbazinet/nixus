import { test, expect, type Page } from "@playwright/test";

/**
 * How the stubbed `apply_recurring_expenses` settles. `deferred` holds the call open until the test
 * calls `window.__releaseRecurring()`, which is what lets the pending state be asserted without a
 * wall-clock race.
 */
interface RecurringFixture {
  outcome: "created" | "none" | "failure";
  deferred: boolean;
}

const RECURRING_DEFAULT: RecurringFixture = { outcome: "created", deferred: false };

declare global {
  interface Window {
    __releaseRecurring?: () => void;
  }
}

/**
 * What `get_budget_summary` reports back. `seedTargetCents` pre-creates one category so a test
 * can reach a known total target without driving the group and category forms first.
 */
interface SummaryFixture {
  seedTargetCents: number;
  averageMonthlyIncomeCents: number;
  incomeMonthCount: number;
  recurring?: RecurringFixture;
}

const NO_INCOME_HISTORY: SummaryFixture = {
  seedTargetCents: 0,
  averageMonthlyIncomeCents: 0,
  incomeMonthCount: 0,
};

/**
 * Sets up Tauri IPC mocks so invoke() calls work in a browser context.
 * Maintains in-memory state for budget groups and categories.
 */
async function setupTauriMock(
  page: Page,
  fixture: SummaryFixture = NO_INCOME_HISTORY
) {
  await page.addInitScript((summary) => {
    const recurring = summary.recurring;
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

    if (summary.seedTargetCents > 0) {
      const groupId = nextGroupId++;
      groups.push({
        id: groupId,
        name: "Essentials",
        sort_order: 0,
        created_at: new Date().toISOString(),
      });
      categories.push({
        id: nextCategoryId++,
        group_id: groupId,
        name: "Housing",
        target_cents: summary.seedTargetCents,
        sort_order: 0,
        created_at: new Date().toISOString(),
      });
    }

    // Unlisten cleanup calls into this namespace; without it teardown throws.
    (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ =
      { unregisterListener: () => {} };

    // Mock the Tauri IPC internals
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: (cmd: string, args: Record<string, unknown>) => {
        // Plugin commands (updater, etc.) must resolve null: a truthy updater
        // response opens a modal Dialog that aria-hides the whole app.
        if (cmd.startsWith("plugin:")) {
          return Promise.resolve(null);
        }
        switch (cmd) {
          case "check_picker_gate":
            return Promise.resolve({ needs_picker: false });

          case "get_budget_groups":
            return Promise.resolve(groups);

          case "get_budget_groups_for_month":
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
              categories
                .filter((c) => c.group_id === groupId)
                .sort((a, b) => a.sort_order - b.sort_order)
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

          case "reorder_budget_categories": {
            const reorderGroupId = args.group_id as number;
            const submitted = args.category_ids as number[];
            const active = categories.filter(
              (c) => c.group_id === reorderGroupId
            );
            const isPermutation =
              submitted.length === active.length &&
              new Set(submitted).size === submitted.length &&
              submitted.every((id) => active.some((c) => c.id === id));
            if (!isPermutation) {
              return Promise.reject({
                type: "validation",
                message:
                  "The submitted order must contain every category in the group exactly once",
                field: "category_ids",
              });
            }
            submitted.forEach((id, index) => {
              const category = categories.find((c) => c.id === id);
              if (category) category.sort_order = index;
            });
            return Promise.resolve(
              categories
                .filter((c) => c.group_id === reorderGroupId)
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((c) => ({ ...c }))
            );
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
                is_deleted: false,
              }))
            );
          }

          case "get_budget_summary": {
            const totalTarget = categories.reduce(
              (sum, c) => sum + c.target_cents,
              0
            );
            return Promise.resolve({
              total_target_cents: totalTarget,
              total_spent_cents: 0,
              remaining_cents: totalTarget,
              month: `${args.year}-${String(args.month).padStart(2, "0")}`,
              average_monthly_income_cents: summary.averageMonthlyIncomeCents,
              income_month_count: summary.incomeMonthCount,
            });
          }

          case "get_all_budget_categories":
            return Promise.resolve([...categories]);

          // Fixture-driven so the pending window is opened and closed by the test, never by a
          // timer: `deferred` parks the promise until `window.__releaseRecurring()` settles it.
          case "apply_recurring_expenses": {
            const settle = () => {
              if (recurring.outcome === "failure") {
                return Promise.reject({
                  type: "database",
                  message: "disk is full",
                });
              }
              if (recurring.outcome === "none") {
                return Promise.resolve([]);
              }
              return Promise.resolve([
                {
                  id: 9001,
                  merchant: "Rent",
                  amount_cents: 120000,
                  budget_category_id: categories[0]?.id ?? 1,
                  account_id: null,
                  date: `${args.year}-${String(args.month).padStart(2, "0")}-01`,
                  source: "recurring",
                  created_at: new Date().toISOString(),
                },
              ]);
            };
            if (!recurring.deferred) {
              return settle();
            }
            return new Promise((resolve, reject) => {
              window.__releaseRecurring = () => {
                settle().then(resolve, reject);
              };
            });
          }

          case "get_expenses":
            return Promise.resolve([]);

          case "get_accounts":
            return Promise.resolve([]);

          case "get_db_status":
            return Promise.resolve({
              db_path: "mock.db",
              wal_mode: true,
              schema_version: 3,
              migrations_applied: 3,
            });

          // The account trigger is mounted on every screen, so this read must be answered even where
          // the surface under test has nothing to do with an account (see project-context.md, Testing).
          case "get_user_avatar":
            return Promise.resolve(null);
          default:
            return Promise.reject(
              `Unknown command: ${cmd}`
            );
        }
      },
      convertFileSrc: (path: string) => path,
    };
  }, { ...fixture, recurring: fixture.recurring ?? RECURRING_DEFAULT });
}

test.describe("Budget Page", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/spending/budget");
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
    await expect(page.getByText('"Essentials" created')).toBeVisible();
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
    await expect(page.getByText('"Housing" added')).toBeVisible();
  });

  test("category target renders as tabular figures, never a code font", async ({
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

    // Tabular figures buy the column alignment monospace was used for, without putting a code font
    // on a financial figure.
    const figure = amountEl.locator('[data-slot="money"]');
    const { fontFamily, fontVariantNumeric } = await figure.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        fontFamily: style.fontFamily,
        fontVariantNumeric: style.fontVariantNumeric,
      };
    });
    expect(fontVariantNumeric).toContain("tabular-nums");
    expect(fontFamily.toLowerCase()).not.toContain("mono");
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
    const toastMessage = page.getByText('"Fun Money" created');
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
    await expect(page.getByText("Target is now $800.00")).toBeVisible();
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
    await expect(page.getByText("Target is now")).not.toBeVisible();
  });

  test("deleting a category shows an archive confirmation dialog; confirming archives it", async ({
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

    // Hover-only affordances are banned: the delete control has a visible resting state, so it is
    // reachable without a pointer ever entering the row.
    const deleteButton = page.getByTestId("delete-category-button");
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();

    // Confirmation dialog states what happens to the expenses already filed under the category,
    // because the backend soft-deletes and leaves them attached.
    const dialog = page.getByTestId("delete-category-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('"Housing" will be archived.');
    await expect(dialog).toContainText(
      "The expenses already filed under it stay on record"
    );

    // Confirm — the label names the action rather than saying "Delete"
    const confirm = dialog.getByTestId("confirm-delete-button");
    await expect(confirm).toHaveText("Archive category");
    await confirm.click();

    // Success toast
    await expect(page.getByText("Category archived")).toBeVisible();

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

  test("with no expenses, the meter reads zero and status lives beside it", async ({
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

    // A Meter must expose a label and a spoken value, not a bare percentage.
    const meter = page.getByTestId("progress-bar");
    await expect(meter).toBeVisible();
    await expect(meter).toHaveRole("progressbar");
    await expect(meter).toHaveAttribute("aria-label", "Share of Housing spent");
    await expect(meter).toHaveAttribute("aria-valuenow", "0");
    await expect(meter).toHaveAttribute("aria-valuemin", "0");
    await expect(meter).toHaveAttribute("aria-valuemax", "70000");
    await expect(meter).toHaveAttribute(
      "aria-valuetext",
      "$0.00 spent of $700.00"
    );

    const fill = meter.locator('[data-slot="meter-fill"]');
    await expect(fill).toBeAttached();
    expect(await fill.evaluate((el) => (el as HTMLElement).style.width)).toBe("0%");

    // The meter fill is brand at every ratio: hue on the bar would be a second, weaker status
    // channel. Status is the badge and the dot next to it, which carry shape as well as hue.
    const [fillColor, brandColor] = await fill.evaluate((el) => {
      const probe = document.createElement("div");
      probe.className = "bg-brand";
      el.ownerDocument.body.append(probe);
      const brand = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return [getComputedStyle(el).backgroundColor, brand];
    });
    expect(fillColor).toBe(brandColor);

    await expect(page.getByTestId("status-badge")).toHaveAttribute(
      "data-variant",
      "good"
    );
    await expect(
      page.locator('[data-slot="status-dot"]')
    ).toHaveAttribute("data-status", "under");
  });

  test("spent / target reads as a slash on screen and \"of\" to a screen reader", async ({
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

    // The separator is split across two channels: a sighted reader gets the "/" glyph, a screen
    // reader gets the word, and neither gets both. Asserting raw textContent would see the pair.
    const { seen, spoken } = await spentTarget.evaluate((el) => {
      const strip = (selector: string) => {
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelectorAll(selector).forEach((node) => node.remove());
        return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
      };
      return { seen: strip(".sr-only"), spoken: strip('[aria-hidden="true"]') };
    });
    expect(seen).toBe("$0.00 / $700.00");
    expect(spoken).toBe("$0.00 of $700.00");

    // Money is tabular Inter — monospace on a financial figure was the retired convention.
    const figures = spentTarget.locator('[data-slot="money"]');
    await expect(figures).toHaveCount(2);
    for (const figure of await figures.all()) {
      const { fontFamily, fontVariantNumeric } = await figure.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          fontFamily: style.fontFamily,
          fontVariantNumeric: style.fontVariantNumeric,
        };
      });
      expect(fontVariantNumeric).toContain("tabular-nums");
      expect(fontFamily.toLowerCase()).not.toContain("mono");
    }
  });

  test("status badge names the amount still unspent, never a bare adjective", async ({
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

    // A badge reading "on track" or "Warning" told the user nothing they could act on, and the
    // ≥75% "Warning" rule badged a mortgage at exactly its target as a problem. Under target now
    // states the figure left; the tone carries the judgement.
    const badge = page.getByTestId("status-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("$700.00 left");
    await expect(badge).toHaveAttribute("data-variant", "good");
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

  async function createGroup(page: Page, name: string) {
    await page.getByTestId("add-group-button").click();
    await page.getByLabel("Group Name").fill(name);
    await page.getByRole("button", { name: "Save Group" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }

  async function createCategory(page: Page, name: string, target: string) {
    await page.getByTestId("add-category-button").click();
    await page.getByLabel("Category Name").fill(name);
    await page.getByLabel("Monthly Target").fill(target);
    await page.getByRole("button", { name: "Save Category" }).click();
    await expect(
      page.getByTestId("budget-category-row").getByText(name)
    ).toBeVisible();
  }

  // Reordering is pointer-events based (not native HTML5 drag-and-drop, which Tauri's macOS
  // webview never fires a `drop` for), so tests drive it with real mouse coordinates rather
  // than Playwright's dragTo() helper.
  async function dragCategoryTo(page: Page, fromIndex: number, toIndex: number) {
    const source = page.getByTestId("category-drag-handle").nth(fromIndex);
    const sourceBox = await source.boundingBox();
    const targetRow = page.getByTestId("budget-status-row").nth(toIndex);
    const targetBox = await targetRow.boundingBox();
    if (!sourceBox || !targetBox) {
      throw new Error("missing bounding box for drag");
    }

    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 4, {
      steps: 5,
    });
    await page.mouse.up();
  }

  test("dragging the first category's handle onto a lower row reorders the list", async ({
    page,
  }) => {
    await createGroup(page, "Essentials");
    await createCategory(page, "Housing", "700");
    await createCategory(page, "Groceries", "400");
    await createCategory(page, "Utilities", "150");

    await expect(page.getByTestId("category-name")).toHaveText([
      "Housing",
      "Groceries",
      "Utilities",
    ]);

    await dragCategoryTo(page, 0, 1);

    await expect(page.getByTestId("category-name")).toHaveText([
      "Groceries",
      "Housing",
      "Utilities",
    ]);
  });

  test("no drag handle is offered when a group has only one category", async ({
    page,
  }) => {
    await createGroup(page, "Essentials");
    await createCategory(page, "Housing", "700");

    await expect(page.getByTestId("category-drag-handle")).toHaveCount(0);
  });

  test("a rejected category reorder reverts to the previous order and warns the user", async ({
    page,
  }) => {
    await createGroup(page, "Essentials");
    await createCategory(page, "Housing", "700");
    await createCategory(page, "Groceries", "400");

    await page.evaluate(() => {
      const internals = (window as unknown as Record<string, unknown>)
        .__TAURI_INTERNALS__ as {
        invoke: (
          cmd: string,
          args: Record<string, unknown>
        ) => Promise<unknown>;
      };
      const original = internals.invoke;
      internals.invoke = (cmd, args) =>
        cmd === "reorder_budget_categories"
          ? Promise.reject({ type: "database", message: "disk is full" })
          : original(cmd, args);
    });

    await dragCategoryTo(page, 0, 1);

    await expect(page.getByTestId("category-name")).toHaveText([
      "Housing",
      "Groceries",
    ]);
    await expect(
      page.getByText(
        "Could not save the new order. Your previous order was kept."
      )
    ).toBeVisible();
  });
});

test.describe("Budget above recorded income", () => {
  const TARGET_CENTS = 500000;
  const LOWER_AVERAGE_CENTS = 420000;
  const TARGET_TEXT = "$5,000.00";
  const AVERAGE_TEXT = "$4,200.00";

  async function openBudget(page: Page, fixture: SummaryFixture) {
    await setupTauriMock(page, fixture);
    await page.goto("/spending/budget");
    await expect(page.getByTestId("budget-summary-strip")).toBeVisible();
    if (fixture.seedTargetCents > 0) {
      await expect(page.getByTestId("budget-overall-progress")).toBeVisible();
    }
  }

  async function replaceTarget(page: Page, dollars: string) {
    await page.getByTestId("category-target").click();
    const input = page.getByTestId("category-target-input").locator("input");
    await input.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await input.pressSequentially(dollars);
    await input.press("Enter");
  }

  test("stays silent on five completed income months, one short of the threshold", async ({
    page,
  }) => {
    // Given five completed income months and a target above their average
    await openBudget(page, {
      seedTargetCents: TARGET_CENTS,
      averageMonthlyIncomeCents: LOWER_AVERAGE_CENTS,
      incomeMonthCount: 5,
    });

    // Then no caution is raised — five months is not yet a history worth warning against
    await expect(page.getByTestId("budget-income-warning")).toHaveCount(0);
  });

  test("cautions with both figures once six completed income months are on record", async ({
    page,
  }) => {
    // Given six completed income months averaging below the target
    await openBudget(page, {
      seedTargetCents: TARGET_CENTS,
      averageMonthlyIncomeCents: LOWER_AVERAGE_CENTS,
      incomeMonthCount: 6,
    });

    // Then the caution names the target and the average, and sits below the overall meter
    const warning = page.getByTestId("budget-income-warning");
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("Budget is above your usual income");
    await expect(warning).toContainText(TARGET_TEXT);
    await expect(warning).toContainText(AVERAGE_TEXT);

    // Advisory, not an error: an alert role would interrupt a user who is still editing targets.
    await expect(warning).not.toHaveAttribute("role", "alert");

    const meterThenWarning = await page.evaluate(() => {
      const meter = document.querySelector('[data-testid="budget-overall-progress"]');
      const alert = document.querySelector('[data-testid="budget-income-warning"]');
      if (!meter || !alert) return false;
      return Boolean(
        meter.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    });
    expect(meterThenWarning).toBe(true);

    // Editing stays open — the warning is advice, so nothing on the surface is disabled.
    await expect(page.getByTestId("add-transactions-trigger")).toBeEnabled();
    await expect(page.getByTestId("category-target")).toBeVisible();
  });

  test("stays silent when the target exactly equals the average", async ({
    page,
  }) => {
    // Given six completed income months whose average is the target to the cent
    await openBudget(page, {
      seedTargetCents: TARGET_CENTS,
      averageMonthlyIncomeCents: TARGET_CENTS,
      incomeMonthCount: 6,
    });

    // Then nothing is flagged — meeting your income is not overshooting it
    await expect(page.getByTestId("budget-income-warning")).toHaveCount(0);
  });

  test("stays silent when the target sits below the average", async ({ page }) => {
    // Given six completed income months averaging above the target
    await openBudget(page, {
      seedTargetCents: TARGET_CENTS,
      averageMonthlyIncomeCents: TARGET_CENTS + 100,
      incomeMonthCount: 6,
    });

    // Then nothing is flagged
    await expect(page.getByTestId("budget-income-warning")).toHaveCount(0);
  });

  test("shows the warning after a target is raised above the average", async ({
    page,
  }) => {
    await openBudget(page, {
      seedTargetCents: 400000,
      averageMonthlyIncomeCents: LOWER_AVERAGE_CENTS,
      incomeMonthCount: 6,
    });
    await expect(page.getByTestId("budget-income-warning")).toHaveCount(0);

    await replaceTarget(page, "5000");

    const warning = page.getByTestId("budget-income-warning");
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(TARGET_TEXT);
  });

  test("clears the warning after a target is lowered below the average", async ({
    page,
  }) => {
    await openBudget(page, {
      seedTargetCents: TARGET_CENTS,
      averageMonthlyIncomeCents: LOWER_AVERAGE_CENTS,
      incomeMonthCount: 6,
    });
    await expect(page.getByTestId("budget-income-warning")).toBeVisible();

    await replaceTarget(page, "4000");

    await expect(page.getByTestId("budget-income-warning")).toHaveCount(0);
    await expect(page.getByTestId("budget-summary-strip")).toContainText("$4,000.00");
  });

  test("keeps the caution visible with values hidden, exposing neither amount", async ({
    page,
  }) => {
    // Given the privacy mask is on before the app boots
    await page.addInitScript(() => {
      window.localStorage.setItem("values-hidden", "true");
    });

    // When an eligible over-income target is rendered
    await openBudget(page, {
      seedTargetCents: TARGET_CENTS,
      averageMonthlyIncomeCents: LOWER_AVERAGE_CENTS,
      incomeMonthCount: 6,
    });

    // Then the caution still tells the user there is a problem…
    const warning = page.getByTestId("budget-income-warning");
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("Budget is above your usual income");

    // …without either figure reaching the DOM, here or anywhere else on the surface.
    await expect(warning).not.toContainText(TARGET_TEXT);
    await expect(warning).not.toContainText(AVERAGE_TEXT);
    await expect(page.getByText(TARGET_TEXT)).toHaveCount(0);
    await expect(page.getByText(AVERAGE_TEXT)).toHaveCount(0);
  });
});


test.describe("Add transactions menu", () => {
  // Base UI names the panel by the button that opens it, so both share one accessible name and are
  // told apart by role.
  const TRIGGER_NAME = "Add transactions";

  function trigger(page: Page) {
    return page.getByRole("button", { name: TRIGGER_NAME });
  }

  function menu(page: Page) {
    return page.getByRole("menu", { name: TRIGGER_NAME });
  }

  async function openBudget(page: Page, recurring?: RecurringFixture) {
    await setupTauriMock(page, { ...NO_INCOME_HISTORY, recurring });
    await page.goto("/spending/budget");
    await expect(page.getByTestId("budget-summary-strip")).toBeVisible();
  }

  async function openMenu(page: Page) {
    await trigger(page).click();
    await expect(menu(page)).toBeVisible();
  }

  test("gathers the three transaction-entry choices behind one trigger and leaves Add Group alone in the header", async ({
    page,
  }) => {
    // Given the Budget tab, with the menu closed
    await openBudget(page);
    await expect(page.getByTestId("add-group-button")).toBeVisible();
    await expect(menu(page)).toHaveCount(0);
    await expect(page.getByText("Apply recurring expenses")).toHaveCount(0);
    await expect(page.getByText("Import Statement")).toHaveCount(0);

    // When the user opens Add transactions
    await openMenu(page);

    // Then exactly the three approved choices are offered, named and in order
    await expect(menu(page).getByRole("menuitem")).toHaveText([
      "Import Statement",
      "Add expense manually",
      "Apply recurring expenses",
    ]);

    // …and the recurring action no longer sits in the page header
    await expect(page.getByTestId("apply-recurring-button")).toHaveCount(0);
    await expect(page.getByTestId("add-group-button")).toBeVisible();
  });

  test("sends the user to the dedicated import route", async ({ page }) => {
    // Given the open menu
    await openBudget(page);
    await openMenu(page);

    // When Import statement is chosen
    await page.getByTestId("import-statement-item").click();

    // Then the dedicated /import route owns the flow
    await expect(page).toHaveURL(/\/import$/);
    await expect(page.getByTestId("upload-zone")).toBeVisible();
  });

  test("opens the manual expense slide-over unfilled, with focus inside it", async ({
    page,
  }) => {
    // Given the open menu
    await openBudget(page);
    await openMenu(page);

    // When Add expense manually is chosen
    await page.getByTestId("add-expense-manually-item").click();

    // Then the existing expense form opens with nothing preselected or prefilled
    const slideOver = page.getByTestId("expense-slide-over");
    await expect(slideOver).toBeVisible();
    const form = page.getByTestId("add-expense-form");
    await expect(form).toBeVisible();
    await expect(form.getByLabel("Category")).toHaveText("Select a category");
    await expect(form.getByLabel("Merchant")).toHaveValue("");

    // …and focus is handed into the panel rather than dropped where the menu used to be
    await expect(form.getByLabel("Merchant")).toBeFocused();

    // When the panel is dismissed it goes away and the menu is closed behind it
    await page.getByTestId("slide-over-close").click();
    await expect(slideOver).toHaveCount(0);
    await expect(menu(page)).toHaveCount(0);
  });

  test("applies recurring expenses for the selected month and refuses a second submission while pending", async ({
    page,
  }) => {
    // Given a recurring apply the test holds open
    await openBudget(page, { outcome: "created", deferred: true });

    // When Apply recurring expenses is chosen
    await openMenu(page);
    await page.getByTestId("apply-recurring-item").click();

    // Then reopening the menu offers no second submission while the first is in flight
    await openMenu(page);
    await expect(page.getByTestId("apply-recurring-item")).toBeDisabled();

    // When the held request is released
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      window.__releaseRecurring?.();
    });

    // Then the existing success feedback reports what was created, and the choice returns
    await expect(page.getByText("Applied 1 recurring expense(s)")).toBeVisible();
    await openMenu(page);
    await expect(page.getByTestId("apply-recurring-item")).toBeEnabled();
  });

  test("keeps the existing already-applied toast when the month needs nothing", async ({
    page,
  }) => {
    // Given a month whose recurring expenses are all on record already
    await openBudget(page, { outcome: "none", deferred: false });

    // When Apply recurring expenses is chosen
    await openMenu(page);
    await page.getByTestId("apply-recurring-item").click();

    // Then the unchanged nothing-was-due wording explains it, and nothing is reported as created
    await expect(
      page.getByText("All recurring expenses already applied for this month")
    ).toBeVisible();
    await expect(page.getByText(/Applied \d+ recurring expense/)).toHaveCount(0);
  });

  test("keeps the existing recurring failure toast", async ({ page }) => {
    // Given a backend that rejects the apply
    await openBudget(page, { outcome: "failure", deferred: false });

    // When Apply recurring expenses is chosen
    await openMenu(page);
    await page.getByTestId("apply-recurring-item").click();

    // Then the unchanged error toast explains it
    await expect(
      page.getByText("Failed to apply recurring expenses")
    ).toBeVisible();
  });

  test("opens from the keyboard and lands focus on the first choice", async ({
    page,
  }) => {
    // Given keyboard focus on the trigger
    await openBudget(page);
    await trigger(page).focus();

    // When the menu is opened with Enter
    await page.keyboard.press("Enter");

    // Then the first choice holds focus and Escape returns it to the trigger
    await expect(page.getByTestId("import-statement-item")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("add-expense-manually-item")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
  });

  test("fits the longest French label on one line", async ({ page }) => {
    // Given the app switched to French
    await openBudget(page);
    await page.getByTestId("language-toggle").click();
    await expect(
      page.getByRole("button", { name: "Ajouter des transactions" })
    ).toBeVisible();

    // When the menu is opened
    await page.getByRole("button", { name: "Ajouter des transactions" }).click();
    await expect(
      page.getByRole("menu", { name: "Ajouter des transactions" })
    ).toBeVisible();

    // Then the longest item is neither clipped nor wrapped onto a second line
    const manualItem = page.getByTestId("add-expense-manually-item");
    await expect(manualItem).toHaveText("Ajouter une dépense manuellement");
    const layout = await manualItem.evaluate((element) => {
      const label = Array.from(element.childNodes).find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
      );
      if (label === undefined) {
        return null;
      }
      const range = document.createRange();
      range.selectNodeContents(label);
      // A wrapped text node reports one client rect per visual line, which is the only reading that
      // distinguishes "fits" from "fits after wrapping".
      return {
        lines: range.getClientRects().length,
        clipped: element.scrollWidth > element.clientWidth,
      };
    });
    expect(layout).toEqual({ lines: 1, clipped: false });
  });
});
