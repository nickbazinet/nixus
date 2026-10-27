import { test, expect, type Page } from "@playwright/test";

async function setupTauriMock(page: Page) {
  await page.addInitScript(() => {
    interface MockHolding {
      passive_asset_id: number;
      symbol: string;
      exchange: string;
      currency: string | null;
      quantity_micros: number;
      last_price_cents: number | null;
      last_price_at: string | null;
      fx_rate_to_base_micros: number | null;
      created_at: string;
      updated_at: string;
    }

    interface MockAsset {
      id: number;
      name: string;
      asset_type: string;
      value_cents: number;
      created_at: string;
      updated_at: string;
      stock: MockHolding | null;
    }

    const assets: MockAsset[] = [];
    let nextAssetId = 1;

    // The fixture Yahoo: SHOP.TO prices in CAD, OFFLN.TO never prices, so the offline and
    // partial-failure rows of the matrix are both reachable from the UI.
    // VOO quotes in USD and converts at 1.4 CAD, so the row's price and its CAD value differ.
    const PRICES: Record<string, number> = { "SHOP.TO": 12345, "BNS.TO": 7000, VOO: 70720 };
    const QUOTE_FX: Record<string, { currency: string; fxMicros: number }> = {
      VOO: { currency: "USD", fxMicros: 1400000 },
    };

    // Real IPC SERIALIZES every response, so the frontend can never hold a reference into the
    // backend's own store. Handing out the live objects instead lets an in-place mutation reach
    // React's already-rendered data, which TanStack then structurally shares as "unchanged" —
    // a staleness bug that exists only in a mock that forgets to copy.
    const snapshot = (asset: MockAsset): MockAsset => ({
      ...asset,
      stock: asset.stock ? { ...asset.stock } : null,
    });

    const reprice = (asset: MockAsset): boolean => {
      const holding = asset.stock;
      if (!holding) return false;
      const price = PRICES[holding.symbol];
      if (price === undefined) return false;
      const quote = QUOTE_FX[holding.symbol] ?? { currency: "CAD", fxMicros: 1000000 };
      holding.last_price_cents = price;
      holding.currency = quote.currency;
      holding.fx_rate_to_base_micros = quote.fxMicros;
      holding.last_price_at = new Date()
        .toISOString()
        .replace("T", " ")
        .slice(0, 19);
      asset.value_cents = Math.round(
        (holding.quantity_micros * price * quote.fxMicros) / 1000000 / 1000000
      );
      return true;
    };

    // unlisten() reaches into the event plugin's own internals object on cleanup.
    (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ =
      { unregisterListener: () => {} };

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      // Real Tauri exposes this; event.listen() calls it, and without it every listener throws.
      transformCallback: (cb: unknown) => {
        const id = Math.floor(Math.random() * 1e9);
        (window as unknown as Record<string, unknown>)[`_${id}`] = cb;
        return id;
      },
      invoke: (cmd: string, args: Record<string, unknown>) => {
        // A truthy updater answer opens an always-modal dialog that aria-hidden()s the whole app.
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);
        switch (cmd) {
          case "check_picker_gate":
            return Promise.resolve({ needs_picker: false });

          case "get_assets":
            return Promise.resolve(
              [...assets]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(snapshot)
            );

          case "create_asset": {
            const name = (args.name as string)?.trim();
            const assetType = args.asset_type as string;
            const valueCents = args.value_cents as number;

            if (!name) {
              return Promise.reject({
                type: "validation",
                message: "Asset name is required",
                field: "name",
              });
            }

            if (assetType === "stock") {
              return Promise.reject({
                type: "validation",
                message:
                  "A stock asset is managed through its holding, not this field",
                field: "asset_type",
              });
            }

            const asset: MockAsset = {
              id: nextAssetId++,
              name,
              asset_type: assetType,
              value_cents: valueCents,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              stock: null,
            };
            assets.push(asset);
            return Promise.resolve(snapshot(asset));
          }

          case "search_stocks": {
            const query = ((args.query as string) ?? "").trim();
            if (query.length < 2) return Promise.resolve([]);
            return Promise.resolve(
              [
                { symbol: "SHOP.TO", name: "Shopify Inc.", exchange: "Toronto" },
                { symbol: "BNS.TO", name: "Bank of Nova Scotia", exchange: "Toronto" },
                { symbol: "OFFLN.TO", name: "Offline Holdings", exchange: "Toronto" },
                { symbol: "RY.TO", name: "Royal Bank of Canada", exchange: "Toronto" },
                { symbol: "ENB.TO", name: "Enbridge Inc.", exchange: "Toronto" },
                { symbol: "CNR.TO", name: "Canadian National Railway", exchange: "Toronto" },
                { symbol: "VOO", name: "Vanguard S&P 500 ETF", exchange: "NYSEArca" },
              ].filter(
                (hit) =>
                  hit.symbol.toLowerCase().includes(query.toLowerCase()) ||
                  hit.name.toLowerCase().includes(query.toLowerCase())
              )
            );
          }

          case "create_stock_asset": {
            const now = new Date().toISOString().replace("T", " ").slice(0, 19);
            const symbol = args.symbol as string;
            const quantityMicros = args.quantity_micros as number;
            if (!symbol) {
              return Promise.reject({
                type: "validation",
                message: "A stock symbol is required",
                field: "symbol",
              });
            }
            if (quantityMicros <= 0) {
              return Promise.reject({
                type: "validation",
                message: "Quantity must be greater than zero",
                field: "quantity_micros",
              });
            }

            const id = nextAssetId++;
            const asset: MockAsset = {
              id,
              name: (args.name as string) || symbol,
              asset_type: "stock",
              value_cents: 0,
              created_at: now,
              updated_at: now,
              stock: {
                passive_asset_id: id,
                symbol,
                exchange: args.exchange as string,
                currency: null,
                quantity_micros: quantityMicros,
                last_price_cents: null,
                last_price_at: null,
                fx_rate_to_base_micros: null,
                created_at: now,
                updated_at: now,
              },
            };
            assets.push(asset);
            reprice(asset);
            return Promise.resolve(snapshot(asset));
          }

          case "update_stock_quantity": {
            const target = assets.find((a) => a.id === (args.id as number));
            if (!target?.stock)
              return Promise.reject({
                type: "validation",
                message: "This asset is not a stock holding",
                field: "id",
              });
            target.stock.quantity_micros = args.quantity_micros as number;
            const price = target.stock.last_price_cents;
            target.value_cents =
              price === null
                ? 0
                : Math.round((target.stock.quantity_micros * price) / 1000000);
            return Promise.resolve(snapshot(target));
          }

          case "refresh_stock_prices":
            return Promise.resolve(
              assets.flatMap((asset) =>
                asset.stock
                  ? [
                      {
                        asset_id: asset.id,
                        symbol: asset.stock.symbol,
                        ok: reprice(asset),
                      },
                    ]
                  : []
              )
            );

          case "update_asset_value": {
            const valId = args.id as number;
            const newValue = args.value_cents as number;
            const acc = assets.find((a) => a.id === valId);
            if (!acc)
              return Promise.reject({
                type: "database",
                message: "Asset not found",
              });
            acc.value_cents = newValue;
            acc.updated_at = new Date().toISOString();
            return Promise.resolve(snapshot(acc));
          }

          case "update_asset": {
            const updId = args.id as number;
            const updName = (args.name as string)?.trim();
            const updType = args.asset_type as string;

            if (!updName)
              return Promise.reject({
                type: "validation",
                message: "Asset name is required",
                field: "name",
              });

            const assetToUpdate = assets.find((a) => a.id === updId);
            if (!assetToUpdate)
              return Promise.reject({
                type: "database",
                message: "Asset not found",
              });

            assetToUpdate.name = updName;
            assetToUpdate.asset_type = updType;
            assetToUpdate.updated_at = new Date().toISOString();
            return Promise.resolve(snapshot(assetToUpdate));
          }

          case "delete_asset": {
            const delId = args.id as number;
            const idx = assets.findIndex((a) => a.id === delId);
            if (idx === -1)
              return Promise.reject({
                type: "database",
                message: "Asset not found",
              });
            assets.splice(idx, 1);
            return Promise.resolve(null);
          }

          case "get_db_status":
            return Promise.resolve({
              db_path: "mock.db",
              wal_mode: true,
              schema_version: 7,
              migrations_applied: 7,
            });

          case "get_current_net_worth":
            return Promise.resolve({
              total_cents: 50000000,
              cash_cents: 500000,
              investments_cents: 0,
              assets_cents: 46500000,
            });

          // The sync status indicator is mounted in the app shell on every screen, so this read
          // must be answered even where the surface under test has nothing to do with sync (see
          // project-context.md, Testing). `unlinked` renders no indicator, so no surface changes.
          case "sync_status":
            return Promise.resolve({
              state: "unlinked",
              dataset_id: "default",
              enabled: false,
              paused: false,
              last_sync_ms: null,
              error_code: null,
              recoverable: true,
              prompt: null,
            });
          // The account trigger is mounted on every screen, so this read must be answered even where
          // the surface under test has nothing to do with an account (see project-context.md, Testing).
          case "get_user_avatar":
            return Promise.resolve(null);
          default:
            return Promise.reject(`Unknown command: ${cmd}`);
        }
      },
      convertFileSrc: (path: string) => path,
    };
  });
}

