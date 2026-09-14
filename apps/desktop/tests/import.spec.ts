import { test, expect, type Locator, type Page } from "@playwright/test";

const MOCK_GROUPS = [
  { id: 1, name: "Essentials", sort_order: 1, created_at: "2026-01-01", is_deleted: false },
  { id: 2, name: "Lifestyle", sort_order: 2, created_at: "2026-01-01", is_deleted: false },
];

// `Streaming` exists in both groups on purpose: the category name alone cannot identify which
// row the AI picked, which is exactly what the parent-group context has to resolve.
const MOCK_CATEGORIES = [
  { id: 1, group_id: 1, name: "Groceries", target_cents: 50000, sort_order: 1, created_at: "2026-01-01" },
  { id: 2, group_id: 1, name: "Dining Out", target_cents: 30000, sort_order: 2, created_at: "2026-01-01" },
  { id: 3, group_id: 2, name: "Shopping", target_cents: 20000, sort_order: 1, created_at: "2026-01-01" },
  { id: 4, group_id: 1, name: "Streaming", target_cents: 1500, sort_order: 3, created_at: "2026-01-01" },
  { id: 5, group_id: 2, name: "Streaming", target_cents: 4000, sort_order: 2, created_at: "2026-01-01" },
];

// Realistic worst case for the closed control: a long category name duplicated across two long
// group names, with enough siblings that the popup has to scroll.
const LONG_GROUPS = [
  { id: 1, name: "Essentials & Fixed Monthly Costs", sort_order: 1, created_at: "2026-01-01", is_deleted: false },
  { id: 2, name: "Lifestyle & Discretionary Spending", sort_order: 2, created_at: "2026-01-01", is_deleted: false },
];

const DUPLICATE_LONG_NAME = "Streaming & Digital Subscriptions";

// `group_id` 99 exists in no group list the UI ever loads, standing in for a category whose group
// the groups query does not return.
const ORPHANED_CATEGORY = {
  id: 7,
  group_id: 99,
  name: "Unfiled Parking Costs",
  target_cents: 6000,
  sort_order: 1,
  created_at: "2026-01-01",
};

const LONG_CATEGORIES = [
  ...[
    "Rent & Property Taxes",
    "Groceries & Household Supplies",
    "Hydro, Gas & Water Utilities",
    "Internet & Mobile Phone Plans",
    "Car Insurance & Registration",
    "Public Transit & Commuting",
    "Prescriptions & Dental Care",
    "Childcare & School Fees",
    "Home & Tenant Insurance",
  ].map((name, i) => ({ id: 11 + i, group_id: 1, name, target_cents: 10000, sort_order: i + 1, created_at: "2026-01-01" })),
  { id: 41, group_id: 1, name: DUPLICATE_LONG_NAME, target_cents: 4000, sort_order: 10, created_at: "2026-01-01" },
  ...[
    "Restaurants & Takeout Delivery",
    "Coffee Shops & Snacks",
    "Clothing & Personal Accessories",
    "Gym Membership & Fitness Classes",
    "Concerts, Movies & Live Events",
    "Books, Games & Hobby Supplies",
    "Travel, Flights & Hotel Stays",
    "Gifts & Charitable Donations",
    "Haircuts & Personal Grooming",
  ].map((name, i) => ({ id: 21 + i, group_id: 2, name, target_cents: 10000, sort_order: i + 1, created_at: "2026-01-01" })),
  { id: 42, group_id: 2, name: DUPLICATE_LONG_NAME, target_cents: 4000, sort_order: 10, created_at: "2026-01-01" },
];

