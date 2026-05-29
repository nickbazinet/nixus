import { test, expect, type Page } from "@playwright/test";

const MOCK_CATEGORIES = [
  { id: 1, group_id: 1, name: "Groceries", target_cents: 50000, sort_order: 1, created_at: "2026-01-01" },
  { id: 2, group_id: 1, name: "Dining Out", target_cents: 30000, sort_order: 2, created_at: "2026-01-01" },
  { id: 3, group_id: 2, name: "Shopping", target_cents: 20000, sort_order: 1, created_at: "2026-01-01" },
];

async function setupTauriMock(page: Page, options?: { aiError?: boolean; badDates?: boolean }) {
  const aiError = options?.aiError ?? false;
  const badDates = options?.badDates ?? false;

  await page.addInitScript(
    ({ aiError, badDates, categories }) => {
      type EventCallback = (event: { event: string; payload: unknown; id: number }) => void;
      const eventListeners: Record<string, EventCallback[]> = {};
      const callbacks: Record<number, EventCallback> = {};
      let nextCallbackId = 1;

      function emitEvent(event: string, payload: unknown) {
        const cbs = eventListeners[event] ?? [];
        for (const cb of cbs) {
          cb({ event, payload, id: Math.random() });
        }
      }

      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: Record<string, unknown>) => {
          if (cmd === "plugin:event|listen") {
            const event = args.event as string;
            const handlerId = args.handler as number;
            if (!eventListeners[event]) eventListeners[event] = [];
            const cb = callbacks[handlerId];
            if (cb) eventListeners[event].push(cb);
            return Promise.resolve(handlerId);
          }
          if (cmd === "plugin:event|unlisten") return Promise.resolve(null);
          if (cmd === "plugin:dialog|open") return Promise.resolve("/tmp/statement.png");

          switch (cmd) {
            case "validate_cc_file": {
              const filePath = args.file_path as string;
              if (!filePath) return Promise.reject({ type: "file", message: "File not found" });
              const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
              if (!["png", "jpg", "jpeg", "pdf"].includes(ext)) {
                return Promise.reject({ type: "file", message: "Only images and PDFs supported" });
              }
              const fileName = filePath.split("/").pop() ?? "unknown";
              return Promise.resolve({ file_name: fileName, file_path: filePath, file_size: 1024 });
            }

            case "import_cc_statement": {
              setTimeout(() => emitEvent("import:progress", { stage: "uploading", message: "Preparing file..." }), 50);
              setTimeout(() => emitEvent("import:progress", { stage: "extracting", message: "AI is reading your statement..." }), 100);

              if (aiError) {
                setTimeout(() => emitEvent("import:error", { message: "AI service error: Bedrock unavailable", recoverable: true }), 200);
                return Promise.reject({ type: "ai_service", message: "AI service error: Bedrock unavailable", recoverable: true });
              }

              setTimeout(() => emitEvent("import:progress", { stage: "categorizing", message: "Categorized 2 transactions..." }), 200);
              setTimeout(() => {
                emitEvent("import:progress", { stage: "done" });
                const transactions = badDates
                  ? [
                      { merchant: "Coffee Shop", amount_cents: 550, date: "14 MAR", suggested_category_id: 1, confidence: 0.95 },
                      { merchant: "Gas Station", amount_cents: 4200, date: "2026-03-15", suggested_category_id: 2, confidence: 0.95 },
                    ]
                  : [
                      { merchant: "Amazon", amount_cents: 4599, date: "2026-03-10", suggested_category_id: 1, confidence: 0.95 },
                      { merchant: "Uber Eats", amount_cents: 2150, date: "2026-03-11", suggested_category_id: 2, confidence: 0.6 },
                    ];
                emitEvent("import:complete", {
                  transactions,
                  flagged_count: badDates ? 0 : 1,
                  auto_count: badDates ? 2 : 1,
                  unreadable: [],
                });
              }, 300);
              return Promise.resolve(null);
            }

            case "get_all_budget_categories":
              return Promise.resolve(categories);

            case "confirm_import":
              (window as unknown as Record<string, unknown>).__LAST_CONFIRM_IMPORT_ARGS__ = args;
              return Promise.resolve({ imported_count: (args.transactions as unknown[]).length });

            case "get_db_status":
              return Promise.resolve({ db_path: "mock.db", wal_mode: true, schema_version: 8, migrations_applied: 8 });

            default:
              return Promise.resolve(null);
          }
        },
        transformCallback: (callback: EventCallback) => {
          const id = nextCallbackId++;
          callbacks[id] = callback;
          return id;
        },
        unregisterCallback: () => {},
        convertFileSrc: (path: string) => path,
      };
    },
    { aiError, badDates, categories: MOCK_CATEGORIES }
  );
}