async function createAsset(
  page: Page,
  name: string,
  typeLabel = "Real estate",
  value = "450000"
) {
  await page.getByTestId("add-asset-button").click();
  const form = page.getByTestId("add-asset-form");
  await form.getByLabel("Type").click();
  await page.getByRole("option", { name: typeLabel, exact: true }).click();
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("What it's worth").fill(value);
  await page.getByRole("button", { name: "Save asset" }).click();
  await expect(page.getByTestId("asset-slide-over")).not.toBeVisible();
  await expect(page.getByTestId("asset-row").filter({ hasText: name })).toBeVisible();
}

async function openRowMenu(page: Page) {
  await page.getByTestId("asset-row-menu").click();
}

async function createStockAsset(page: Page, symbol: string, quantity: string) {
  await page.getByTestId("add-asset-button").click();
  const form = page.getByTestId("add-asset-form");
  await form.getByLabel("Type").click();
  await page.getByRole("option", { name: "Stock", exact: true }).click();

  await page.getByTestId("stock-symbol-trigger").click();
  await page.getByTestId("stock-symbol-search").fill(symbol);
  await page
    .getByTestId("stock-symbol-option")
    .filter({ hasText: symbol })
    .first()
    .click();
  await expect(page.getByTestId("stock-symbol-trigger")).toContainText(symbol);

  await form.getByLabel("How many shares").fill(quantity);
  await page.getByRole("button", { name: "Save asset" }).click();
  await expect(page.getByTestId("asset-slide-over")).not.toBeVisible();
}

