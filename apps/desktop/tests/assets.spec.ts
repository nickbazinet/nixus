import { test, expect, type Page } from "@playwright/test";

async function setupTauriMock(page: Page) {
  await page.addInitScript(() => {
    interface MockAsset {
      id: number;
      name: string;
      asset_type: string;
      value_cents: number;
      created_at: string;
      updated_at: string;
    }

    const assets: MockAsset[] = [];
    let nextAssetId = 1;

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
              [...assets].sort((a, b) => a.name.localeCompare(b.name))
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

            const asset: MockAsset = {
              id: nextAssetId++,
              name,
              asset_type: assetType,
              value_cents: valueCents,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            assets.push(asset);
            return Promise.resolve(asset);
          }

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
            return Promise.resolve({ ...acc });
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
            return Promise.resolve({ ...assetToUpdate });
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
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("Type").click();
  await page.getByRole("option", { name: typeLabel }).click();
  await form.getByLabel("What it's worth").fill(value);
  await page.getByRole("button", { name: "Save asset" }).click();
  await expect(page.getByTestId("asset-slide-over")).not.toBeVisible();
  await expect(page.getByTestId("asset-row").filter({ hasText: name })).toBeVisible();
}

async function openRowMenu(page: Page) {
  await page.getByTestId("asset-row-menu").click();
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