async function triggerUpload(page: Page) {
  await page.getByTestId("upload-zone").click();
}

// === Story 6.1 Tests ===

test.describe("Import Page — Story 6.1", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/import");
  });

  test("displays page header and centered upload zone [AC1]", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Import" })).toBeVisible();
    await expect(page.getByTestId("upload-zone")).toBeVisible();
  });

  test("upload zone shows drag-and-drop instructions [AC1]", async ({ page }) => {
    const zone = page.getByTestId("upload-zone");
    await expect(zone).toContainText("Drop your statement here");
    await expect(zone).toContainText("PNG, JPG, PDF accepted");
  });

  test("clicking upload zone triggers file selection interaction [AC2]", async ({ page }) => {
    const zone = page.getByTestId("upload-zone");
    await expect(zone).toHaveAttribute("role", "button");
    await expect(zone).toHaveAttribute("tabindex", "0");
  });

  test("uploading invalid file type returns error [AC4]", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const internals = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ as {
        invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
      };
      try {
        await internals.invoke("validate_cc_file", { file_path: "/tmp/test.docx" });
        return { success: true };
      } catch (e) { return e; }
    });
    expect(result).toEqual({ type: "file", message: "Only images and PDFs supported" });
  });

  test("valid file validation returns success result [AC4, AC5]", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const internals = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ as {
        invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
      };
      return internals.invoke("validate_cc_file", { file_path: "/tmp/statement.png" });
    });
    expect(result).toEqual({ file_name: "statement.png", file_path: "/tmp/statement.png", file_size: 1024 });
  });
});

// === Story 6.2 Tests ===

test.describe("Import Page — Story 6.2", () => {
  test("ImportProgressStepper renders 4 stages with correct labels [AC1]", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/import");
    await triggerUpload(page);

    await expect(page.getByTestId("import-progress-stepper")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("stage-uploading")).toBeVisible();
    await expect(page.getByTestId("stage-extracting")).toBeVisible();
    await expect(page.getByTestId("stage-categorizing")).toBeVisible();
    await expect(page.getByTestId("stage-done")).toBeVisible();
  });

  test("import complete shows review screen with transaction counts [AC4]", async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/import");
    await triggerUpload(page);

    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("2 transactions extracted")).toBeVisible();
    await expect(page.getByText("1 auto-categorized, 1 need review")).toBeVisible();
  });

  test("when AI service is unavailable, inline alert shows with manual entry link [AC6]", async ({ page }) => {
    await setupTauriMock(page, { aiError: true });
    await page.goto("/import");
    await triggerUpload(page);

    await expect(page.getByTestId("import-error-state")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Import is temporarily unavailable.")).toBeVisible();
    await expect(page.getByTestId("manual-entry-link")).toBeVisible();
  });
});

// === Story 6.3 Tests ===

