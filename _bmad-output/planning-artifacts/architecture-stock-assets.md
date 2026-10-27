# Architecture: Stock Asset with Live Price

Status: Decisions confirmed, ready for epics/stories. Date: 2026-10-26.

## Goal
Add a `stock` asset type. The user searches for a stock, selects it, and enters a quantity. Nixus fetches the latest price and refreshes it automatically at app startup. Net worth uses quantity x price.

## Confirmed Decisions
- **Provider:** Yahoo Finance unofficial API (`query1.finance.yahoo.com`), no API key. Acceptable as a first step for a personal app. No change to business-vision.md.
- **Currency:** Convert USD (and other) holdings to the base currency using Yahoo FX pairs (e.g. `USDCAD=X`). No extra provider.
- **Offline:** Always show cached prices; refresh opportunistically. A failed refresh never errors the UI, it shows stale data with its timestamp.
- **Scope (simple first):**
  - One tracked price per stock; the user enters quantity and value = quantity x price.
  - Latest price only, no price history.
  - No TFSA/RRSP or account linkage.

## Out of Scope
Price history, charts, account-type linkage, secondary providers (Finnhub/Twelve Data with a user key is a possible later fallback), real-time streaming, cost basis / gains.

## Codebase Anchors
- Assets: `apps/desktop/src-tauri/src/db/asset.rs` (`VALID_ASSET_TYPES`, `passive_assets`), `commands/asset.rs`, `models/mod.rs` (`PassiveAsset`, `CreateAssetInput`).
- HTTP: `reqwest` (rustls) already a dependency. All provider calls are made from Rust (Yahoo blocks browser CORS; CSP is null).
- Startup background task: follow the recurring-apply task in `lib.rs` `.setup()`.
- Writes must go through `ActiveDataset::write` (capture-sanctioned, AD-3) so sync is not bypassed, including price refreshes.

## Data Model
Add `stock` to `VALID_ASSET_TYPES`. New table `stock_holdings` (1:1 with `passive_assets.id`):

| Column | Notes |
|---|---|
| asset_id | PK/FK to passive_assets |
| symbol | e.g. `AAPL`, `SHOP.TO` |
| exchange | display |
| currency | quote currency (USD, CAD...) |
| quantity | decimal; store as scaled integer or REAL per project convention for non-money numbers |
| last_price_minor | integer minor units in quote currency |
| last_price_at | UTC timestamp of last successful refresh |
| fx_rate_to_base | rate used at last refresh (nullable if same currency) |

`passive_assets.value_cents` stays the derived base-currency value (round(quantity x price x fx)), so net worth, projections and AI code keep reading one number. Needs a migration and sync registry entry (`sync/registry.rs`).

## Provider Abstraction
Rust trait `PriceProvider`:
- `search(query) -> Vec<{symbol, name, exchange, currency}>` (Yahoo `/v1/finance/search`)
- `quote(symbols[]) -> Map<symbol, {price, currency, as_of}>` batched in one request (Yahoo `/v7/finance/quote` or `/v8/finance/chart` fallback; handle crumb/cookie requirement)
- `fx(pairs[])` via the same quote call.

`YahooProvider` is the only implementation now. Isolating it keeps a future provider swap cheap. Set a User-Agent, timeouts (~10s), 1-2 retries, and map failures to a typed `AppError` variant.

## Tauri Commands
- `search_stocks(query)`: debounced from the UI, min 2 chars.
- `create_stock_asset({symbol, exchange, currency, name, quantity})`: fetches the first price immediately; if offline, saves with price unset and shows "Price unavailable".
- `update_stock_quantity(asset_id, quantity)`: recomputes `value_cents` from the cached price.
- `refresh_stock_prices()`: manual refresh; returns per-symbol results.

