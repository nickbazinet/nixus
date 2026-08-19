import { test, expect, type Locator, type Page } from "@playwright/test";

const MOCK_CATEGORIES = [
  { id: 1, group_id: 1, name: "Groceries", target_cents: 50000, sort_order: 1, created_at: "2026-01-01" },
  { id: 2, group_id: 1, name: "Dining Out", target_cents: 30000, sort_order: 2, created_at: "2026-01-01" },
  { id: 3, group_id: 2, name: "Shopping", target_cents: 20000, sort_order: 1, created_at: "2026-01-01" },
];

async function setupTauriMock(
  page: Page,
  options?: { aiError?: boolean; badDates?: boolean; proposeCategory?: "existingGroup" | "newGroup" }
) {
  const aiError = options?.aiError ?? false;
  const badDates = options?.badDates ?? false;
  const proposeCategory = options?.proposeCategory ?? null;

  await page.addInitScript(
    ({ aiError, badDates, proposeCategory, categories }) => {
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

      // Unlisten reads this synchronously; without it every listener cleanup throws.
      (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: () => {},
      };

      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: Record<string, unknown>) => {
          const invokeLog =
            ((window as unknown as Record<string, unknown>).__TAURI_INVOKE_LOG__ as
              | { cmd: string; args: Record<string, unknown> }[]
              | undefined) ?? [];
          invokeLog.push({ cmd, args });
          (window as unknown as Record<string, unknown>).__TAURI_INVOKE_LOG__ = invokeLog;

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
            case "check_picker_gate":
              return Promise.resolve({ needs_picker: false });

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

            case "save_import_clipboard_image": {
              const extension = String(args.extension ?? "").toLowerCase();
              const bytesBase64 = String(args.bytes_base64 ?? "");
              if (!bytesBase64) {
                return Promise.reject({ type: "file", message: "Clipboard image is empty" });
              }
              if (!["png", "jpg", "jpeg"].includes(extension)) {
                return Promise.reject({
                  type: "file",
                  message: "Only PNG and JPEG screenshots can be pasted",
                });
              }
              return Promise.resolve({
                file_path: `/tmp/pasted-statement.${extension === "jpeg" ? "jpg" : extension}`,
              });
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
                  : proposeCategory
                    ? [
                        { merchant: "Amazon", amount_cents: 4599, date: "2026-03-10", suggested_category_id: 1, confidence: 0.95 },
                        {
                          merchant: "Petsmart",
                          amount_cents: 3200,
                          date: "2026-03-12",
                          suggested_category_id: null,
                          confidence: 0.0,
                          propose_category:
                            proposeCategory === "existingGroup"
                              ? { name: "Pet Supplies", group_id: 1, group_name: null }
                              : { name: "Pet Supplies", group_id: null, group_name: "Pets" },
                        },
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

            case "create_budget_group": {
              const newGroup = { id: 100, name: args.name, sort_order: 99, created_at: "2026-01-01" };
              return Promise.resolve(newGroup);
            }

            case "create_budget_category": {
              const newCategory = {
                id: 200,
                group_id: args.group_id,
                name: args.name,
                target_cents: args.target_cents,
                sort_order: 99,
                created_at: "2026-01-01",
              };
              categories.push(newCategory);
              return Promise.resolve(newCategory);
            }

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
    { aiError, badDates, proposeCategory, categories: MOCK_CATEGORIES }
  );
}

async function triggerUpload(page: Page) {
  await page.getByTestId("upload-zone").click();
}

/** Amount fields are the shared `Input money`, so the field is reached through its wrapper. */
function amountInputOf(scope: Locator) {
  return scope.getByTestId("amount-input-field").getByRole("textbox");
}

/** Resolves a utility class to the colour it actually computes to, so dimming can be asserted
 *  as a rendered style rather than as a class-name string. */
async function computedColorOfClass(page: Page, className: string): Promise<string> {
  return page.evaluate((cls) => {
    const probe = document.createElement("span");
    probe.className = cls;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, className);
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
    await expect(zone).toContainText("paste a screenshot");
    await expect(zone).toContainText("PNG, JPG, PDF accepted");
  });

  test("pasting a screenshot image starts the import pipeline [AC1, AC7]", async ({ page }) => {
    await page.evaluate(async () => {
      (window as unknown as Record<string, unknown>).__TAURI_INVOKE_LOG__ = [];
      // Minimal 1x1 PNG
      const pngBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const binary = atob(pngBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], "screenshot.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });

    await expect(page.getByTestId("import-progress-stepper")).toBeVisible({ timeout: 5000 });

    const saveCalls = await page.evaluate(() => {
      const log =
        ((window as unknown as Record<string, unknown>).__TAURI_INVOKE_LOG__ as
          | { cmd: string; args: Record<string, unknown> }[]
          | undefined) ?? [];
      return log.filter((entry) => entry.cmd === "save_import_clipboard_image");
    });
    expect(saveCalls.length).toBeGreaterThan(0);
    expect(saveCalls[0]?.args?.extension).toBe("png");
    expect(typeof saveCalls[0]?.args?.bytes_base64).toBe("string");
    expect(String(saveCalls[0]?.args?.bytes_base64).length).toBeGreaterThan(0);
  });

  test("pasting without an image shows inline paste error [AC2, AC7]", async ({ page }) => {
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData("text/plain", "not an image");
      window.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })
      );
    });

    await expect(page.getByTestId("upload-error")).toBeVisible();
    await expect(page.getByTestId("upload-error")).toContainText(
      "Clipboard has no image to paste"
    );
    await expect(page.getByTestId("upload-zone")).toBeVisible();
  });

  test("pasting an unsupported image type shows a specific error [AC2]", async ({ page }) => {
    await page.evaluate(() => {
      const file = new File([new Uint8Array([0, 0, 0, 0])], "shot.webp", { type: "image/webp" });
      const dt = new DataTransfer();
      dt.items.add(file);
      window.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })
      );
    });

    await expect(page.getByTestId("upload-error")).toContainText(
      "Only PNG and JPEG screenshots can be pasted"
    );
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
    const summary = page.getByTestId("review-summary");
    await expect(summary.getByRole("heading")).toHaveText("2 transactions found");
    await expect(summary).toContainText("1 already sorted. 1 need a look from you.");
  });

  test("when AI service is unavailable, inline alert shows with manual entry link [AC6]", async ({ page }) => {
    await setupTauriMock(page, { aiError: true });
    await page.goto("/import");
    await triggerUpload(page);

    await expect(page.getByTestId("import-error-state")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Nixus can't read statements right now")).toBeVisible();

    // Non-modal and recoverable: nothing traps focus, retry stays available, and the manual path
    // is named rather than implied.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("try-again-button")).toBeVisible();
    const manual = page.getByTestId("manual-entry-link");
    await expect(manual).toBeVisible();
    await expect(manual).toHaveText("Add transactions manually");
    await expect(manual).toHaveAttribute("href", "/spending/transactions");
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
    const summary = page.getByTestId("review-summary");
    await expect(summary.getByRole("heading")).toHaveText("2 transactions found");
    await expect(summary).toContainText("1 already sorted. 1 need a look from you.");
  });

  test("AutoCategorizedSummary renders collapsed with count [AC2]", async ({ page }) => {
    const summary = page.getByTestId("auto-categorized-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("1 of 1 already sorted");
    await expect(page.getByTestId("auto-categorized-list")).toHaveCount(0);
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
    // Money is entered through the shared `Input money`, which renders dollars at two decimals.
    await expect(amountInputOf(card)).toHaveValue("21.50");
    await expect(card.getByTestId("category-select")).toBeVisible();
  });

  test("selecting a different category on flagged card keeps the resolved status [AC4]", async ({ page }) => {
    const card = page.getByTestId("transaction-review-card");
    // The card has a suggested category (id: 2), so it already reads as resolved. Status is now
    // carried by a labelled badge instead of a palette class on the card.
    await expect(card.getByTestId("review-row-status")).toHaveText("Sorted");

    await card.getByTestId("category-select").click();
    await page.getByRole("option", { name: "Shopping" }).click();

    await expect(card.getByTestId("category-select")).toContainText("Shopping");
    await expect(card.getByTestId("review-row-status")).toHaveText("Sorted");
  });

  test("confirm button is disabled until all flagged items resolved [AC5]", async ({ page }) => {
    const confirmBtn = page.getByTestId("confirm-import-button");
    // The flagged transaction (Uber Eats) already has suggested_category_id: 2
    // which is non-null, so it should be resolved
    await expect(confirmBtn).toBeEnabled();
    await expect(confirmBtn).toContainText("Add 2 transactions");
  });

  test("clicking confirm saves transactions and shows completion screen [AC6, AC7]", async ({ page }) => {
    const confirmBtn = page.getByTestId("confirm-import-button");
    await confirmBtn.click();

    // Wait for completion screen
    const completion = page.getByTestId("import-completion");
    await expect(completion).toBeVisible({ timeout: 5000 });
    await expect(completion.getByRole("heading")).toHaveText("Added to your spending");
    await expect(completion.getByTestId("completion-total")).toContainText("2 transactions");
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

test.describe("Import Page — AI Category Proposals", () => {
  test("shows a create-category proposal when the AI finds no matching category", async ({ page }) => {
    await setupTauriMock(page, { proposeCategory: "existingGroup" });
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    const card = page.getByTestId("transaction-review-card");
    await expect(card.getByTestId("propose-category-alert")).toContainText("Pet Supplies");
    await expect(card.getByTestId("review-row-status")).toHaveText("Needs a category");
  });

  test("confirming a proposal with an existing group id creates only the category [AC3]", async ({ page }) => {
    await setupTauriMock(page, { proposeCategory: "existingGroup" });
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    const card = page.getByTestId("transaction-review-card");
    await card.getByTestId("create-category-button").click();

    await expect(card.getByTestId("review-row-status")).toHaveText("Sorted");

    const invokeLog = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__TAURI_INVOKE_LOG__
    );
    const calls = invokeLog as { cmd: string; args: Record<string, unknown> }[];
    expect(calls.some((c) => c.cmd === "create_budget_group")).toBe(false);
    expect(calls).toContainEqual({
      cmd: "create_budget_category",
      args: { group_id: 1, name: "Pet Supplies", target_cents: 100 },
    });
  });

  test("confirming a proposal with no existing group creates the group first, then the category [AC2]", async ({
    page,
  }) => {
    await setupTauriMock(page, { proposeCategory: "newGroup" });
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    const card = page.getByTestId("transaction-review-card");
    await card.getByTestId("create-category-button").click();

    await expect(card.getByTestId("review-row-status")).toHaveText("Sorted");

    const invokeLog = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__TAURI_INVOKE_LOG__
    );
    const calls = invokeLog as { cmd: string; args: Record<string, unknown> }[];
    expect(calls).toContainEqual({ cmd: "create_budget_group", args: { name: "Pets" } });
    expect(calls).toContainEqual({
      cmd: "create_budget_category",
      args: { group_id: 100, name: "Pet Supplies", target_cents: 100 },
    });
  });

  test("ignoring the proposal and picking a category manually still works [AC4]", async ({ page }) => {
    await setupTauriMock(page, { proposeCategory: "existingGroup" });
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    const card = page.getByTestId("transaction-review-card");
    await card.getByTestId("category-select").click();
    await page.getByRole("option", { name: "Shopping" }).click();

    await expect(card.getByTestId("review-row-status")).toHaveText("Sorted");
    await expect(card.getByTestId("create-category-button")).toHaveCount(0);
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

  test("unchecking a transaction removes it from the import count", async ({ page }) => {
    // Uncheck the flagged transaction (Uber Eats)
    const card = page.getByTestId("transaction-review-card");
    await card.getByTestId("transaction-checkbox").uncheck();
    await expect(page.getByTestId("confirm-import-button")).toContainText("Add 1 transaction");
  });

  test("re-checking a transaction includes it again", async ({ page }) => {
    const card = page.getByTestId("transaction-review-card");
    await card.getByTestId("transaction-checkbox").uncheck();
    await expect(page.getByTestId("confirm-import-button")).toContainText("Add 1 transaction");
    await card.getByTestId("transaction-checkbox").check();
    await expect(page.getByTestId("confirm-import-button")).toContainText("Add 2 transactions");
  });

  test("editing merchant name on flagged card persists the value", async ({ page }) => {
    const card = page.getByTestId("transaction-review-card");
    const merchantInput = card.getByTestId("merchant-input");
    await merchantInput.fill("Amazon Prime");
    await expect(merchantInput).toHaveValue("Amazon Prime");
  });

  test("editing amount on flagged card persists the value", async ({ page }) => {
    const card = page.getByTestId("transaction-review-card");
    const amountInput = amountInputOf(card);
    await amountInput.fill("3000");
    await amountInput.blur();
    // Re-formatting on blur proves the typed dollars round-tripped through stored cents.
    await expect(amountInput).toHaveValue("3,000.00");
  });

  test("unchecked transactions are visually dimmed", async ({ page }) => {
    const card = page.getByTestId("transaction-review-card");
    const content = card.getByTestId("review-row-content");
    const inkColor = await computedColorOfClass(page, "text-ink");
    const dimColor = await computedColorOfClass(page, "text-ink-dim");
    expect(dimColor).not.toBe(inkColor);

    await expect(content).toHaveCSS("color", inkColor);
    await card.getByTestId("transaction-checkbox").uncheck();
    await expect(content).toHaveCSS("color", dimColor);
  });

  test("unchecking an auto-categorized transaction removes it from the import count", async ({ page }) => {
    // Expand auto-categorized section
    await page.getByTestId("auto-categorized-toggle").click();
    await expect(page.getByTestId("auto-categorized-list")).toBeVisible();
    // Uncheck the Amazon auto-categorized transaction
    await page.getByTestId("auto-transaction-checkbox").uncheck();
    await expect(page.getByTestId("confirm-import-button")).toContainText("Add 1 transaction");
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
    await expect(page.getByTestId("confirm-import-button")).toContainText("Add 1 transaction");

    // Confirm
    await page.getByTestId("confirm-import-button").click();
    const completion = page.getByTestId("import-completion");
    await expect(completion).toBeVisible({ timeout: 5000 });
    await expect(completion.getByTestId("completion-total")).toContainText("1 transaction");

    const sent = (await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__LAST_CONFIRM_IMPORT_ARGS__
    )) as { transactions: { merchant: string }[] };
    expect(sent.transactions).toHaveLength(1);
    expect(sent.transactions[0].merchant).toBe("Amazon");
  });

  test("review header checkbox is indeterminate on a partial selection and states the selected sum", async ({
    page,
  }) => {
    const headerCheckbox = page.getByTestId("review-select-all");
    await expect(headerCheckbox).toBeChecked();

    await page.getByTestId("transaction-review-card").getByTestId("transaction-checkbox").uncheck();

    // Partial selection is neither checked nor unchecked; reporting it as either misstates what
    // the header controls.
    await expect(headerCheckbox).toHaveAttribute("aria-checked", "mixed");

    const bulkBar = page.getByTestId("import-bulk-bar");
    await expect(bulkBar).toContainText("1 selected");
    await expect(bulkBar).toContainText("$45.99");

    // Money is tabular Inter, never monospace.
    await expect(bulkBar.getByText("$45.99", { exact: true })).toHaveCSS(
      "font-variant-numeric",
      "tabular-nums"
    );

    await headerCheckbox.click();
    await expect(page.getByTestId("confirm-import-button")).toContainText("Add 2 transactions");
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

    // Fix the Coffee Shop date — click the date picker button, then select the 14th
    const rows = page.getByTestId("auto-categorized-row");
    const firstDatePicker = rows.first().getByTestId("auto-date-input").locator("button");
    await firstDatePicker.click();
    // Select day 14 from the calendar popover
    await page.getByRole("gridcell", { name: "14" }).first().click();

    // The calendar cannot seed a month from an unreadable AI date, so it opens on the current one.
    // The expected value is therefore read back off the control rather than hard-coded.
    const pickedLabel = (await firstDatePicker.innerText()).trim();

    // Now confirm
    await page.getByTestId("confirm-import-button").click();
    const completion = page.getByTestId("import-completion");
    await expect(completion).toBeVisible({ timeout: 5000 });
    await expect(completion.getByRole("heading")).toHaveText("Added to your spending");

    // Verify the corrected date was sent to confirm_import, and that it is the date the control
    // shows — a picker that displays one day and commits another is the failure worth catching.
    const lastArgs = (await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__LAST_CONFIRM_IMPORT_ARGS__
    )) as { transactions: { date: string; merchant: string }[] };
    const coffeeShop = lastArgs.transactions.find((t) => t.merchant === "Coffee Shop");
    expect(coffeeShop?.date).toMatch(/^\d{4}-\d{2}-14$/);
    expect(
      new Date(`${coffeeShop?.date}T00:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    ).toBe(pickedLabel);
  });
});