test.describe("Assets Page", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/wealth/assets");
  });

  test("displays page header with Add Asset button", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Assets" })
    ).toBeVisible();
    await expect(page.getByTestId("add-asset-button")).toBeVisible();
    await expect(page.getByTestId("add-asset-button")).toContainText(
      "Add an asset"
    );
    await expect(page.getByTestId("view-net-worth-button")).toBeVisible();
  });

  test("shows empty state when no assets exist", async ({ page }) => {
    const emptyState = page.getByTestId("assets-empty-state");
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText("Nothing here yet");
    await expect(emptyState).toContainText(
      "Add a home, a car, or a business stake to see it in your net worth."
    );
    await expect(
      emptyState.getByRole("button", { name: /Add an asset/ })
    ).toBeVisible();
    // An empty state carries one action; the former View-net-worth peer is gone by design, because
    // two competing choices is a decision the user has no data to make yet.
    await expect(emptyState.getByRole("button")).toHaveCount(1);
  });

  test("adding an asset shows it in the list with formatted value", async ({
    page,
  }) => {
    await createAsset(page, "Family Home", "Real estate", "450000");

    await expect(page.getByTestId("assets-total")).toContainText("$450,000.00");
    await expect(page.getByTestId("assets-net-worth-context")).toBeVisible();

    const row = page.getByTestId("asset-row");
    await expect(row).toBeVisible();
    await expect(row).toContainText("Family Home");
    await expect(row).toContainText("Real estate");
    await expect(page.getByTestId("asset-value")).toContainText("$450,000.00");
    await expect(page.getByTestId("asset-type-group")).toBeVisible();
  });

  test("multiple assets show breakdown bar and type groups", async ({
    page,
  }) => {
    await createAsset(page, "Family Home", "Real estate", "450000");
    await createAsset(page, "Old Car", "Vehicle", "15000");

    await expect(page.getByTestId("assets-total")).toContainText("$465,000.00");
    await expect(page.getByTestId("assets-breakdown")).toBeVisible();
    await expect(page.getByTestId("breakdown-bar")).toBeVisible();
    await expect(page.getByTestId("asset-type-group")).toHaveCount(2);
  });

  test("the value is a focusable control that Enter opens for editing", async ({
    page,
  }) => {
    await createAsset(page, "Family Home", "Real estate", "450000");

    const value = page.getByTestId("asset-value");
    // The dotted underline is the required resting affordance, and the value is a real control: a
    // keyboard-only user never hovers, so Enter has to do what the click does.
    await expect(value).toHaveCSS("border-bottom-style", "dotted");
    await expect(value).toHaveAttribute("role", "button");
    await value.focus();
    await value.press("Enter");
    await expect(page.getByTestId("asset-value-input")).toBeVisible();
  });

  test("the value affordance is never explained in helper text", async ({
    page,
  }) => {
    await createAsset(page, "Family Home", "Real estate", "450000");

    // A hover-only hint is invisible to a keyboard user, so the affordance carries itself.
    await expect(
      page.getByTestId("asset-row").getByText(/click to update/i)
    ).toHaveCount(0);
  });

  test("clicking asset value makes it inline-editable; Enter saves", async ({
    page,
  }) => {
    await createAsset(page, "Family Home", "Real estate", "450000");

    await page.getByTestId("asset-value").click();
    await expect(page.getByTestId("asset-value-input")).toBeVisible();

    const input = page.getByTestId("asset-value-input").locator("input");
    // Select all existing text and replace with new value
    await input.click({ clickCount: 3 });
    await input.pressSequentially("475000");
    await input.press("Enter");

    await expect(page.getByText("Change saved").last()).toBeVisible();
    await expect(page.getByTestId("asset-value")).toContainText("$475,000.00");
  });

  test("pressing Escape cancels value edit without saving", async ({
    page,
  }) => {
    await createAsset(page, "Family Home", "Real estate", "450000");

    await page.getByTestId("asset-value").click();
    const input = page.getByTestId("asset-value-input").locator("input");
    await input.fill("999999");
    await input.press("Escape");

    await expect(page.getByTestId("asset-value")).toContainText("$450,000.00");
  });

  test("row actions live in an always-visible overflow menu, not a hover reveal", async ({
    page,
  }) => {
    await createAsset(page, "Old Car", "Vehicle", "15000");

    const row = page.getByTestId("asset-row");
    const rowMenu = page.getByTestId("asset-row-menu");
    // Hover-only affordances with no resting state are banned, so the trigger is visible before any
    // pointer or keyboard interaction.
    await expect(rowMenu).toBeVisible();

    // A destructive action is never a peer of an ordinary one in the same row.
    await expect(row.getByTestId("delete-asset-button")).toHaveCount(0);

    await rowMenu.click();
    await expect(page.getByTestId("edit-asset-button")).toBeVisible();
    await expect(page.getByTestId("delete-asset-button")).toBeVisible();
  });

  test("deleting an asset shows confirmation dialog and removes it", async ({
    page,
  }) => {
    await createAsset(page, "Old Car", "Vehicle", "15000");

    await openRowMenu(page);
    await page.getByTestId("delete-asset-button").click();

    await expect(page.getByTestId("delete-asset-dialog")).toBeVisible();
    await expect(
      page.getByText("Are you sure you want to delete Old Car?")
    ).toBeVisible();

    await page.getByTestId("confirm-delete-asset-button").click();
    await expect(page.getByText("Successfully deleted")).toBeVisible();
    await expect(page.getByTestId("assets-empty-state")).toBeVisible();
  });

  test("success toasts appear for add and value edit operations", async ({
    page,
  }) => {
    await createAsset(page, "Business", "Business", "100000");
    await expect(page.getByText("Changes saved successfully").last()).toBeVisible();

    // Edit value
    await page.getByTestId("asset-value").click();
    const input = page.getByTestId("asset-value-input").locator("input");
    await input.click({ clickCount: 3 });
    await input.pressSequentially("120000");
    await input.press("Enter");

    await expect(page.getByText("Change saved").last()).toBeVisible();
  });

  test("empty state button opens add asset form", async ({ page }) => {
    const emptyState = page.getByTestId("assets-empty-state");
    await emptyState.getByRole("button", { name: /Add an asset/ }).click();
    await expect(page.getByTestId("add-asset-form")).toBeVisible();
  });

  test("clicking edit opens SlideOver with pre-filled form", async ({
    page,
  }) => {
    await createAsset(page, "Family Home", "Real estate", "450000");

    await openRowMenu(page);
    await page.getByTestId("edit-asset-button").click();

    const slideOver = page.getByTestId("edit-asset-slide-over");
    await expect(slideOver).toBeVisible();

    const editForm = slideOver.getByTestId("edit-asset-form");
    await expect(editForm).toBeVisible();
    await expect(editForm.getByLabel("Name")).toHaveValue("Family Home");
  });

  test("editing asset name via SlideOver saves successfully", async ({
    page,
  }) => {
    await createAsset(page, "Old Car", "Vehicle", "15000");

    await openRowMenu(page);
    await page.getByTestId("edit-asset-button").click();

    const slideOver = page.getByTestId("edit-asset-slide-over");
    const editForm = slideOver.getByTestId("edit-asset-form");
    await editForm.getByLabel("Name").fill("New Car");
    await editForm.getByRole("button", { name: "Save" }).click();

    await expect(
      page.getByText("Changes saved successfully").last()
    ).toBeVisible();
    await expect(page.getByTestId("asset-row")).toContainText("New Car");
  });

  test("closing edit SlideOver does not affect inline value editing", async ({
    page,
  }) => {
    await createAsset(page, "Family Home", "Real estate", "450000");

    // Open then close edit SlideOver
    await openRowMenu(page);
    await page.getByTestId("edit-asset-button").click();
    await expect(page.getByTestId("edit-asset-slide-over")).toBeVisible();
    await page.getByTestId("slide-over-close").click();
    await expect(page.getByTestId("edit-asset-slide-over")).not.toBeVisible();

    // Inline value edit should still work
    await page.getByTestId("asset-value").click();
    await expect(page.getByTestId("asset-value-input")).toBeVisible();
  });
});

