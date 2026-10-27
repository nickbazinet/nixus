---
title: 'Stock asset with live price'
type: 'feature'
created: '2026-10-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: '4e93fd06b799be1caa722818137219ffa4355abd'
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture-stock-assets.md'
  - '{project-root}/docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Passive assets only hold a manually typed value, so a stock portfolio has to be revalued by hand and net worth drifts out of date.

**Approach:** Add a `stock` asset type backed by a `stock_holdings` row (symbol, quantity, cached price). Search for and price symbols from Rust through a `PriceProvider` trait with one Yahoo implementation. Refresh prices at startup (throttled) and on demand. Always store the derived base-currency value in `passive_assets.value_cents`, so net worth, projections and AI keep reading one number.

## Boundaries & Constraints

**Always:**
- Money is integer minor units (`_cents`). Quantity is a scaled integer (`quantity_micros`, 1e-6 shares) and FX is a scaled integer (`fx_rate_to_base_micros`); no REAL columns.
- `value_cents = round(quantity_micros × last_price_cents × fx / 1e6 / 1e6)` is computed with i128 by ONE pure function, used by create, quantity update and refresh.
- Every write goes through `ActiveDataset::write`, and new db fns carry the `/// CAPTURE-SANCTIONED (AD-3)` doc comment. Mutating commands follow write → `audit_db::record` → `record_net_worth_snapshot`, and snapshot failure is only logged.
- Never hold the `DbState` mutex across an HTTP call: read under the lock, release it, fetch, re-lock, and write only if `active.id` still equals the id that was read.
- Base currency comes from `stock::base_currency(conn)`, which returns `"CAD"` today. It is resolved on every refresh.
- Startup refresh is spawned in `.setup()` after dataset selection, never blocks launch, skips when every holding has `last_price_at` under 15 min old, and logs failures with `tracing` (no UI error).
- Provider HTTP uses one `reqwest` client with a browser-style User-Agent, a 10 s timeout and 1 retry. Endpoints: `/v8/finance/chart/{symbol}` (price `meta.regularMarketPrice`, `meta.currency`) per symbol and per FX pair `{CCY}{BASE}=X`, plus `/v1/finance/search`.
- All new UI strings exist in EN and FR.

**Ask First:** adding a new crate dependency; changing `record_net_worth_snapshot`/`get_current_net_worth` SQL; changing the sync registry semantics of existing tables.