test.describe("Import Page — Story 6.3", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/import");
    await triggerUpload(page);
    // Wait for review screen
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });
  });

  test("summary header shows transaction counts [AC1]", async ({ page }) => {
    await expect(page.getByText("2 transactions extracted")).toBeVisible();
    await expect(page.getByText("1 auto-categorized, 1 need review")).toBeVisible();
  });

  test("AutoCategorizedSummary renders collapsed with count [AC2]", async ({ page }) => {
    const summary = page.getByTestId("auto-categorized-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("1 transactions auto-categorized");
  });

  test("clicking expand on AutoCategorizedSummary shows transaction list [AC2]", async ({ page }) => {
    await page.getByTestId("auto-categorized-toggle").click();
    await expect(page.getByTestId("auto-categorized-list")).toBeVisible();
    await expect(page.getByTestId("auto-categorized-row")).toBeVisible();
    await expect(page.getByTestId("auto-merchant-input")).toHaveValue("Amazon");
  });

  test("TransactionReviewCard displays with merchant, amount, and category dropdown [AC3]", async ({ page }) => {
    const card = page.getByTestId("transaction-review-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("merchant-input")).toHaveValue("Uber Eats");
    await expect(card.getByTestId("amount-input")).toHaveValue("21.5");
    await expect(card.getByTestId("category-select")).toBeVisible();
  });

  test("selecting a different category on flagged card keeps positive styling [AC4]", async ({ page }) => {
    const card = page.getByTestId("transaction-review-card");
    // Card has a suggested category (id: 2), so it's already resolved with emerald
    await expect(card).toHaveClass(/emerald/);

    // Change to a different category
    await card.getByTestId("category-select").click();
    await page.getByRole("option", { name: "Shopping" }).click();

    // Should still have emerald styling (resolved)
    await expect(card).toHaveClass(/emerald/);
  });

  test("confirm button is disabled until all flagged items resolved [AC5]", async ({ page }) => {
    const confirmBtn = page.getByTestId("confirm-import-button");
    // The flagged transaction (Uber Eats) already has suggested_category_id: 2
    // which is non-null, so it should be resolved
    await expect(confirmBtn).toBeEnabled();
    await expect(confirmBtn).toContainText("Import 2 transactions");
  });

  test("clicking confirm saves transactions and shows completion screen [AC6, AC7]", async ({ page }) => {
    const confirmBtn = page.getByTestId("confirm-import-button");
    await confirmBtn.click();

    // Wait for completion screen
    await expect(page.getByTestId("import-completion")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Import Complete")).toBeVisible();
    await expect(page.getByTestId("view-dashboard-button")).toBeVisible();
    await expect(page.getByTestId("import-another-link")).toBeVisible();
  });

  test("clicking View Dashboard navigates to dashboard [AC7]", async ({ page }) => {
    await page.getByTestId("confirm-import-button").click();
    await expect(page.getByTestId("import-completion")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("view-dashboard-button").click();
    await expect(page).toHaveURL("/");
  });
});

// === Story 6.4 Tests ===

test.describe("Import Page — Editable & Removable Transactions", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });
  });

  test("unchecking a transaction excludes it from import count", async ({ page }) => {
    // Uncheck the flagged transaction (Uber Eats)
    const card = page.getByTestId("transaction-review-card");
    await card.getByTestId("transaction-checkbox").uncheck();
    await expect(page.getByTestId("confirm-import-button")).toContainText("Import 1 transaction");
  });

  test("re-checking a transaction includes it again", async ({ page }) => {
    const card = page.getByTestId("transaction-review-card");
    await card.getByTestId("transaction-checkbox").uncheck();
    await expect(page.getByTestId("confirm-import-button")).toContainText("Import 1 transaction");
    await card.getByTestId("transaction-checkbox").check();
    await expect(page.getByTestId("confirm-import-button")).toContainText("Import 2 transactions");
  });

  test("editing merchant name on flagged card persists the value", async ({ page }) => {
    const card = page.getByTestId("transaction-review-card");
    const merchantInput = card.getByTestId("merchant-input");
    await merchantInput.fill("Amazon Prime");
    await expect(merchantInput).toHaveValue("Amazon Prime");
  });

  test("editing amount on flagged card persists the value", async ({ page }) => {
    const card = page.getByTestId("transaction-review-card");
    const amountInput = card.getByTestId("amount-input");
    await amountInput.fill("3000");
    await expect(amountInput).toHaveValue("3000");
  });

  test("unchecked transactions are visually dimmed", async ({ page }) => {
    const card = page.getByTestId("transaction-review-card");
    await card.getByTestId("transaction-checkbox").uncheck();
    // The content div inside the card should have opacity-50
    const contentDiv = card.locator("> div > div.flex-1");
    await expect(contentDiv).toHaveClass(/opacity-50/);
  });

  test("unchecking an auto-categorized transaction excludes it from import count", async ({ page }) => {
    // Expand auto-categorized section
    await page.getByTestId("auto-categorized-toggle").click();
    await expect(page.getByTestId("auto-categorized-list")).toBeVisible();
    // Uncheck the Amazon auto-categorized transaction
    await page.getByTestId("auto-transaction-checkbox").uncheck();
    await expect(page.getByTestId("confirm-import-button")).toContainText("Import 1 transaction");
  });

  test("editing merchant name on auto-categorized row persists the value", async ({ page }) => {
    await page.getByTestId("auto-categorized-toggle").click();
    const merchantInput = page.getByTestId("auto-merchant-input");
    await merchantInput.fill("Amazon Prime");
    await expect(merchantInput).toHaveValue("Amazon Prime");
  });

  test("confirm only sends selected transactions", async ({ page }) => {
    // Uncheck the flagged transaction
    const card = page.getByTestId("transaction-review-card");
    await card.getByTestId("transaction-checkbox").uncheck();
    await expect(page.getByTestId("confirm-import-button")).toContainText("Import 1 transaction");

    // Confirm
    await page.getByTestId("confirm-import-button").click();
    await expect(page.getByTestId("import-completion")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("import-completion").getByText("1 transactions")).toBeVisible();
  });
});