## Startup Refresh Flow
1. After dataset selection in `.setup()`, spawn an async task (never blocks startup).
2. Load stock holdings; skip if all `last_price_at` are under ~15 min old.
3. One batched quote call plus FX pairs for non-base currencies.
4. Write prices, timestamps and recomputed `value_cents` through `ActiveDataset::write`.
5. Emit a Tauri event (`stock-prices-updated`); the frontend invalidates asset and net-worth queries.
6. Net-worth snapshots must be taken after the refresh so history does not record stale values.
7. On failure: log with `tracing`, keep cached values, no user-facing error beyond the stale indicator.

## UI
- Asset form: when type is `stock`, show a symbol search combobox (symbol, name, exchange, currency) and a quantity field. Manual price entry is not offered in v1.
- Asset list/detail: show price, quantity, value, and "as of <time>"; a stale badge when the refresh failed or the price is older than 24h; manual Refresh button.
- English and French strings for all new text (project is bilingual).

## Risks
- Yahoo is unofficial: no SLA, ToS unclear, and cookie/crumb behavior has changed before (Dec 2025). Mitigated by the provider trait, cache-first display and graceful degradation. Not suitable if Nixus is ever distributed commercially.
- Rate throttling: avoided by batching and the 15-minute skip window.
- Rounding: money stays in integer minor units; compute value once at refresh and store it.
- Delay: free quotes may be delayed 15-20 minutes; the UI shows the "as of" time.

## Suggested Epic / Stories
1. Migration + model: `stock_holdings`, `stock` asset type, sync registry, value derivation.
2. `PriceProvider` trait + `YahooProvider` (search, quote, FX) with stubbed-HTTP tests.
3. Commands: search, create, update quantity, manual refresh.
4. Startup background refresh + event + net-worth snapshot ordering.
5. Frontend: search combobox, asset form, list/detail display, stale indicator, i18n (EN/FR).
6. Tests: provider parsing fixtures, offline/failure path, currency conversion, startup throttle.

## Open Items for Implementation
- Base currency (decided): default to CAD. If the user has a profile with a preferred/income currency set, use that instead. Resolve it at refresh time so a profile change is picked up on the next refresh.
- Fractional shares: decided, supported.
- Yahoo crumb/cookie flow: checked 2026-10-26, see findings below.

## Yahoo Probe Findings (2026-10-26)
Tested from a dev machine against `query1/query2.finance.yahoo.com`:

| Client | Result |
|---|---|
| plain `curl` (browser User-Agent, with or without cookie/crumb flow) | HTTP 429 on search, chart, quote and getcrumb, on both hosts |
| `curl_cffi` impersonating Chrome's TLS fingerprint, no cookie, no crumb | HTTP 200 on `/v8/finance/chart/SHOP.TO` (returned CAD price, exchange TOR) and `/v1/finance/search?q=shopify` |

Conclusions:
- Search and chart need **no crumb or cookie** right now. Crumb is only needed for `/v7/finance/quote` (not verified, since the plain-curl crumb request was blocked).
- Yahoo is throttling by **TLS/client fingerprint**, not by IP. A non-browser TLS stack gets 429.
- **Rust spike (done):** `reqwest 0.12` + rustls (same stack as the app), with only a Chrome-style User-Agent, got HTTP 200 on both the chart and search endpoints; adding Accept headers made no difference. No impersonation crate or crumb is needed today. Plain curl is blocked, rustls is not.
- Plan to use `/v8/finance/chart/{symbol}` per symbol (price in `meta.regularMarketPrice`, currency in `meta.currency`) and `/v1/finance/search`, instead of the batched `/v7/finance/quote`. FX works the same way with `USDCAD=X`. This means N requests per refresh instead of one, still small for personal portfolios.

### Spike outcome
Passed. Use the app's existing `reqwest` client with a browser-style User-Agent. Keep the fallback plan (impersonation crate, then user-key provider) as a contingency if Yahoo changes its fingerprinting; the provider trait and cached-price behavior make that a contained change. Story 2 should include a live smoke test that is ignored by default (`#[ignore]`) so breakage can be detected on demand.
