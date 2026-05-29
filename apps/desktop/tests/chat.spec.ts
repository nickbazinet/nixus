import { test, expect, type Page } from "@playwright/test";

async function setupTauriMock(page: Page) {
  await page.addInitScript(() => {
    type EventCallback = (event: { event: string; payload: unknown; id: number }) => void;
    const eventListeners: Record<string, EventCallback[]> = {};
    const callbacks: Record<number, EventCallback> = {};
    let nextCallbackId = 1;

    function emitEvent(event: string, payload: unknown) {
      const cbs = eventListeners[event] ?? [];
      for (const cb of cbs) cb({ event, payload, id: Math.random() });
    }

    // Store response type for mock
    let nextResponseType: "query" | "action" = "query";
    (window as unknown as Record<string, unknown>).__MOCK_SET_RESPONSE__ = (type: string) => {
      nextResponseType = type as "query" | "action";
    };

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

        switch (cmd) {
          case "send_chat_message": {
            let response: string;
            if (nextResponseType === "action") {
              response = '```action\n' + JSON.stringify({
                action: true,
                action_type: "create_expense",
                display: {
                  label: "Add Expense",
                  details: [
                    { field: "Merchant", value: "Costco" },
                    { field: "Amount", value: "$45.00" },
                    { field: "Category", value: "Groceries" },
                    { field: "Date", value: "2026-03-15" },
                  ],
                },
                params: { merchant: "Costco", amount_cents: 4500, budget_category_id: 3, date: "2026-03-15" },
              }) + '\n```';
            } else {
              response = "You spent `$125.50` on dining out this month across 5 transactions.";
            }

            // Send response in a single chunk + done
            setTimeout(() => {
              emitEvent("chat:response-chunk", { chunk: response, done: false });
            }, 50);
            setTimeout(() => {
              emitEvent("chat:response-chunk", { chunk: "", done: true });
            }, 100);

            return Promise.resolve({ conversation_id: 1, user_message_id: 1 });
          }

          case "execute_chat_action":
            return Promise.resolve({ success: true, message: "Done. $45.00 expense added for Costco." });

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
  });
}

// === Story 7.1 Tests ===

test.describe("AI Chat Page — Story 7.1", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/chat");
  });

  test("chat page renders with message input area at the bottom [AC1]", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "AI Chat" })).toBeVisible();
    await expect(page.getByTestId("chat-input-area")).toBeVisible();
    await expect(page.getByTestId("chat-input")).toBeVisible();
    await expect(page.getByTestId("chat-send-button")).toBeVisible();
  });

  test("message container has role=log and aria-live=polite [AC2]", async ({ page }) => {
    const messageArea = page.getByTestId("chat-message-area");
    await expect(messageArea).toHaveAttribute("role", "log");
    await expect(messageArea).toHaveAttribute("aria-live", "polite");
  });

  test("typing a message and pressing Enter sends it [AC3]", async ({ page }) => {
    await page.getByTestId("chat-input").fill("How much did I spend on dining out?");
    await page.getByTestId("chat-input").press("Enter");
    await expect(page.getByTestId("chat-message-user")).toBeVisible();
    await expect(page.getByTestId("chat-message-user")).toContainText("How much did I spend on dining out?");
  });

  test("user messages appear right-aligned [AC2]", async ({ page }) => {
    await page.getByTestId("chat-input").fill("Test message");
    await page.getByTestId("chat-input").press("Enter");
    await expect(page.getByTestId("chat-message-user")).toHaveClass(/justify-end/);
  });

  test("AI messages appear left-aligned with streamed content [AC2, AC4]", async ({ page }) => {
    await page.getByTestId("chat-input").fill("How much did I spend?");
    await page.getByTestId("chat-input").press("Enter");
    const aiMsg = page.getByTestId("chat-message-assistant");
    await expect(aiMsg).toBeVisible({ timeout: 5000 });
    await expect(aiMsg).toHaveClass(/justify-start/);
    await expect(aiMsg).toContainText("$125.50", { timeout: 5000 });
  });
});

// === Story 7.2 Tests ===

test.describe("AI Chat Page — Story 7.2", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/chat");
    // Set mock to return action response
    await page.evaluate(() => {
      ((window as unknown as Record<string, unknown>).__MOCK_SET_RESPONSE__ as (t: string) => void)("action");
    });
  });

  test("action confirmation card renders with action details [AC1]", async ({ page }) => {
    await page.getByTestId("chat-input").fill("Add $45 expense at Costco under Groceries");
    await page.getByTestId("chat-input").press("Enter");

    const card = page.getByTestId("action-confirmation-card");
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card).toContainText("Add Expense");
    await expect(card).toContainText("Costco");
    await expect(card).toContainText("$45.00");
    await expect(card).toContainText("Groceries");
  });

  test("confirmation card has Confirm and Cancel buttons [AC2]", async ({ page }) => {
    await page.getByTestId("chat-input").fill("Add expense");
    await page.getByTestId("chat-input").press("Enter");

    await expect(page.getByTestId("action-confirm-button")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("action-cancel-button")).toBeVisible();
  });

  test("clicking Cancel shows 'Action cancelled' message [AC5]", async ({ page }) => {
    await page.getByTestId("chat-input").fill("Add expense");
    await page.getByTestId("chat-input").press("Enter");

    await expect(page.getByTestId("action-cancel-button")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("action-cancel-button").click();

    const messages = page.getByTestId("chat-message-assistant");
    await expect(messages.last()).toContainText("Action cancelled");
  });

  test("after cancel, buttons on the card are disabled [AC5]", async ({ page }) => {
    await page.getByTestId("chat-input").fill("Add expense");
    await page.getByTestId("chat-input").press("Enter");

    await expect(page.getByTestId("action-cancel-button")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("action-cancel-button").click();

    await expect(page.getByTestId("action-confirm-button")).toBeDisabled();
    await expect(page.getByTestId("action-cancel-button")).toBeDisabled();
  });
});

// === Story 7.3 Tests ===

test.describe("Floating Chat Bar — Story 7.3", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/");
  });

  test("pressing Cmd+K opens the floating chat bar overlay [AC1]", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    await expect(page.getByTestId("floating-chat-bar")).toBeVisible();
  });

  test("overlay appears with auto-focused input and ESC badge [AC1]", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    await expect(page.getByTestId("floating-chat-input")).toBeVisible();
    await expect(page.getByTestId("floating-chat-input")).toBeFocused();
    await expect(page.getByTestId("esc-badge")).toBeVisible();
  });

  test("overlay has role=dialog with aria-label [AC2]", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    const bar = page.getByTestId("floating-chat-bar");
    await expect(bar).toHaveAttribute("role", "dialog");
    await expect(bar).toHaveAttribute("aria-label", "Quick chat");
  });

  test("pressing Escape closes the overlay [AC5]", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    await expect(page.getByTestId("floating-chat-bar")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("floating-chat-bar")).not.toBeVisible();
  });

  test("'Open in full chat' link is visible and navigates to Chat page [AC4]", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    const link = page.getByTestId("open-full-chat-link");
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL("/chat");
    await expect(page.getByTestId("floating-chat-bar")).not.toBeVisible();
  });
});