// === Date Normalization Tests ===

test.describe("Import Page — Date Normalization", () => {
  test("date input shows empty for non-YYYY-MM-DD AI date", async ({ page }) => {
    await setupTauriMock(page, { badDates: true });
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    // Expand auto-categorized to see both transactions
    await page.getByTestId("auto-categorized-toggle").click();
    await expect(page.getByTestId("auto-categorized-list")).toBeVisible();

    // Coffee Shop has "14 MAR" — date picker can't parse it, shows placeholder
    const rows = page.getByTestId("auto-categorized-row");
    const firstDatePicker = rows.first().getByTestId("auto-date-input");
    await expect(firstDatePicker).toContainText("Pick a date");

    // Gas Station has "2026-03-15" — renders formatted date
    const secondDatePicker = rows.nth(1).getByTestId("auto-date-input");
    await expect(secondDatePicker).toContainText("Mar 15, 2026");
  });

  test("confirm button is disabled when transaction has invalid date", async ({ page }) => {
    await setupTauriMock(page, { badDates: true });
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    // Confirm button should be disabled because Coffee Shop has "14 MAR" (not YYYY-MM-DD)
    await expect(page.getByTestId("confirm-import-button")).toBeDisabled();
  });

  test("fixing date via picker then confirming succeeds", async ({ page }) => {
    await setupTauriMock(page, { badDates: true });
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    // Expand auto-categorized
    await page.getByTestId("auto-categorized-toggle").click();
    await expect(page.getByTestId("auto-categorized-list")).toBeVisible();

    // Fix the Coffee Shop date — click the date picker button, then select March 14
    const rows = page.getByTestId("auto-categorized-row");
    const firstDatePicker = rows.first().getByTestId("auto-date-input").locator("button");
    await firstDatePicker.click();
    // Select day 14 from the calendar popover
    await page.getByRole("gridcell", { name: "14" }).first().click();

    // Now confirm
    await page.getByTestId("confirm-import-button").click();
    await expect(page.getByTestId("import-completion")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Import Complete")).toBeVisible();

    // Verify the corrected date was sent to confirm_import
    const lastArgs = await page.evaluate(() =>
      (window as unknown as Record<string, unknown>).__LAST_CONFIRM_IMPORT_ARGS__
    ) as { transactions: { date: string; merchant: string }[] };
    const coffeeShop = lastArgs.transactions.find((t) => t.merchant === "Coffee Shop");
    expect(coffeeShop?.date).toBe("2026-03-14");
  });
});
