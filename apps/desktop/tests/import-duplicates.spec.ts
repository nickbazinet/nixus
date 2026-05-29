import { test, expect, type Page } from "@playwright/test";

const MOCK_CATEGORIES = [
  { id: 1, group_id: 1, name: "Groceries", target_cents: 50000, sort_order: 1, created_at: "2026-01-01" },
  { id: 2, group_id: 1, name: "Dining Out", target_cents: 30000, sort_order: 2, created_at: "2026-01-01" },
];

async function setupTauriMock(page: Page, duplicateIndices: number[]) {
  await page.addInitScript(
    ({ categories, duplicateIndices }) => {
      type EventCallback = (event: { event: string; payload: unknown; id: number }) => void;
      const eventListeners: Record<string, EventCallback[]> = {};
      const callbacks: Record<number, EventCallback> = {};
      let nextCallbackId = 1;

      function emitEvent(event: string, payload: unknown) {
        const cbs = eventListeners[event] ?? [];
        for (const cb of cbs) cb({ event, payload, id: Math.random() });
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
            case "validate_cc_file":
              return Promise.resolve({ file_name: "statement.png", file_path: "/tmp/statement.png", file_size: 1024 });

            case "import_cc_statement": {
              setTimeout(() => emitEvent("import:progress", { stage: "uploading", message: "Preparing..." }), 30);
              setTimeout(() => emitEvent("import:progress", { stage: "extracting", message: "Reading..." }), 60);
              setTimeout(() => emitEvent("import:progress", { stage: "categorizing", message: "Categorized 3 transactions..." }), 90);
              setTimeout(() => {
                emitEvent("import:progress", { stage: "done" });
                emitEvent("import:complete", {
                  transactions: [
                    { merchant: "Costco", amount_cents: 4500, date: "2026-03-20", suggested_category_id: 1, confidence: 0.95 },
                    { merchant: "Uber Eats", amount_cents: 2150, date: "2026-03-21", suggested_category_id: 2, confidence: 0.95 },
                    { merchant: "Starbucks", amount_cents: 650, date: "2026-03-22", suggested_category_id: 2, confidence: 0.6 },
                  ],
                  flagged_count: 1,
                  auto_count: 2,
                  unreadable: [],
                  duplicate_indices: duplicateIndices,
                });
              }, 120);
              return Promise.resolve(null);
            }

            case "get_all_budget_categories":
              return Promise.resolve(categories);

            case "confirm_import":
              return Promise.resolve({ imported_count: (args.transactions as unknown[]).length });

            case "get_db_status":
              return Promise.resolve({ db_path: "mock.db", wal_mode: true, schema_version: 9, migrations_applied: 9 });

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
    { categories: MOCK_CATEGORIES, duplicateIndices }
  );
}

async function triggerUpload(page: Page) {
  await page.getByTestId("upload-zone").click();
  await page.waitForSelector('[data-testid="import-review-screen"]', { timeout: 5000 });
}

test.describe("Import Duplicate Detection", () => {
  test("duplicate transactions show badge in auto-categorized section", async ({ page }) => {
    // Index 0 (Costco) is a duplicate
    await setupTauriMock(page, [0]);
    await page.goto("/import");
    await triggerUpload(page);

    // Expand auto-categorized section
    await page.getByTestId("auto-categorized-toggle").click();
    await expect(page.getByTestId("auto-categorized-list")).toBeVisible();

    // First row should have duplicate badge
    const rows = page.getByTestId("auto-categorized-row");
    await expect(rows.first().getByTestId("duplicate-badge")).toBeVisible();
    await expect(rows.first().getByTestId("duplicate-badge")).toContainText("Possible duplicate");
  });

  test("non-duplicate transactions do not show badge", async ({ page }) => {
    // Only index 0 is duplicate, index 1 (Uber Eats) is not
    await setupTauriMock(page, [0]);
    await page.goto("/import");
    await triggerUpload(page);

    // Expand auto-categorized section
    await page.getByTestId("auto-categorized-toggle").click();

    const rows = page.getByTestId("auto-categorized-row");
    // Second auto row (Uber Eats, index 1) should NOT have badge
    await expect(rows.nth(1).getByTestId("duplicate-badge")).not.toBeVisible();
  });

  test("duplicate flagged transaction shows warning in review card", async ({ page }) => {
    // Index 2 (Starbucks, confidence 0.6) is flagged AND duplicate
    await setupTauriMock(page, [2]);
    await page.goto("/import");
    await triggerUpload(page);

    const card = page.getByTestId("transaction-review-card");
    await expect(card.getByTestId("duplicate-badge")).toBeVisible();
    await expect(card.getByTestId("duplicate-badge")).toContainText("Possible duplicate");
  });

  test("duplicate transactions are still selectable and importable", async ({ page }) => {
    await setupTauriMock(page, [0]);
    await page.goto("/import");
    await triggerUpload(page);

    // Expand auto-categorized and verify checkbox is still checked
    await page.getByTestId("auto-categorized-toggle").click();
    const firstCheckbox = page.getByTestId("auto-transaction-checkbox").first();
    await expect(firstCheckbox).toBeChecked();
  });

  test("no duplicates means no badges shown", async ({ page }) => {
    await setupTauriMock(page, []);
    await page.goto("/import");
    await triggerUpload(page);

    // Expand auto-categorized
    await page.getByTestId("auto-categorized-toggle").click();
    await expect(page.getByTestId("duplicate-badge")).not.toBeVisible();
  });
});