test.describe("Stock assets", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/wealth/assets");
  });

  test("the stock branch of the form replaces the value field with a symbol search and a quantity", async ({
    page,
  }) => {
    await page.getByTestId("add-asset-button").click();
    const form = page.getByTestId("add-asset-form");

    // A plain asset is still priced by hand.
    await expect(form.getByLabel("What it's worth")).toBeVisible();
    await expect(page.getByTestId("stock-symbol-trigger")).toHaveCount(0);

    await form.getByLabel("Type").click();
    await page.getByRole("option", { name: "Stock", exact: true }).click();

    await expect(page.getByTestId("stock-symbol-trigger")).toBeVisible();
    await expect(form.getByLabel("How many shares")).toBeVisible();
    // Manual price entry is not offered for a stock: the value is derived.
    await expect(form.getByLabel("What it's worth")).toHaveCount(0);
    await expect(page.getByTestId("stock-value-note")).toBeVisible();
  });

  test("a symbol search needs two characters before it offers anything", async ({
    page,
  }) => {
    await page.getByTestId("add-asset-button").click();
    const form = page.getByTestId("add-asset-form");
    await form.getByLabel("Type").click();
    await page.getByRole("option", { name: "Stock", exact: true }).click();

    await page.getByTestId("stock-symbol-trigger").click();
    await expect(page.getByTestId("stock-symbol-message")).toContainText(
      "Type at least two characters"
    );
    await expect(page.getByTestId("stock-symbol-option")).toHaveCount(0);

    await page.getByTestId("stock-symbol-search").fill("SHOP");
    await expect(
      page.getByTestId("stock-symbol-option").filter({ hasText: "SHOP.TO" })
    ).toBeVisible();
  });

  test("a long result list scrolls instead of stacking its rows on top of each other", async ({
    page,
  }) => {
    await page.getByTestId("add-asset-button").click();
    const form = page.getByTestId("add-asset-form");
    await form.getByLabel("Type").click();
    await page.getByRole("option", { name: "Stock", exact: true }).click();
    await page.getByTestId("stock-symbol-trigger").click();
    await page.getByTestId("stock-symbol-search").fill(".TO");

    const options = page.getByTestId("stock-symbol-option");
    await expect(options).toHaveCount(6);

    const boxes = await options.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          contentHeight: node.scrollHeight,
        };
      })
    );
    for (const box of boxes) {
      expect(box.height).toBeGreaterThanOrEqual(box.contentHeight - 1);
    }
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].top).toBeGreaterThanOrEqual(boxes[i - 1].bottom - 0.5);
    }
  });

  test("saving a stock without a symbol or a quantity reports both", async ({
    page,
  }) => {
    await page.getByTestId("add-asset-button").click();
    const form = page.getByTestId("add-asset-form");
    await form.getByLabel("Type").click();
    await page.getByRole("option", { name: "Stock", exact: true }).click();

    await page.getByRole("button", { name: "Save asset" }).click();

    await expect(page.getByTestId("stock-quantity-error")).toContainText(
      "Enter how many shares you hold"
    );
    await expect(page.getByTestId("asset-slide-over")).toBeVisible();

    await form.getByLabel("How many shares").fill("2.5");
    await page.getByRole("button", { name: "Save asset" }).click();
    await expect(page.getByTestId("stock-symbol-error")).toContainText(
      "Pick a stock first"
    );
  });

  test("adding a stock shows its symbol, shares, price and derived value", async ({
    page,
  }) => {
    await createStockAsset(page, "SHOP.TO", "2.5");

    const row = page.getByTestId("asset-row");
    await expect(row).toContainText("Shopify Inc.");
    await expect(page.getByTestId("stock-row-detail")).toContainText("SHOP.TO");
    await expect(page.getByTestId("stock-row-detail")).toContainText("2.5 shares");
    await expect(page.getByTestId("stock-row-price")).toContainText("$123.45");
    // 2.5 shares x $123.45 = $308.63, derived by the backend and never typed in.
    await expect(page.getByTestId("stock-asset-value")).toContainText("$308.63");
    await expect(page.getByTestId("assets-total")).toContainText("$308.63");
  });

  test("a USD stock names its quote currency so it is not read as CAD", async ({
    page,
  }) => {
    await createStockAsset(page, "VOO", "250");

    // US$707.20 x 250 x 1.4 CAD/USD = $247,520.00: the "US$" is what explains the difference.
    await expect(page.getByTestId("stock-row-price")).toHaveText("US$707.20");
    await expect(page.getByTestId("stock-asset-value")).toContainText("$247,520.00");
  });

  test("a stock quoted in CAD keeps the plain $ of every other amount", async ({ page }) => {
    await createStockAsset(page, "SHOP.TO", "2.5");

    await expect(page.getByTestId("stock-row-price")).toHaveText("$123.45");
  });

  test("a stock's value is not inline-editable, unlike a plain asset's", async ({
    page,
  }) => {
    await createStockAsset(page, "SHOP.TO", "2.5");

    await expect(page.getByTestId("stock-asset-value")).toBeVisible();
    await expect(page.getByTestId("asset-value")).toHaveCount(0);
  });

  test("a stock that never prices shows Price unavailable and a zero value", async ({
    page,
  }) => {
    await createStockAsset(page, "OFFLN.TO", "4");

    await expect(page.getByTestId("asset-stale-badge")).toContainText(
      "Price unavailable"
    );
    await expect(page.getByTestId("stock-asset-value")).toContainText("$0.00");
  });

  test("the edit form locks a stock's type and edits its quantity instead", async ({
    page,
  }) => {
    await createStockAsset(page, "SHOP.TO", "2.5");

    await openRowMenu(page);
    await page.getByTestId("edit-asset-button").click();

    const editForm = page
      .getByTestId("edit-asset-slide-over")
      .getByTestId("edit-asset-form");
    await expect(editForm.getByTestId("edit-asset-type-locked")).toBeDisabled();
    await expect(editForm.getByTestId("edit-asset-type-locked")).toHaveValue(
      "Stock"
    );

    const quantity = editForm.getByLabel("How many shares");
    await expect(quantity).toHaveValue("2.5");
    await quantity.fill("5");
    await editForm.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Changes saved successfully").last()).toBeVisible();
    await expect(page.getByTestId("stock-row-detail")).toContainText("5 shares");
    // 5 x $123.45 = $617.25 — recomputed from the cached price, with no network call.
    await expect(page.getByTestId("stock-asset-value")).toContainText("$617.25");
  });

  test("the Refresh button only appears once a stock exists, and reports a per-symbol failure", async ({
    page,
  }) => {
    await expect(page.getByTestId("refresh-stock-prices-button")).toHaveCount(0);

    await createStockAsset(page, "SHOP.TO", "2.5");
    await expect(page.getByTestId("refresh-stock-prices-button")).toBeVisible();

    await page.getByTestId("refresh-stock-prices-button").click();
    await expect(page.getByText("Prices updated").last()).toBeVisible();

    await createStockAsset(page, "OFFLN.TO", "1");
    await page.getByTestId("refresh-stock-prices-button").click();
    await expect(
      page.getByText(/Could not update OFFLN\.TO/).last()
    ).toBeVisible();
    // The holding that DID price keeps its value on screen. Scoped to its own row, because the
    // list is sorted by name and "Offline Holdings" sorts first.
    await expect(
      page
        .getByTestId("asset-row")
        .filter({ hasText: "SHOP.TO" })
        .getByTestId("stock-asset-value")
    ).toContainText("$308.63");
  });
});