**Never:** price history, charts, cost basis, account linkage, a second provider, manual price entry, `/v7/finance/quote`/crumb flows, frontend-side HTTP, floats persisted for money/quantity.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Create online | `SHOP.TO`, qty 2.5 | holding saved with CAD price, `value_cents` = qty×price, snapshot recorded | N/A |
| Create offline | provider fails | asset + holding saved, `last_price_cents`/`currency` NULL, `value_cents` 0, UI "Price unavailable" | logged, command still Ok |
| USD holding, CAD base | `AAPL` | FX `USDCAD=X` fetched, rate stored, value in CAD | FX fail → keep previous price+fx+value for that holding |
| Pence quote | currency `GBp`/`GBX` | normalised to `GBP`, price ÷100 | N/A |
| Quantity update | new qty | value recomputed from cached price/fx, no network | price NULL → value stays 0 |
| Invalid input | qty ≤ 0, empty symbol, search < 2 chars | `AppError::Validation` (search < 2 chars → empty list) | — |
| Misuse of generic paths | `create_asset` with `stock`, `update_asset_value` on a stock, `update_asset` changing type to/from `stock` | `AppError::Validation` | protects the AI `update_asset_value` tool too |
| Partial refresh | 1 of 3 symbols fails | other 2 updated, result lists per-symbol ok/failed | failed keep cached values |
| Dataset switched mid-fetch | `active.id` changed | results discarded, nothing written | logged |
| Delete stock asset | `delete_asset` | holding removed by `ON DELETE CASCADE` | N/A |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/migrations/026_project_images.sql` -- template for 1:1 child (`PK = FK ON DELETE CASCADE`, named CHECKs)
- `apps/desktop/src-tauri/src/db/mod.rs` -- `MIGRATIONS` L321-378 (latest 035); `ActiveDataset { id, conn, capture }` L68; `write` L142
- `apps/desktop/src-tauri/src/db/asset.rs` -- `VALID_ASSET_TYPES` L6; CRUD fns whose shape `db/stock.rs` copies
- `apps/desktop/src-tauri/src/commands/asset.rs` -- write→audit→snapshot pattern; `get_asset_json` for audit old value
- `apps/desktop/src-tauri/src/models/mod.rs` -- `PassiveAsset` L172-180 (gets `stock: Option<StockHolding>`), inputs L182-193
- `apps/desktop/src-tauri/src/maintenance/catalog.rs` -- reqwest provider reference: serde DTOs, error mapping, inline-JSON fixture tests, `spawn_background_catalog_refresh` L319-338
- `apps/desktop/src-tauri/src/lib.rs` -- recurring-apply spawn L199-254 (DbState lock + `app_handle.emit`); `select_dataset_now` L169; `generate_handler!` L291-467 (asset block ~L330)
- `apps/desktop/src-tauri/src/error.rs` -- `AppError`; `Unavailable` is AI-worded, so add `MarketData { message }` (`type: "market_data"`)
- `apps/desktop/src-tauri/src/sync/registry.rs` -- `TABLES` L148-191, `COLUMNS` L198-367, `EDGES` L370-404; tests: Natural-tables vec L629, edge count 17 L709
- `apps/desktop/src-tauri/src/db/danger_zone.rs` -- `WIPE_TABLES` L17-58 (child before `passive_assets` L51)
- `apps/desktop/src-tauri/src/db/capture_fixtures.rs` -- `PreSyncRecords::per_table` L380-410
- `apps/desktop/src-tauri/src/sync/tests_write_site_budget.rs` -- write-site ratchet; CAPTURE-SANCTIONED comment keeps new sites uncounted
- `apps/desktop/src-tauri/src/db/test_dataset.rs` -- `migrated_dataset(path)` L600 for db tests
- `apps/desktop/src/routes/wealth.assets.tsx` -- list page, Add/Edit SlideOvers
- `apps/desktop/src/components/assets/{AddAssetForm,EditAssetForm,AssetRow}.tsx` -- forms (local `ASSET_TYPE_VALUES` L17-22), row with `relativeAge`/stale Badge L36-49
- `apps/desktop/src/lib/assetUtils.ts` -- `ASSET_TYPE_ORDER/KEYS/ICONS/COLORS`
- `apps/desktop/src/components/maintenance/VehicleCatalogFields.tsx` -- `SearchableCombobox` L58-158 to copy (Popover + Input)
- `apps/desktop/src/hooks/useTrendsInsight.ts` -- `useDebouncedValue` L12-21 (move to `hooks/useDebouncedValue.ts`, re-import)
- `apps/desktop/src/hooks/useAssets.ts`, `src/lib/types.ts` L123-147, `src/lib/constants.ts` L18-30 -- hooks/types/queryKeys
- `apps/desktop/src/components/shared/DatasetSwitchListener.tsx` + `src/main.tsx` L8,25 -- root listener pattern/mount
- `apps/desktop/src/locales/{en,fr}.json` (`assets.*`), `src/locales/__tests__/maintenance-i18n.test.ts` -- parity-test template
- `apps/desktop/tests/assets.spec.ts` -- e2e invoke mock (`plugin:` catch-all already absorbs `listen`)

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src-tauri/migrations/036_stock_holdings.sql` + `db/mod.rs` -- create `stock_holdings(passive_asset_id PK FK CASCADE, symbol, exchange, currency NULL, quantity_micros > 0, last_price_cents NULL ≥ 0, last_price_at NULL, fx_rate_to_base_micros NULL, created_at, updated_at)`, register 36 -- schema
- [x] `models/mod.rs` -- `StockHolding`, `CreateStockAssetInput{symbol,name,exchange,quantity_micros}`, `StockSearchResult`, `StockRefreshResult{asset_id,symbol,ok}`; `PassiveAsset.stock: Option<StockHolding>` -- wire types
- [x] `db/asset.rs` -- add `stock`; join holding into `get_all_assets`/`get_asset_by_id`; reject stock misuse per matrix -- one read model
- [x] `db/stock.rs` (new) -- insert holding, update quantity, apply price (price, currency, fx, at, value_cents in one tx), list holdings, `compute_value_cents`, `base_currency` -- SQL lives in db/
- [x] `stock/provider.rs` + `stock/yahoo.rs` (new, `mod stock` in lib.rs) -- `PriceProvider` trait (`search`, `quote(&[symbol])`), Yahoo impl, currency normalisation, refresh orchestration `refresh_holdings(state, provider, force)` -- swappable provider, testable with a fake
- [x] `commands/stock.rs` (new) + `lib.rs` -- async `search_stocks`, `create_stock_asset`, `update_stock_quantity`, `refresh_stock_prices`; register; spawn startup refresh after the recurring task, emit `stock-prices-updated` when any value changed -- IPC + startup
- [x] `error.rs` -- `MarketData` variant (Display + Serialize) -- typed provider failure
- [x] `sync/registry.rs`, `db/danger_zone.rs`, `db/capture_fixtures.rs`, `db/audit.rs` (if needed) -- register `stock_holdings` (Natural, Cascade edge, LWW cols, `created_at` Immutable), wipe child-first, update fixture/test counts -- sync and wipe completeness
- [ ] Rust tests (in `stock/` and `db/stock.rs`) -- chart/search JSON fixtures, GBp, value rounding/FX, fake-provider refresh (partial failure, 15-min skip, dataset-switch discard), stock misuse validation; one `#[ignore]` live Yahoo smoke test -- matrix coverage
- [x] `src/lib/types.ts`, `constants.ts`, `hooks/useAssets.ts`, `hooks/useDebouncedValue.ts` -- types, `stockSearch` key, `useSearchStocks` (debounced, ≥2 chars), `useCreateStockAsset`, `useUpdateStockQuantity`, `useRefreshStockPrices` invalidating assets + net-worth keys -- data layer
- [x] `components/assets/StockSymbolCombobox.tsx` (new), `AddAssetForm.tsx`, `EditAssetForm.tsx`, `assetUtils.ts` -- single shared type list incl. `stock`; stock branch = combobox + quantity (no value input); edit form locks type for stocks and lets the user edit quantity -- form
- [x] `AssetRow.tsx`, `wealth.assets.tsx` -- stock row shows symbol, quantity, price, value, "as of", stale badge (price NULL or > 24 h), page-level Refresh button with toast on per-symbol failure -- display
- [x] `components/shared/StockPricesListener.tsx` (new) + `main.tsx` -- invalidate assets + net-worth on `stock-prices-updated` -- startup refresh reaches the UI
- [x] `locales/{en,fr}.json` + `locales/__tests__/assets-i18n.test.ts` -- strings + parity -- bilingual
- [x] `tests/assets.spec.ts`, `src/hooks/__tests__/useAssets.test.tsx` -- e2e: add stock via search, see price/value, refresh; hook invalidation tests -- regression

