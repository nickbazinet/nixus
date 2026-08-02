import { test, expect, type Page } from "@playwright/test";

const AGENT_NAME = "Budget Helper";
const AGENT_PATH = "/ai/budget-helper";

type MockWindow = Record<string, unknown>;

function mockApi(page: Page) {
  return {
    setResponse: (type: string) =>
      page.evaluate(
        (t) =>
          ((window as unknown as MockWindow).__MOCK_SET_RESPONSE__ as (v: string) => void)(t),
        type
      ),
    emitChunk: (chunk: string, done = false) =>
      page.evaluate(
        ([c, d]) =>
          (
            (window as unknown as MockWindow).__MOCK_EMIT_CHUNK__ as (
              a: string,
              b: boolean
            ) => void
          )(c as string, d as boolean),
        [chunk, done] as const
      ),
    executedActions: () =>
      page.evaluate(
        () => (window as unknown as MockWindow).__MOCK_EXECUTED_ACTIONS__ as string[]
      ),
  };
}

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

    let nextResponseType: "query" | "action" | "approximate" | "manual" = "query";
    const w = window as unknown as Record<string, unknown>;
    w.__MOCK_SET_RESPONSE__ = (type: string) => {
      nextResponseType = type as typeof nextResponseType;
    };
    // "manual" lets a test drive the stream chunk by chunk, so the sentence-boundary
    // announcer can be observed at an exact buffer state instead of racing a timer.
    w.__MOCK_EMIT_CHUNK__ = (chunk: string, done: boolean) =>
      emitEvent("chat:response-chunk", { chunk, done });
    const executedActions: string[] = [];
    w.__MOCK_EXECUTED_ACTIONS__ = executedActions;

    w.__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "plugin:event|listen") {
          const event = args.event as string;
          const handlerId = args.handler as number;
          if (!eventListeners[event]) eventListeners[event] = [];
          const cb = callbacks[handlerId];
          if (cb) eventListeners[event].push(cb);
          return Promise.resolve(handlerId);
        }
        // Every other plugin command resolves null on purpose: a truthy updater check makes
        // UpdateChecker render an always-open dialog that aria-hides the entire app.
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);

        switch (cmd) {
          case "send_chat_message": {
            if (nextResponseType === "manual") {
              return Promise.resolve({ conversation_id: 1, user_message_id: 1 });
            }

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
            } else if (nextResponseType === "approximate") {
              response = "Rent runs ~$430 and groceries ~$260 a month.";
            } else {
              // Money is plain text, never backticked: a figure must not land in a <code> run.
              response = "You spent $125.50 on dining out this month across 5 transactions.";
            }

            setTimeout(() => {
              emitEvent("chat:response-chunk", { chunk: response, done: false });
            }, 50);
            setTimeout(() => {
              emitEvent("chat:response-chunk", { chunk: "", done: true });
            }, 100);

            return Promise.resolve({ conversation_id: 1, user_message_id: 1 });
          }

          case "execute_chat_action":
            executedActions.push(args.action_type as string);
            return Promise.resolve({ success: true, message: "Done. $45.00 expense added for Costco." });

          case "list_conversations":
            return Promise.resolve([]);

          case "get_chat_messages":
            return Promise.resolve([]);

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

    // Must really detach: StrictMode mounts useChat's listener twice, and a no-op unregister
    // leaves the first one attached, so every streamed chunk lands in the buffer twice.
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (event: string, eventId: number) => {
        const cb = callbacks[eventId];
        const listeners = eventListeners[event];
        if (!cb || !listeners) return;
        const index = listeners.indexOf(cb);
        if (index !== -1) listeners.splice(index, 1);
      },
    };
  });
}

// === Story 7.1 Tests ===

