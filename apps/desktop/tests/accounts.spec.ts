import { test, expect, type Page } from "@playwright/test";

interface EarmarkFixture {
  account_id: number;
  balance_cents: number;
  earmarked_cents: number;
  unallocated_cents: number;
  segments: {
    project_id: number;
    project_name: string;
    earmarked_cents: number;
  }[];
}

interface BlockedDeleteFixture {
  account_name: string;
  project_names: string[];
}

interface MockOptions {
  earmarks: EarmarkFixture[];
  blockedDeletes: BlockedDeleteFixture[];
}

async function setupTauriMock(
  page: Page,
  earmarks: EarmarkFixture[] = [],
  blockedDeletes: BlockedDeleteFixture[] = []
) {
  await page.addInitScript(
    ({ earmarks: earmarkFixtures, blockedDeletes: blockedDeleteFixtures }: MockOptions) => {

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

    (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ =
      { unregisterListener: () => {} };

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      transformCallback: (cb: unknown) => {
        const id = Math.floor(Math.random() * 1e9);
        (window as unknown as Record<string, unknown>)[`_${id}`] = cb;
        return id;
      },
      invoke: (cmd: string, args: Record<string, unknown>) => {
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);
        switch (cmd) {
          case "get_accounts":
            return Promise.resolve(
              [...accounts].sort((a, b) => a.name.localeCompare(b.name))
            );

          case "get_assets":
            return Promise.resolve([]);

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
            // Stands in for the Rust guard: shaped like the serialized `AppError::Validation`, not a
            // bare string, or the component's readError would take its `typeof err === "string"` path.
            const blocked = blockedDeleteFixtures.find(
              (candidate) => candidate.account_name === accounts[idx].name
            );
            if (blocked)
              return Promise.reject({
                type: "validation",
                message: `This account still holds money set aside for: ${blocked.project_names.join(
                  ", "
                )}. Delete those contributions first.`,
                field: "id",
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

          case "get_account_earmark_breakdown": {
            const earmarkAccountId = args.account_id as number;
            const fixture = earmarkFixtures.find(
              (candidate) => candidate.account_id === earmarkAccountId
            );
            return Promise.resolve(
              fixture ?? {
                account_id: earmarkAccountId,
                balance_cents: 0,
                earmarked_cents: 0,
                unallocated_cents: 0,
                segments: [],
              }
            );
          }

          default:
            return Promise.reject(`Unknown command: ${cmd}`);
        }
      },
      convertFileSrc: (path: string) => path,
    };
  }, { earmarks, blockedDeletes });
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
    await page.goto("/wealth/accounts");
  });

  // === Story 4.1 Tests ===

  test("displays page header with Add Account button", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Accounts" })
    ).toBeVisible();
    await expect(page.getByTestId("add-account-button")).toBeVisible();
    await expect(page.getByTestId("add-account-button")).toContainText(
      "Add an account"
    );
    await expect(page.getByTestId("view-net-worth-button")).toBeVisible();
  });

  test("shows empty state with exactly one action when no accounts exist", async ({
    page,
  }) => {
    const emptyState = page.getByTestId("accounts-empty-state");
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText("No accounts yet");
    await expect(emptyState).toContainText(
      "Add your chequing, savings, and investment balances so your net worth reflects what you actually have."
    );
    await expect(
      emptyState.getByRole("button", { name: /Add an account/ })
    ).toBeVisible();
    // An empty state carries one action. Two competing choices is a decision the user cannot make
    // yet, so the former View-net-worth and Import buttons are gone by design.
    await expect(emptyState.getByRole("button")).toHaveCount(1);
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

  test("account row shows name, institution, expanded type + currency, and balance in tabular Inter", async ({
    page,
  }) => {
    await createAccount(page, "TFSA Investment", "Wealthsimple", "TFSA");

    const accountRow = page.getByTestId("account-row");
    await expect(accountRow).toContainText("TFSA Investment");
    await expect(accountRow).toContainText("Wealthsimple");
    // A registered account is expanded on first mention, never a bare acronym.
    await expect(accountRow).toContainText("Tax-free savings (TFSA)");
    await expect(accountRow).toContainText("CAD");

    const balanceFigure = page
      .getByTestId("account-balance")
      .locator('[data-slot="money"]');
    const { fontFamily, fontVariantNumeric } = await balanceFigure.evaluate(
      (el) => {
        const style = getComputedStyle(el);
        return {
          fontFamily: style.fontFamily,
          fontVariantNumeric: style.fontVariantNumeric,
        };
      }
    );
    // Column alignment comes from tabular figures, not from a code font: a monospace family on a
    // financial figure is banned outright.
    expect(fontVariantNumeric).toContain("tabular-nums");
    expect(fontFamily.toLowerCase()).toContain("inter");
    expect(fontFamily.toLowerCase()).not.toContain("mono");
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
    await emptyState.getByRole("button", { name: /Add an account/ }).click();
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

  test("the balance is a focusable control that Enter opens for editing", async ({
    page,
  }) => {
    await createAccount(page, "Main Chequing", "TD Bank");

    const balance = page.getByTestId("account-balance");
    // The dotted underline is the required resting affordance, and the value is a real control:
    // a keyboard-only user never hovers, so Enter has to do what the click does.
    await expect(balance).toHaveCSS("border-bottom-style", "dotted");
    await expect(balance).toHaveAttribute("role", "button");
    await balance.focus();
    await balance.press("Enter");
    await expect(page.getByTestId("account-balance-input")).toBeVisible();
  });

  test("clicking an account balance makes it an editable input field", async ({
    page,
  }) => {
    await createAccount(page, "Main Chequing", "TD Bank");

    const balance = page.getByTestId("account-balance");
    await balance.click();

    await expect(page.getByTestId("account-balance-input")).toBeVisible();
  });

  test("the balance affordance is never explained in helper text", async ({
    page,
  }) => {
    await createAccount(page, "Main Chequing", "TD Bank");

    // A hover-only hint is invisible to a keyboard user, so the affordance carries itself.
    await expect(
      page.getByTestId("account-row").getByText(/click to edit/i)
    ).toHaveCount(0);
  });

  test("typing a new balance and pressing Enter updates and shows toast", async ({
    page,
  }) => {
    await createAccount(page, "Main Chequing", "TD Bank");

    // Click balance to edit
    await page.getByTestId("account-balance").click();

    // Type new value
    const input = page.getByTestId("account-balance-input").locator("input");
    await input.fill("1500.00");
    await input.press("Enter");

    // Toast should appear
    await expect(page.getByText("Change saved").last()).toBeVisible();

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
    const input = page.getByTestId("account-balance-input").locator("input");
    await input.fill("9999.99");
    await input.press("Escape");

    // Should revert to original
    await expect(page.getByTestId("account-balance")).toContainText("$0.00");
  });

  test("liability balances display as a positive amount owed", async ({
    page,
  }) => {
    await createAccount(page, "Credit Card", "TD Bank", "Credit Card");

    // Directly update the mock's in-memory state to have a negative stored balance
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

    // Force TanStack Query to refetch by leaving the surface and coming back
    const wealthNav = page.getByRole("navigation", { name: "Wealth" });
    await wealthNav.getByRole("link", { name: "What you own", exact: true }).click();
    await expect(page).toHaveURL(/\/wealth\/assets/);
    await wealthNav.getByRole("link", { name: "Accounts", exact: true }).click();
    await expect(page).toHaveURL(/\/wealth\/accounts/);

    // The internal sign convention never surfaces: a card rendered as -$1,500.00 reads as a loss
    // rather than as what is owed. Owed-ness is carried by the Liabilities section and its total.
    const balance = page.getByTestId("account-balance");
    await expect(balance).toHaveText("$1,500.00");
    await expect(page.getByTestId("accounts-liability-section")).toBeVisible();
    await expect(page.getByTestId("accounts-debt-total")).toContainText(
      "$1,500.00"
    );
    await expect(page.getByTestId("accounts-debt-total")).not.toContainText(
      "-$"
    );

    const rawPaletteClasses = await balance.evaluate((el) =>
      [...el.classList].filter((name) =>
        /^text-(rose|red|amber|orange|emerald|green|teal|sky|indigo|violet|slate|zinc|gray)-\d{2,3}$/.test(
          name
        )
      )
    );
    expect(rawPaletteClasses).toEqual([]);
  });

  test("row actions live in an always-visible overflow menu, not a hover reveal", async ({
    page,
  }) => {
    await createAccount(page, "Main Chequing", "TD Bank");

    // Hover-only affordances with no resting state are banned, so the trigger is visible before
    // any pointer or keyboard interaction.
    const rowMenu = page.getByTestId("account-row-menu");
    await expect(rowMenu).toBeVisible();

    // Delete is demoted into the overflow rather than sitting in the row beside Edit.
    await expect(
      page.getByTestId("account-row").getByTestId("delete-account-button")
    ).toHaveCount(0);

    await rowMenu.click();
    await expect(page.getByTestId("edit-account-button")).toBeVisible();
    await expect(page.getByTestId("delete-account-button")).toBeVisible();
  });

  test("deleting account shows confirmation dialog and removes from list", async ({
    page,
  }) => {
    await createAccount(page, "Old Savings", "Tangerine");

    await page.getByTestId("account-row-menu").click();
    await page.getByTestId("delete-account-button").click();

    // Dialog should show
    await expect(page.getByTestId("delete-account-dialog")).toBeVisible();
    await expect(
      page.getByText("Are you sure you want to delete Old Savings?")
    ).toBeVisible();

    // Confirm delete
    await page.getByTestId("confirm-delete-account-button").click();

    // Toast and account gone
    await expect(page.getByText("Successfully deleted")).toBeVisible();
    await expect(page.getByTestId("accounts-empty-state")).toBeVisible();
  });

  test("multiple accounts show hero total, breakdown bar, and type groups", async ({
    page,
  }) => {
    await createAccount(page, "Main Chequing", "TD Bank", "Chequing");
    await page.getByTestId("account-balance").click();
    const input = page.getByTestId("account-balance-input").locator("input");
    await input.fill("5000.00");
    await input.press("Enter");
    await createAccount(page, "TFSA Investment", "Wealthsimple", "TFSA");

    await expect(page.getByTestId("accounts-total")).toContainText("$5,000.00");
    await expect(page.getByTestId("accounts-breakdown")).toBeVisible();
    await expect(page.getByTestId("breakdown-bar")).toBeVisible();
    await expect(page.getByTestId("account-type-group")).toHaveCount(2);
    await expect(page.getByTestId("accounts-net-worth-context")).toBeVisible();
    // One display figure per surface: the hero total. Section sums are secondary stats.
    await expect(page.locator('[data-slot="stat"]')).toHaveCount(1);
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

test.describe("Account earmark breakdown", () => {
  test("splits a funded account's balance into project rows, collapsed by default", async ({
    page,
  }) => {
    await setupTauriMock(page, [
      {
        account_id: 1,
        balance_cents: 1000000,
        earmarked_cents: 400000,
        unallocated_cents: 600000,
        segments: [
          { project_id: 1, project_name: "Kitchen", earmarked_cents: 300000 },
          { project_id: 2, project_name: "Trip", earmarked_cents: 100000 },
        ],
      },
    ]);
    await page.goto("/wealth/accounts");
    await createAccount(page, "Main Chequing", "TD Bank", "Chequing");

    const row = page.getByTestId("account-row").filter({ hasText: "Main Chequing" });
    const toggle = row.getByTestId("account-earmark-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(row.getByTestId("account-earmark-summary")).toContainText("$4,000.00");
    await expect(page.getByTestId("account-earmark-project-row")).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // No standalone earmarks section exists anywhere — the breakdown lives only in the row.
    await expect(page.getByTestId("accounts-earmarks")).toHaveCount(0);

    // Unallocated leads the expanded rows so "what's mine" reads before "what's set aside".
    await expect(page.getByTestId("account-earmark-unallocated-amount")).toContainText(
      "$6,000.00"
    );

    const projectRows = page.getByTestId("account-earmark-project-row");
    await expect(projectRows).toHaveCount(2);
    await expect(projectRows.nth(0)).toContainText("Kitchen");
    await expect(projectRows.nth(0).getByTestId("account-earmark-amount")).toContainText(
      "$3,000.00"
    );
    await expect(projectRows.nth(1)).toContainText("Trip");

    // Share moved into a tooltip rather than a legend column.
    await projectRows.nth(0).getByTestId("account-earmark-share-tooltip").hover();
    await expect(page.getByText("30% of Main Chequing's balance")).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("account-earmark-project-row")).toHaveCount(0);
    await expect(page.getByTestId("account-earmark-unallocated-row")).toHaveCount(0);
  });

  test("shows no expand toggle for an account with no contributions", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/wealth/accounts");
    await createAccount(page, "Main Chequing", "TD Bank", "Chequing");

    const row = page.getByTestId("account-row").filter({ hasText: "Main Chequing" });
    await expect(row.getByTestId("account-earmark-toggle")).toHaveCount(0);
    await expect(row.getByTestId("account-earmark-summary")).toHaveCount(0);
    await expect(page.getByTestId("accounts-earmarks")).toHaveCount(0);
  });
});

test.describe("Deleting an account that funds a project", () => {
  test("is refused with a toast naming the project, and the account stays listed", async ({
    page,
  }) => {
    await setupTauriMock(page, [], [
      { account_name: "Main Chequing", project_names: ["Car"] },
    ]);
    await page.goto("/wealth/accounts");
    await createAccount(page, "Main Chequing", "TD Bank", "Chequing");

    await page.getByTestId("account-row-menu").click();
    await page.getByTestId("delete-account-button").click();
    await page.getByTestId("confirm-delete-account-button").click();

    await expect(
      page.getByText(
        "This account still holds money set aside for: Car. Delete those contributions first."
      )
    ).toBeVisible();
    await expect(page.getByText("Failed to delete")).toHaveCount(0);
    await expect(
      page.getByTestId("account-row").filter({ hasText: "Main Chequing" })
    ).toBeVisible();
  });

  test("still deletes an account that funds nothing", async ({ page }) => {
    await setupTauriMock(page, [], [
      { account_name: "Funding Account", project_names: ["Car"] },
    ]);
    await page.goto("/wealth/accounts");
    await createAccount(page, "Free Account", "TD Bank", "Chequing");

    await page.getByTestId("account-row-menu").click();
    await page.getByTestId("delete-account-button").click();
    await page.getByTestId("confirm-delete-account-button").click();

    await expect(page.getByText("Successfully deleted")).toBeVisible();
    await expect(page.getByTestId("accounts-empty-state")).toBeVisible();
  });
});