async function setupTauriMock(
  page: Page,
  options?: {
    aiError?: boolean;
    badDates?: boolean;
    proposeCategory?: "existingGroup" | "newGroup";
    /** A typed hosted-AI refusal code, standing in for `AppError::HostedAi`'s discriminator. */
    hostedAiCode?: string;
    /** Delays the code-less `import:error` event until after the typed rejection has landed. */
    hostedEventLast?: boolean;
    /** Two flagged rows for one merchant, so the merchant-wide assign control renders. */
    repeatMerchant?: boolean;
    /** One line the AI could not read, so the manual-entry form renders. */
    unreadable?: boolean;
    /** Swaps in the long-name, scrolling-popup fixture above. */
    longNames?: boolean;
    /** `get_budget_groups` answers null, as an unmocked or still-loading groups query does. */
    groupsUnavailable?: boolean;
    /** Adds a category whose `group_id` matches no group in the list. */
    orphanCategory?: boolean;
  }
) {
  const aiError = options?.aiError ?? false;
  const badDates = options?.badDates ?? false;
  const proposeCategory = options?.proposeCategory ?? null;
  const hostedAiCode = options?.hostedAiCode ?? null;
  const hostedEventLast = options?.hostedEventLast ?? false;
  const repeatMerchant = options?.repeatMerchant ?? false;
  const unreadable = options?.unreadable ?? false;
  const longNames = options?.longNames ?? false;
  const groupsUnavailable = options?.groupsUnavailable ?? false;
  const orphanCategory = options?.orphanCategory ?? false;

  await page.addInitScript(
    ({
      aiError,
      badDates,
      proposeCategory,
      hostedAiCode,
      hostedEventLast,
      repeatMerchant,
      unreadable,
      longNames,
      groupsUnavailable,
      categories,
      groups,
    }) => {
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

              if (hostedAiCode) {
                // The two IPC messages are not ordered by contract, so both orders are exercised.
                // `hostedEventLast` delays the code-less event past the typed rejection: a listener
                // that assigned rather than merged would overwrite the code and silently restore
                // the generic-wording bug these tests cover.
                const emitHostedEvent = () =>
                  emitEvent("import:error", {
                    message: "Hosted AI refused the request.",
                    recoverable: true,
                  });
                if (hostedEventLast) {
                  setTimeout(emitHostedEvent, 150);
                } else {
                  emitHostedEvent();
                }
                return Promise.reject({
                  type: "hosted_ai",
                  code: hostedAiCode,
                  message: "Hosted AI refused the request.",
                  recoverable: true,
                });
              }

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
                  : longNames
                    ? [
                        { merchant: "Netflix Monthly Subscription", amount_cents: 1899, date: "2026-03-10", suggested_category_id: 41, confidence: 0.95 },
                        { merchant: "Spotify Family Plan Renewal", amount_cents: 2099, date: "2026-03-11", suggested_category_id: 41, confidence: 0.6 },
                      ]
                    : repeatMerchant
                    ? [
                        { merchant: "Amazon", amount_cents: 4599, date: "2026-03-10", suggested_category_id: 1, confidence: 0.95 },
                        { merchant: "Uber Eats", amount_cents: 2150, date: "2026-03-11", suggested_category_id: null, confidence: 0.4 },
                        { merchant: "Uber Eats", amount_cents: 1875, date: "2026-03-13", suggested_category_id: null, confidence: 0.4 },
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
                  unreadable: unreadable ? ["03/14 ????? 12.00"] : [],
                });
              }, 300);
              return Promise.resolve(null);
            }

            case "get_all_budget_categories":
              return Promise.resolve(categories);

            case "get_budget_groups":
              return Promise.resolve(groupsUnavailable ? null : groups);

            case "create_budget_group": {
              const newGroup = {
                id: 100,
                name: String(args.name),
                sort_order: 99,
                created_at: "2026-01-01",
                is_deleted: false,
              };
              groups.push(newGroup);
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

            // The account trigger is mounted on every screen, so this read must be answered even where
            // the surface under test has nothing to do with an account (see project-context.md, Testing).
            case "get_user_avatar":
              return Promise.resolve(null);
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
    {
      aiError,
      badDates,
      proposeCategory,
      hostedAiCode,
      hostedEventLast,
      repeatMerchant,
      unreadable,
      longNames,
      groupsUnavailable,
      categories: longNames
        ? LONG_CATEGORIES
        : orphanCategory
          ? [...MOCK_CATEGORIES, ORPHANED_CATEGORY]
          : MOCK_CATEGORIES,
      groups: longNames ? LONG_GROUPS : MOCK_GROUPS,
    }
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

/** Group headings only exist inside the portalled popup, which lives outside the row markup. */
function openSelectPopup(page: Page) {
  return page.locator("[data-slot=select-content]");
}

function optionUnderGroup(page: Page, group: string, option: string) {
  return openSelectPopup(page)
    .getByRole("group", { name: group })
    .getByRole("option", { name: option });
}

async function confirmedTransactions(page: Page) {
  const args = (await page.evaluate(
    () => (window as unknown as Record<string, unknown>).__LAST_CONFIRM_IMPORT_ARGS__
  )) as { transactions: { merchant: string; budget_category_id: number }[] };
  return args.transactions;
}

/** Read through `evaluate` rather than `boundingBox()`: a fully-yielded group caption is zero-width,
 *  which Playwright reports as not visible and returns no box for. `clipped > 0` means the text is
 *  ellipsised at its current width. */
async function valueRowGeometry(trigger: Locator) {
  return trigger.evaluate((el) => {
    const measure = (testId: string) => {
      const node = el.querySelector(`[data-testid=${testId}]`);
      if (node === null) throw new Error(`missing ${testId}`);
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        width: rect.width,
        right: rect.right,
        clipped: node.scrollWidth - node.clientWidth,
        fontSize: parseFloat(style.fontSize),
        color: style.color,
      };
    };
    return {
      triggerRight: el.getBoundingClientRect().right,
      name: measure("category-name"),
      group: measure("category-group-context"),
    };
  });
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

  // Given the four hosted codes whose remedies differ, each paired with the line it must select.
  // Separate tests rather than a loop: `addInitScript` accumulates per page, and one failing code
  // must not hide the other three.
  const HOSTED_REFUSALS = [
    ["quota_exhausted", "You've used all of this month's Nixus Cloud AI requests."],
    ["premium_required", "Nixus Cloud AI isn't enabled on your account."],
    ["unauthorized", "Your sign-in has expired. Please sign in again."],
    [
      "hosted_unavailable",
      "Nixus Cloud AI isn't available right now. Please try again shortly.",
    ],
  ] as const;

  for (const [code, expected] of HOSTED_REFUSALS) {
    test(`a hosted ${code} refusal keeps its own wording rather than the generic unavailable line`, async ({
      page,
    }) => {
      // When statement import fails with that code
      await setupTauriMock(page, { hostedAiCode: code });
      await page.goto("/import");
      await triggerUpload(page);

      // Then its own localized message is what the error screen shows
      const errorState = page.getByTestId("import-error-state");
      await expect(errorState).toBeVisible({ timeout: 5000 });
      await expect(errorState).toContainText(expected);
      await expect(
        page.getByText("Nixus can't read statements right now")
      ).toHaveCount(0);
    });
  }

  test("a hosted refusal never asks a premium user to set up a personal key", async ({
    page,
  }) => {
    // Given hosted AI is out of this month's quota
    await setupTauriMock(page, { hostedAiCode: "quota_exhausted" });
    await page.goto("/import");
    await triggerUpload(page);

    // When the error screen renders
    await expect(page.getByTestId("import-error-state")).toBeVisible({
      timeout: 5000,
    });

    // Then the not-configured setup path is absent — nothing about credentials is wrong here
    await expect(page.getByTestId("open-settings-link")).toHaveCount(0);
    await expect(page.getByTestId("try-again-button")).toBeVisible();
  });

  test("a code-less error event arriving after the typed rejection cannot erase the hosted code", async ({
    page,
  }) => {
    // Given the quota refusal rejects the command first and the code-less event lands afterwards
    await setupTauriMock(page, {
      hostedAiCode: "quota_exhausted",
      hostedEventLast: true,
    });
    await page.goto("/import");
    await triggerUpload(page);

    const errorState = page.getByTestId("import-error-state");
    await expect(errorState).toBeVisible({ timeout: 5000 });

    // When the late event has had time to land
    await page.waitForTimeout(500);

    // Then the quota wording still stands, and the generic line never replaces it
    await expect(errorState).toContainText(
      "You've used all of this month's Nixus Cloud AI requests."
    );
    await expect(
      page.getByText("Nixus can't read statements right now")
    ).toHaveCount(0);
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

// === Category group context ===

test.describe("Import Page — Category Group Context", () => {
  test("a flagged row names the parent group without opening the menu", async ({ page }) => {
    // Given a flagged transaction the AI put in Dining Out, which lives under Essentials
    await setupTauriMock(page);
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    // When the card renders with its menu closed
    const select = page.getByTestId("transaction-review-card").getByTestId("category-select");

    // Then both the category and its parent group are readable, the group in muted text
    await expect(select).toContainText("Dining Out");
    await expect(select).toContainText("Essentials");
    const groupCaption = select.getByTestId("category-group-context");
    await expect(groupCaption).toHaveText("Essentials");
    await expect(groupCaption).toHaveCSS(
      "color",
      await computedColorOfClass(page, "text-ink-dim")
    );
  });

  test("an auto-categorized row names the parent group without opening the menu", async ({
    page,
  }) => {
    // Given the auto-categorized list is expanded
    await setupTauriMock(page);
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("auto-categorized-toggle").click();

    // When its row renders with the menu closed
    const select = page.getByTestId("auto-category-select");

    // Then the Groceries row states Essentials as its group
    await expect(select).toContainText("Groceries");
    await expect(select.getByTestId("category-group-context")).toHaveText("Essentials");
  });

  test("same-named categories sit under their own group heading and keep distinct ids", async ({
    page,
  }) => {
    // Given Streaming exists in both Essentials and Lifestyle
    await setupTauriMock(page);
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    const card = page.getByTestId("transaction-review-card");
    await card.getByTestId("category-select").click();

    // Then each name is listed once under each group
    await expect(optionUnderGroup(page, "Essentials", "Streaming")).toBeVisible();
    await expect(optionUnderGroup(page, "Lifestyle", "Streaming")).toBeVisible();

    // When the Lifestyle one is picked
    await optionUnderGroup(page, "Lifestyle", "Streaming").click();

    // Then the closed control identifies which Streaming was chosen
    await expect(card.getByTestId("category-select")).toContainText("Streaming");
    await expect(card.getByTestId("category-select").getByTestId("category-group-context")).toHaveText(
      "Lifestyle"
    );

    // And the committed row carries that group's category id, not the same-named sibling's
    await page.getByTestId("confirm-import-button").click();
    await expect(page.getByTestId("import-completion")).toBeVisible({ timeout: 5000 });
    const sent = await confirmedTransactions(page);
    expect(sent.find((tx) => tx.merchant === "Uber Eats")?.budget_category_id).toBe(5);
  });

  test("bulk assignment lists categories under their group and applies that exact id", async ({
    page,
  }) => {
    // Given every transaction is selected
    await setupTauriMock(page);
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    // When the Essentials copy of Streaming is applied to all of them
    await page.getByTestId("bulk-category-select").click();
    await expect(optionUnderGroup(page, "Lifestyle", "Streaming")).toBeVisible();
    await optionUnderGroup(page, "Essentials", "Streaming").click();

    // Then the rows show that group, and both commit the Essentials id
    const card = page.getByTestId("transaction-review-card");
    await expect(card.getByTestId("category-select").getByTestId("category-group-context")).toHaveText(
      "Essentials"
    );

    await page.getByTestId("confirm-import-button").click();
    await expect(page.getByTestId("import-completion")).toBeVisible({ timeout: 5000 });
    const sent = await confirmedTransactions(page);
    expect(sent.map((tx) => tx.budget_category_id)).toEqual([4, 4]);
  });

  test("merchant-wide assignment lists categories under their group and applies that exact id", async ({
    page,
  }) => {
    // Given one merchant repeats across two flagged rows
    await setupTauriMock(page, { repeatMerchant: true });
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    const merchantGroup = page.getByTestId("merchant-group");
    await expect(merchantGroup).toBeVisible();

    // When the Lifestyle copy of Streaming is applied to the whole merchant
    await merchantGroup.getByTestId("group-category-select").click();
    await expect(optionUnderGroup(page, "Essentials", "Streaming")).toBeVisible();
    await optionUnderGroup(page, "Lifestyle", "Streaming").click();
    await merchantGroup.getByTestId("group-apply-button").click();

    // Then the merchant control and both rows name Lifestyle
    await expect(
      merchantGroup.getByTestId("group-category-select").getByTestId("category-group-context")
    ).toHaveText("Lifestyle");
    const rowGroupCaptions = merchantGroup
      .getByTestId("category-select")
      .getByTestId("category-group-context");
    await expect(rowGroupCaptions).toHaveText(["Lifestyle", "Lifestyle"]);

    // And both rows commit the Lifestyle id
    await page.getByTestId("confirm-import-button").click();
    await expect(page.getByTestId("import-completion")).toBeVisible({ timeout: 5000 });
    const sent = await confirmedTransactions(page);
    expect(
      sent.filter((tx) => tx.merchant === "Uber Eats").map((tx) => tx.budget_category_id)
    ).toEqual([5, 5]);
  });

  test("the unreadable-line form lists categories under their group heading", async ({
    page,
  }) => {
    // Given a line the AI could not read
    await setupTauriMock(page, { unreadable: true });
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    const form = page.getByTestId("unreadable-line-form");
    await expect(form).toBeVisible();

    // When its category menu is opened and a same-named category is picked
    await form.getByTestId("manual-category-select").click();
    await expect(optionUnderGroup(page, "Lifestyle", "Streaming")).toBeVisible();
    await optionUnderGroup(page, "Essentials", "Streaming").click();

    // Then the closed control names the group it came from
    await expect(
      form.getByTestId("manual-category-select").getByTestId("category-group-context")
    ).toHaveText("Essentials");
  });

  test("keyboard selection still crosses group boundaries and commits the landed id", async ({
    page,
  }) => {
    // Given the flagged row's category control has focus
    await setupTauriMock(page);
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    const card = page.getByTestId("transaction-review-card");
    await card.getByTestId("category-select").focus();

    // When the menu is opened and walked to the last option with the keyboard alone
    await page.keyboard.press("Enter");
    await expect(openSelectPopup(page)).toBeVisible();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");

    // Then it landed on Lifestyle's Streaming — the group wrapper did not trap traversal
    await expect(card.getByTestId("category-select")).toContainText("Streaming");
    await expect(
      card.getByTestId("category-select").getByTestId("category-group-context")
    ).toHaveText("Lifestyle");

    await page.getByTestId("confirm-import-button").click();
    await expect(page.getByTestId("import-completion")).toBeVisible({ timeout: 5000 });
    const sent = await confirmedTransactions(page);
    expect(sent.find((tx) => tx.merchant === "Uber Eats")?.budget_category_id).toBe(5);
  });

  test("every category stays selectable when the groups query returns nothing", async ({
    page,
  }) => {
    // Given the groups query answers null, so no grouping data is available
    await setupTauriMock(page, { groupsUnavailable: true });
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    const card = page.getByTestId("transaction-review-card");
    await card.getByTestId("category-select").click();

    // Then every category is still offered, ungrouped, with no heading invented for them
    await expect(openSelectPopup(page).getByRole("option")).toHaveCount(MOCK_CATEGORIES.length);
    await expect(openSelectPopup(page).getByRole("group")).toHaveCount(0);

    // When one is picked
    await openSelectPopup(page).getByRole("option", { name: "Shopping" }).click();

    // Then it commits its own id and import is not blocked
    await expect(card.getByTestId("review-row-status")).toHaveText("Sorted");
    await expect(card.getByTestId("category-group-context")).toHaveCount(0);
    await page.getByTestId("confirm-import-button").click();
    await expect(page.getByTestId("import-completion")).toBeVisible({ timeout: 5000 });
    const sent = await confirmedTransactions(page);
    expect(sent.find((tx) => tx.merchant === "Uber Eats")?.budget_category_id).toBe(3);
  });

  test("a category whose group is missing from the list is still offered and still commits", async ({
    page,
  }) => {
    // Given one category points at a group id the groups query never returns
    await setupTauriMock(page, { orphanCategory: true });
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    const card = page.getByTestId("transaction-review-card");
    await card.getByTestId("category-select").click();

    // Then the known groups still render as headings and the orphan is offered alongside them
    await expect(openSelectPopup(page).getByRole("group")).toHaveCount(MOCK_GROUPS.length);
    await expect(openSelectPopup(page).getByRole("option")).toHaveCount(
      MOCK_CATEGORIES.length + 1
    );

    // When the orphan is picked
    await openSelectPopup(page)
      .getByRole("option", { name: ORPHANED_CATEGORY.name })
      .click();

    // Then it commits its own id and claims no parent group it cannot name
    await expect(card.getByTestId("category-select")).toContainText(ORPHANED_CATEGORY.name);
    await expect(card.getByTestId("category-group-context")).toHaveCount(0);
    await page.getByTestId("confirm-import-button").click();
    await expect(page.getByTestId("import-completion")).toBeVisible({ timeout: 5000 });
    const sent = await confirmedTransactions(page);
    expect(sent.find((tx) => tx.merchant === "Uber Eats")?.budget_category_id).toBe(
      ORPHANED_CATEGORY.id
    );
  });

  test("a flagged row with no category shows the placeholder, no group caption, and stays blocked", async ({
    page,
  }) => {
    // Given a flagged row the AI could not assign a category to
    await setupTauriMock(page, { proposeCategory: "existingGroup" });
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    const card = page.getByTestId("transaction-review-card");

    // Then the placeholder stands in, no stale group caption appears, and confirm stays blocked
    await expect(card.getByTestId("category-select")).toContainText("Select category...");
    await expect(card.getByTestId("category-group-context")).toHaveCount(0);
    await expect(card.getByTestId("review-row-status")).toHaveText("Needs a category");
    await expect(page.getByTestId("confirm-import-button")).toBeDisabled();
    await expect(page.getByText("Give every transaction you're adding a category first.")).toBeVisible();
  });

  test("an unreadable line with no category keeps its placeholder and its required blocking", async ({
    page,
  }) => {
    // Given a line the AI could not read, with nothing entered yet
    await setupTauriMock(page, { unreadable: true });
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    const form = page.getByTestId("unreadable-line-form");
    const select = form.getByTestId("manual-category-select");

    // Then its category control shows the placeholder and carries no group caption
    await expect(select).toContainText("Select category...");
    await expect(select.getByTestId("category-group-context")).toHaveCount(0);

    // When a merchant is entered but the category is left empty
    await form.getByLabel("Merchant").fill("Corner Store");

    // Then confirm is blocked on the unfinished line, exactly as before
    await expect(page.getByTestId("confirm-import-button")).toBeDisabled();
    await expect(
      page.getByText("Finish the lines Nixus couldn't read, or clear them.")
    ).toBeVisible();
  });

  test("a proposal for an existing group names that group", async ({ page }) => {
    // Given the AI proposes a category inside group 1
    await setupTauriMock(page, { proposeCategory: "existingGroup" });
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    // When the proposal renders
    const alert = page.getByTestId("transaction-review-card").getByTestId("propose-category-alert");

    // Then it names both the category and the group it would land in
    await expect(alert).toContainText("Pet Supplies");
    await expect(alert).toContainText("Essentials");
  });

  test("a proposal for a new group names the new group, and creating it keeps that context", async ({
    page,
  }) => {
    // Given the AI proposes a category in a group that does not exist yet
    await setupTauriMock(page, { proposeCategory: "newGroup" });
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    const card = page.getByTestId("transaction-review-card");
    // Then the proposal names the group it would create
    await expect(card.getByTestId("propose-category-alert")).toContainText("Pets");

    // When the proposal is accepted
    await card.getByTestId("create-category-button").click();
    await expect(card.getByTestId("review-row-status")).toHaveText("Sorted");

    // Then the row's closed control shows the created category under its new group
    await expect(card.getByTestId("category-select")).toContainText("Pet Supplies");
    await expect(
      card.getByTestId("category-select").getByTestId("category-group-context")
    ).toHaveText("Pets");
  });

  test("a long duplicate name keeps the category unclipped, yields the group caption first, and phrases the group for assistive tech", async ({
    page,
  }) => {
    // Given a long category name duplicated across two long group names, at the supported minimum width
    await page.setViewportSize({ width: 1024, height: 800 });
    await setupTauriMock(page, { longNames: true });
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    const trigger = page.getByTestId("transaction-review-card").getByTestId("category-select");

    // When the closed control renders under width pressure
    await expect(trigger.getByTestId("category-group-context")).toHaveText(
      "Essentials & Fixed Monthly Costs"
    );
    const geometry = await valueRowGeometry(trigger);

    // Then the category keeps its full text while the muted group caption is the one ellipsised
    expect(geometry.name.clipped).toBeLessThanOrEqual(1);
    expect(geometry.group.clipped).toBeGreaterThan(0);
    expect(geometry.group.width).toBeGreaterThan(20);
    expect(geometry.name.right).toBeLessThanOrEqual(geometry.triggerRight + 1);
    expect(geometry.group.right).toBeLessThanOrEqual(geometry.triggerRight + 1);

    // And the hierarchy is rendered, not merely classed
    expect(geometry.group.fontSize).toBeLessThan(geometry.name.fontSize);
    expect(geometry.group.color).toBe(await computedColorOfClass(page, "text-ink-dim"));

    // And the visual caption is hidden from assistive tech, which gets a phrased line instead
    await expect(trigger.getByTestId("category-group-context")).toHaveAttribute(
      "aria-hidden",
      "true"
    );
    await expect(trigger).toContainText("in Essentials & Fixed Monthly Costs");
  });

  test("a scrolling popup keeps its group heading pinned, and picking the duplicate commits that group's id", async ({
    page,
  }) => {
    // Given the popup has more options than it can show at once
    await page.setViewportSize({ width: 1024, height: 800 });
    await setupTauriMock(page, { longNames: true });
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    const trigger = page.getByTestId("transaction-review-card").getByTestId("category-select");
    await trigger.click();
    const popup = openSelectPopup(page);
    await expect(popup).toBeVisible();
    const overflow = await popup.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow).toBeGreaterThan(0);

    // When the first group is scrolled well past the top of the popup
    const pinned = await popup.evaluate((el) => {
      el.scrollTop = 96;
      const label = el.querySelector("[data-slot=select-group-label]")!;
      const group = el.querySelector("[data-slot=select-group]")!;
      const popupTop = el.getBoundingClientRect().top;
      return {
        scrollTop: el.scrollTop,
        groupAbovePopup: popupTop - group.getBoundingClientRect().top,
        labelOffsetFromTop: label.getBoundingClientRect().top - popupTop,
        labelText: label.textContent,
      };
    });

    // Then its heading is still sitting at the popup's top edge rather than scrolled away with it
    expect(pinned.scrollTop).toBe(96);
    expect(pinned.groupAbovePopup).toBeGreaterThan(40);
    expect(pinned.labelOffsetFromTop).toBeLessThanOrEqual(8);
    expect(pinned.labelText).toBe("Essentials & Fixed Monthly Costs");

    // When the other group's copy of the duplicate name is picked
    await optionUnderGroup(
      page,
      "Lifestyle & Discretionary Spending",
      "Streaming & Digital Subscriptions"
    ).click();

    // Then the closed control names that group, and the commit carries that group's category id
    await expect(trigger.getByTestId("category-group-context")).toHaveText(
      "Lifestyle & Discretionary Spending"
    );
    await page.getByTestId("confirm-import-button").click();
    await expect(page.getByTestId("import-completion")).toBeVisible({ timeout: 5000 });
    const sent = await confirmedTransactions(page);
    expect(
      sent.find((tx) => tx.merchant === "Spotify Family Plan Renewal")?.budget_category_id
    ).toBe(42);
  });

  test("the narrow bulk selector spends its width on the category and applies the exact id", async ({
    page,
  }) => {
    // Given the bulk control and a long duplicate name, at the supported minimum width
    await page.setViewportSize({ width: 1024, height: 800 });
    await setupTauriMock(page, { longNames: true });
    await page.goto("/import");
    await triggerUpload(page);
    await expect(page.getByTestId("import-review-screen")).toBeVisible({ timeout: 5000 });

    const bulk = page.getByTestId("bulk-category-select");
    await bulk.click();
    await optionUnderGroup(
      page,
      "Essentials & Fixed Monthly Costs",
      "Streaming & Digital Subscriptions"
    ).click();

    // When the closed narrow control renders
    await expect(bulk.getByTestId("category-group-context")).toHaveText(
      "Essentials & Fixed Monthly Costs"
    );
    const geometry = await valueRowGeometry(bulk);

    // Then the category holds the primary space, the group caption yields, and neither overflows
    expect(geometry.name.width).toBeGreaterThan(40);
    expect(geometry.group.width).toBeGreaterThan(20);
    expect(geometry.group.clipped).toBeGreaterThan(0);
    expect(geometry.group.width).toBeLessThan(geometry.name.width / 2);
    expect(geometry.name.right).toBeLessThanOrEqual(geometry.triggerRight + 1);
    expect(geometry.group.right).toBeLessThanOrEqual(geometry.triggerRight + 1);
    expect(geometry.group.fontSize).toBeLessThan(geometry.name.fontSize);

    // And both rows commit the picked group's category id
    await page.getByTestId("confirm-import-button").click();
    await expect(page.getByTestId("import-completion")).toBeVisible({ timeout: 5000 });
    const sent = await confirmedTransactions(page);
    expect(sent.map((tx) => tx.budget_category_id)).toEqual([41, 41]);
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