test.describe("AI Chat Page — Story 7.1", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/chat");
  });

  test("legacy /chat resolves to the agent chat surface", async ({ page }) => {
    await expect(page).toHaveURL(AGENT_PATH);
  });

  test("chat page renders with message input area at the bottom [AC1]", async ({ page }) => {
    // The chat surface is titled by its agent and carries the same surface-heading contract
    // every other route gets, since the shell's skip link and route-change focus target it.
    const heading = page.getByRole("heading", { level: 1, name: AGENT_NAME, exact: true });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveAttribute("data-surface-heading", "");

    await expect(page.getByTestId("chat-input-area")).toBeVisible();
    await expect(page.getByTestId("chat-input")).toBeVisible();
    await expect(page.getByTestId("chat-send-button")).toBeVisible();
  });

  test("the agent name is a heading and a nav link, never two of the same role [AC1]", async ({
    page,
  }) => {
    await expect(page.getByRole("heading", { name: AGENT_NAME, exact: true })).toHaveCount(1);
    await expect(page.getByRole("link", { name: AGENT_NAME, exact: true })).toHaveCount(1);
  });

  test("message container is role=log and is not itself a live region [AC2]", async ({ page }) => {
    const messageArea = page.getByTestId("chat-message-area");
    await expect(messageArea).toHaveAttribute("role", "log");
    // Deliberately not aria-live: bound to a token stream it would announce every DOM
    // mutation. Announcement is published per sentence by chat-live-region instead.
    await expect(messageArea).not.toHaveAttribute("aria-live", /.*/);
  });

  test("streamed answers are announced per sentence, never per token [AC2, AC4]", async ({
    page,
  }) => {
    const mock = mockApi(page);
    await mock.setResponse("manual");

    await page.getByTestId("chat-input").fill("How am I tracking this month?");
    await page.getByTestId("chat-input").press("Enter");

    const bubble = page.getByTestId("chat-message-assistant");
    const live = page.getByTestId("chat-live-region");
    await expect(bubble).toBeVisible();
    await expect(live).toHaveAttribute("aria-live", "polite");

    await mock.emitChunk("You spent ");
    await mock.emitChunk("$125.50 on dining");

    // Mid-sentence: on screen already, but nothing handed to assistive tech yet. The decimal
    // point in $125.50 must not read as a sentence end.
    await expect(bubble).toContainText("$125.50 on dining");
    await expect(live).toHaveText("");

    await mock.emitChunk(" out this month.");
    await expect(live).toHaveText("You spent $125.50 on dining out this month.");

    await mock.emitChunk(" Groceries led");
    await expect(live).toHaveText("You spent $125.50 on dining out this month.");

    await mock.emitChunk(" at $58.20.");
    await mock.emitChunk("", true);
    await expect(live).toHaveText("Groceries led at $58.20.");
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
    const alignment = await page
      .getByTestId("chat-message-user")
      .evaluate((el) => getComputedStyle(el).justifyContent);
    expect(alignment).toBe("flex-end");
  });

  test("AI messages appear left-aligned with streamed content [AC2, AC4]", async ({ page }) => {
    await page.getByTestId("chat-input").fill("How much did I spend?");
    await page.getByTestId("chat-input").press("Enter");
    const aiMsg = page.getByTestId("chat-message-assistant");
    await expect(aiMsg).toBeVisible({ timeout: 5000 });
    await expect(aiMsg).toContainText("$125.50", { timeout: 5000 });

    const alignment = await aiMsg.evaluate((el) => getComputedStyle(el).justifyContent);
    expect(alignment).toBe("flex-start");
  });

  test("money in an answer is tabular Inter, never monospace [AC4]", async ({ page }) => {
    await page.getByTestId("chat-input").fill("How much did I spend?");
    await page.getByTestId("chat-input").press("Enter");

    const aiMsg = page.getByTestId("chat-message-assistant");
    await expect(aiMsg).toContainText("$125.50", { timeout: 5000 });

    const figure = await aiMsg.evaluate((root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node !== null) {
        if (node.textContent?.includes("$125.50") && node.parentElement) {
          const style = getComputedStyle(node.parentElement);
          const chain: string[] = [];
          let el: Element | null = node.parentElement;
          while (el !== null && el !== root.parentElement) {
            chain.push(
              `${el.tagName}.${el.className}=${getComputedStyle(el).fontVariantNumeric}`
            );
            el = el.parentElement;
          }
          return {
            tag: node.parentElement.tagName,
            variant: style.fontVariantNumeric,
            family: style.fontFamily.toLowerCase(),
            chain,
          };
        }
        node = walker.nextNode();
      }
      return null;
    });
    console.log("MONEY_CHAIN", JSON.stringify(figure, null, 2));

    expect(figure).not.toBeNull();
    expect(figure?.tag).toBe("P");
    expect(figure?.variant).toBe("tabular-nums");
    expect(figure?.family).not.toContain("mono");
  });

  test("approximate figures are not struck through [AC4]", async ({ page }) => {
    const mock = mockApi(page);
    await mock.setResponse("approximate");

    await page.getByTestId("chat-input").fill("Roughly what are my fixed costs?");
    await page.getByTestId("chat-input").press("Enter");

    const aiMsg = page.getByTestId("chat-message-assistant");
    await expect(aiMsg).toContainText("~$430", { timeout: 5000 });
    await expect(aiMsg).toContainText("~$260");

    // remark-gfm's singleTilde default turns a pair of "approximately" tildes into
    // strikethrough, so the assistant looks like it is crossing out dollar amounts.
    const struck = await aiMsg.evaluate((root) =>
      [...root.querySelectorAll("*")].some(
        (el) =>
          el.tagName === "DEL" ||
          el.tagName === "S" ||
          getComputedStyle(el).textDecorationLine.includes("line-through")
      )
    );
    expect(struck).toBe(false);
  });
});