**Acceptance Criteria:**
- Given a stock holding older than 15 min, when the app launches, then the price refreshes in the background and the assets page and net worth update without a reload.
- Given no network, when the app launches or Refresh is clicked, then cached values stay visible with their "as of" time and no blocking error appears.
- Given a refresh changed any value, when it completes, then a net-worth snapshot reflecting the new value is recorded.
- Given a sync-enabled profile, when a price refresh is written, then `stock_holdings` and `passive_assets` changes are captured (registry completeness tests pass).

## Design Notes

- Yahoo search returns no currency, so `currency` is learned from the first successful chart call (NULL until then). A NULL-currency holding is priced on its next refresh.
- "Refresh failed" is not persisted. A stale badge appears when the price is older than 24 h or missing. Manual-refresh failures are reported through a toast built from `StockRefreshResult`.
- `refresh_holdings` takes `&dyn PriceProvider` so tests inject a fake. Commands and the startup task pass `YahooProvider`.
- Price refresh audits as `passive_asset` / `price_refresh`, only for holdings whose `value_cents` changed.

## Verification

**Commands:**
- `cargo test` (in `apps/desktop/src-tauri`) -- all pass, including registry/write-site/wipe tests
- `cargo clippy --all-targets -- -D warnings` -- clean
- `pnpm --filter @nixus/desktop exec tsc --noEmit` and `pnpm --filter @nixus/desktop test` -- clean/pass
- `pnpm --filter @nixus/desktop exec playwright test tests/assets.spec.ts` -- pass
- `cargo test stock -- --ignored` -- live Yahoo smoke returns a price for `SHOP.TO` and `AAPL`