test.describe("Asset form edge cases", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/wealth/assets");
  });

  // The stock branch's quantity and symbol are required, but only WHILE the type is stock. A
  // leftover validation on a hidden field would block the plain-asset path with no visible error.
  test("switching away from Stock still saves a plain asset", async ({
    page,
  }) => {
    await page.getByTestId("add-asset-button").click();
    const form = page.getByTestId("add-asset-form");

    await form.getByLabel("Type").click();
    await page.getByRole("option", { name: "Stock", exact: true }).click();
    await expect(page.getByTestId("stock-symbol-trigger")).toBeVisible();

    // Leave the stock fields entirely untouched and switch back.
    await form.getByLabel("Type").click();
    await page.getByRole("option", { name: "Vehicle", exact: true }).click();
    await expect(page.getByTestId("stock-symbol-trigger")).toHaveCount(0);

    await form.getByLabel("Name").fill("Old Car");
    await form.getByLabel("What it's worth").fill("15000");
    await page.getByRole("button", { name: "Save asset" }).click();

    await expect(page.getByTestId("asset-slide-over")).not.toBeVisible();
    const row = page.getByTestId("asset-row");
    await expect(row).toContainText("Old Car");
    await expect(row).toContainText("Vehicle");
    await expect(page.getByTestId("asset-value")).toContainText("$15,000.00");
  });

  // The popover lives inside the form element, so an unguarded Enter submits a half-filled asset.
  test("Enter in the symbol search does not submit the form", async ({
    page,
  }) => {
    await page.getByTestId("add-asset-button").click();
    const form = page.getByTestId("add-asset-form");
    await form.getByLabel("Type").click();
    await page.getByRole("option", { name: "Stock", exact: true }).click();

    await page.getByTestId("stock-symbol-trigger").click();
    const search = page.getByTestId("stock-symbol-search");
    await search.fill("SHOP");
    await search.press("Enter");

    await expect(page.getByTestId("asset-slide-over")).toBeVisible();
    await expect(page.getByTestId("asset-row")).toHaveCount(0);
  });

  test("a comma decimal separator is accepted as a share count", async ({
    page,
  }) => {
    await page.getByTestId("add-asset-button").click();
    const form = page.getByTestId("add-asset-form");
    await form.getByLabel("Type").click();
    await page.getByRole("option", { name: "Stock", exact: true }).click();

    await page.getByTestId("stock-symbol-trigger").click();
    await page.getByTestId("stock-symbol-search").fill("SHOP.TO");
    await page.getByTestId("stock-symbol-option").first().click();
    await form.getByLabel("How many shares").fill("2,5");
    await page.getByRole("button", { name: "Save asset" }).click();

    await expect(page.getByTestId("asset-slide-over")).not.toBeVisible();
    await expect(page.getByTestId("stock-row-detail")).toContainText("2.5 shares");
    await expect(page.getByTestId("stock-asset-value")).toContainText("$308.63");
  });

  test("a type-only edit moves a plain asset into its new type group", async ({
    page,
  }) => {
    await createAsset(page, "Workshop", "Real estate", "80000");
    await expect(page.getByTestId("asset-row")).toContainText("Real estate");

    await openRowMenu(page);
    await page.getByTestId("edit-asset-button").click();
    const editForm = page
      .getByTestId("edit-asset-slide-over")
      .getByTestId("edit-asset-form");

    await editForm.getByLabel("Type").click();
    await page.getByRole("option", { name: "Business", exact: true }).click();
    await editForm.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Changes saved successfully").last()).toBeVisible();
    await expect(page.getByTestId("asset-row")).toContainText("Business");
    await expect(page.getByTestId("asset-type-group")).toContainText("Business");
  });

  // `stock` is never offered for a hand-valued asset: the backend refuses it either way.
  test("the edit form does not offer Stock as a type for a plain asset", async ({
    page,
  }) => {
    await createAsset(page, "Workshop", "Real estate", "80000");

    await openRowMenu(page);
    await page.getByTestId("edit-asset-button").click();
    const editForm = page
      .getByTestId("edit-asset-slide-over")
      .getByTestId("edit-asset-form");

    await editForm.getByLabel("Type").click();
    await expect(
      page.getByRole("option", { name: "Business", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Stock", exact: true })
    ).toHaveCount(0);
  });

  test("a freshly priced stock shows an As of time and carries no stale badge", async ({
    page,
  }) => {
    await createStockAsset(page, "SHOP.TO", "2.5");

    const row = page.getByTestId("asset-row");
    await expect(row).toContainText(/As of/);
    await expect(page.getByTestId("asset-stale-badge")).toHaveCount(0);
    await expect(row).not.toContainText("Price unavailable");
  });
});