// === Story 7.2 Tests ===

test.describe("AI Chat Page — Story 7.2", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/chat");
    await mockApi(page).setResponse("action");
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

  test("a write waits for approval and is never issued unprompted [AC1, AC3]", async ({ page }) => {
    const mock = mockApi(page);

    await page.getByTestId("chat-input").fill("Add $45 expense at Costco under Groceries");
    await page.getByTestId("chat-input").press("Enter");

    const card = page.getByTestId("action-confirmation-card");
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card).toContainText("won't add anything until you say so");
    expect(await mock.executedActions()).toEqual([]);

    await page.getByTestId("action-confirm-button").click();
    await expect(page.getByTestId("chat-message-assistant").last()).toContainText(
      "expense added for Costco"
    );
    expect(await mock.executedActions()).toEqual(["create_expense"]);
  });

  test("clicking Cancel shows 'Action cancelled' message [AC5]", async ({ page }) => {
    const mock = mockApi(page);

    await page.getByTestId("chat-input").fill("Add expense");
    await page.getByTestId("chat-input").press("Enter");

    await expect(page.getByTestId("action-cancel-button")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("action-cancel-button").click();

    const messages = page.getByTestId("chat-message-assistant");
    await expect(messages.last()).toContainText("Action cancelled");
    expect(await mock.executedActions()).toEqual([]);
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

  test("the bar is the one floating layer, so it carries the float shadow [AC1]", async ({
    page,
  }) => {
    await page.keyboard.press("Meta+k");
    const bar = page.getByTestId("floating-chat-bar");
    await expect(bar).toBeVisible();

    const shadow = await bar.evaluate((el) => {
      const probe = document.createElement("div");
      probe.style.boxShadow = "var(--shadow-float)";
      el.appendChild(probe);
      const token = getComputedStyle(probe).boxShadow;
      probe.remove();
      // Tailwind composes box-shadow from five slots (inset, ring, offset, shadow); the unused
      // ones resolve to fully transparent entries, so compare only the ones that actually paint.
      const painted = (getComputedStyle(el).boxShadow.match(/(rgba?\([^)]*\)[^,]*)/g) ?? [])
        .map((part) => part.trim())
        .filter((part) => !part.startsWith("rgba(0, 0, 0, 0)"));
      return { painted, token };
    });

    expect(shadow.token).not.toBe("none");
    expect(shadow.painted).toEqual([shadow.token]);
  });

  test("no text in the bar drops below the 12px floor [AC1]", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    const bar = page.getByTestId("floating-chat-bar");
    await expect(bar).toBeVisible();

    const undersized = await bar.evaluate((root) =>
      [root, ...root.querySelectorAll("*")]
        .filter((el) => (el.textContent ?? "").trim() !== "")
        .map((el) => Number.parseFloat(getComputedStyle(el).fontSize))
        .filter((size) => size > 0 && size < 12)
    );
    expect(undersized).toEqual([]);
  });

  test("pressing Escape closes the overlay [AC5]", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    await expect(page.getByTestId("floating-chat-bar")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("floating-chat-bar")).not.toBeVisible();
  });

  test("'Open the full chat' is a link and navigates to the agent chat [AC4]", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    const link = page.getByTestId("open-full-chat-link");
    await expect(link).toBeVisible();
    await expect(link).toHaveRole("link");
    await link.click();
    await expect(page).toHaveURL(AGENT_PATH);
    await expect(page.getByTestId("floating-chat-bar")).not.toBeVisible();
  });
});