## Suggested Review Order

**Refresh orchestration (entry point)**

- Lock, read, release, fetch, re-lock, and write only if the dataset id still matches.
  [`refresh.rs:262`](../../apps/desktop/src-tauri/src/stock/refresh.rs#L262)

- Per-DbState in-flight guard: an overlapping manual and startup pass runs once.
  [`refresh.rs:78`](../../apps/desktop/src-tauri/src/stock/refresh.rs#L78)

- Quote + FX resolved into one PriceWrite; zero or wrong-currency FX is discarded.
  [`refresh.rs:166`](../../apps/desktop/src-tauri/src/stock/refresh.rs#L166)

- 15-minute freshness window; a future stamp counts as not fresh.
  [`refresh.rs:143`](../../apps/desktop/src-tauri/src/stock/refresh.rs#L143)

**Value derivation and storage**

- The single i128 value formula used by create, quantity update and refresh.
  [`stock.rs:38`](../../apps/desktop/src-tauri/src/db/stock.rs#L38)

- Price, currency, FX, timestamp and value written together.
  [`stock.rs:192`](../../apps/desktop/src-tauri/src/db/stock.rs#L192)

- 1:1 child table with named CHECKs, cascading from passive_assets.
  [`036_stock_holdings.sql:1`](../../apps/desktop/src-tauri/migrations/036_stock_holdings.sql#L1)

- Generic asset paths refuse stock misuse (this also guards the AI update_asset_value tool).
  [`asset.rs:74`](../../apps/desktop/src-tauri/src/db/asset.rs#L74)

**Provider boundary**

- The trait that keeps a future provider swap contained.
  [`provider.rs:91`](../../apps/desktop/src-tauri/src/stock/provider.rs#L91)

- Zero/non-finite prices rejected; GBp/GBX normalised to GBP.
  [`provider.rs:43`](../../apps/desktop/src-tauri/src/stock/provider.rs#L43)

- Shared client, browser User-Agent, no retry on 429.
  [`yahoo.rs:32`](../../apps/desktop/src-tauri/src/stock/yahoo.rs#L32)

**IPC and startup**

- Create commits first, then prices, so offline creation keeps the user's input.
  [`stock.rs:50`](../../apps/desktop/src-tauri/src/commands/stock.rs#L50)

- Startup pass emits the event whenever any price was written.
  [`stock.rs:174`](../../apps/desktop/src-tauri/src/commands/stock.rs#L174)

- Spawned after synchronous dataset selection and the recurring task.
  [`lib.rs:261`](../../apps/desktop/src-tauri/src/lib.rs#L261)

**Sync and wipe**

- Natural identity derived from the parent asset, cascade edge.
  [`registry.rs:177`](../../apps/desktop/src-tauri/src/sync/registry.rs#L177)

**Frontend**

- Stock branch of the add form: symbol search + quantity, no value input.
  [`AddAssetForm.tsx:66`](../../apps/desktop/src/components/assets/AddAssetForm.tsx#L66)

- Debounced search combobox modelled on the vehicle catalog picker.
  [`StockSymbolCombobox.tsx:34`](../../apps/desktop/src/components/assets/StockSymbolCombobox.tsx#L34)

- Row display: price in the quote currency, "as of" time, 24h stale badge.
  [`AssetRow.tsx:63`](../../apps/desktop/src/components/assets/AssetRow.tsx#L63)

- Locale-aware quantity parsing and stamp/age helpers.
  [`assetUtils.ts:73`](../../apps/desktop/src/lib/assetUtils.ts#L73)

- Root listener refreshes assets and net worth after a background refresh.
  [`StockPricesListener.tsx:12`](../../apps/desktop/src/components/shared/StockPricesListener.tsx#L12)

- Hooks and the shared invalidation helper.
  [`useAssets.ts:122`](../../apps/desktop/src/hooks/useAssets.ts#L122)

**Tests**

- Fake-provider refresh suite: partial failure, throttle, dataset switch, snapshot/audit.
  [`tests_refresh.rs:1`](../../apps/desktop/src-tauri/src/stock/tests_refresh.rs#L1)

- E2E stock flows.
  [`assets.spec.ts:573`](../../apps/desktop/tests/assets.spec.ts#L573)
