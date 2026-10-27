//! `refresh_holdings` against a fake provider: the whole I/O matrix with no network.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{TimeDelta, Utc};
use rusqlite::Connection;
use tempfile::TempDir;

use crate::db::test_dataset::migrated_dataset;
use crate::db::{stock as stock_db, ActiveDataset, DbState};
use crate::models::{CreateStockAssetInput, StockHolding, StockRefreshResult};
use crate::stock::provider::{fx_symbol, PriceProvider, ProviderFuture, Quote};
use crate::stock::refresh::{
    is_fresh, refresh_holdings, refresh_one, FRESH_WINDOW_MINUTES, PRICE_REFRESH_ACTION,
};

type Hook = Box<dyn Fn() + Send + Sync>;

struct FakeProvider {
    quotes: HashMap<String, Quote>,
    requested: Mutex<Vec<Vec<String>>>,
    before_quote: Option<Hook>,
    /// Makes `quote` yield, so two passes can genuinely overlap in one test.
    delay: Option<Duration>,
}

impl FakeProvider {
    fn new(quotes: &[(&str, i64, &str)]) -> Self {
        Self {
            quotes: quotes
                .iter()
                .map(|(symbol, price_micros, currency)| {
                    (
                        (*symbol).to_string(),
                        Quote {
                            price_micros: *price_micros,
                            currency: (*currency).to_string(),
                        },
                    )
                })
                .collect(),
            requested: Mutex::new(Vec::new()),
            before_quote: None,
            delay: None,
        }
    }

    fn with_hook(mut self, hook: Hook) -> Self {
        self.before_quote = Some(hook);
        self
    }

    fn with_delay(mut self, delay: Duration) -> Self {
        self.delay = Some(delay);
        self
    }

    fn requests(&self) -> Vec<Vec<String>> {
        self.requested.lock().expect("the call log").clone()
    }
}

impl PriceProvider for FakeProvider {
    fn search<'a>(&'a self, _query: &'a str) -> ProviderFuture<'a, Vec<crate::models::StockSearchResult>> {
        Box::pin(async move { Ok(Vec::new()) })
    }

    fn quote<'a>(&'a self, symbols: &'a [String]) -> ProviderFuture<'a, HashMap<String, Quote>> {
        Box::pin(async move {
            if let Some(hook) = &self.before_quote {
                hook();
            }
            self.requested
                .lock()
                .expect("the call log")
                .push(symbols.to_vec());

            if let Some(delay) = self.delay {
                tokio::time::sleep(delay).await;
            }

            Ok(symbols
                .iter()
                .filter_map(|symbol| {
                    self.quotes
                        .get(symbol)
                        .map(|quote| (symbol.clone(), quote.clone()))
                })
                .collect())
        })
    }
}

fn state() -> (TempDir, Arc<DbState>) {
    let dir = TempDir::new().expect("temp dir");
    let conn = migrated_dataset(&dir.path().join("nixus.db"));

    (
        dir,
        Arc::new(DbState(Mutex::new(ActiveDataset {
            id: Some("default".to_string()),
            conn: Some(conn),
            capture: None,
        }))),
    )
}

fn delete_asset(state: &DbState, asset_id: i64) {
    with_conn(state, |conn| {
        crate::db::asset::delete_asset(conn, asset_id).expect("the asset deletes")
    });
}

fn with_conn<T>(state: &DbState, read: impl FnOnce(&Connection) -> T) -> T {
    let active = state.0.lock().expect("the dataset lock");
    read(active.conn.as_ref().expect("a selected dataset"))
}

fn add_holding(state: &DbState, symbol: &str, quantity_micros: i64) -> i64 {
    with_conn(state, |conn| {
        stock_db::insert_stock_asset(
            conn,
            &CreateStockAssetInput {
                symbol: symbol.to_string(),
                name: symbol.to_string(),
                exchange: "NMS".to_string(),
                quantity_micros,
            },
        )
        .expect("a holding is created")
        .id
    })
}

fn holding(state: &DbState, asset_id: i64) -> StockHolding {
    with_conn(state, |conn| {
        stock_db::get_holding(conn, asset_id)
            .expect("the holding reads")
            .expect("the holding exists")
    })
}

fn value_cents(state: &DbState, asset_id: i64) -> i64 {
    with_conn(state, |conn| {
        crate::db::asset::get_asset_by_id(conn, asset_id)
            .expect("the asset reads")
            .value_cents
    })
}

fn ok_symbols(results: &[StockRefreshResult]) -> Vec<&str> {
    results
        .iter()
        .filter(|result| result.ok)
        .map(|result| result.symbol.as_str())
        .collect()
}

/// `(entity_id, old_value, new_value)` of every price-refresh audit row, oldest first.
fn price_refresh_audit(state: &DbState) -> Vec<(i64, String, String)> {
    with_conn(state, |conn| {
        let mut statement = conn
            .prepare(
                "SELECT entity_id, old_value, new_value FROM audit_log \
                 WHERE entity_type = 'passive_asset' AND action = ?1 ORDER BY id",
            )
            .expect("the audit query prepares");
        statement
            .query_map([PRICE_REFRESH_ACTION], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .expect("the audit query runs")
            .collect::<Result<Vec<_>, _>>()
            .expect("every audit row reads")
    })
}

/// `(row count, total_cents, breakdown_json)` of the one snapshot per date the upsert maintains.
fn snapshots(state: &DbState) -> (i64, i64, String) {
    with_conn(state, |conn| {
        let count = conn
            .query_row("SELECT COUNT(*) FROM net_worth_snapshots", [], |row| {
                row.get(0)
            })
            .expect("the snapshot count reads");
        let latest = conn
            .query_row(
                "SELECT total_cents, breakdown_json FROM net_worth_snapshots \
                 ORDER BY snapshot_date DESC, id DESC LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or((0, "{}".to_string()));

        (count, latest.0, latest.1)
    })
}

/// A stock has no net-worth category of its own, so `map_asset_type_to_category` files it under
/// `other` — that bucket is where its value has to show up.
fn other_cents(breakdown_json: &str) -> i64 {
    serde_json::from_str::<serde_json::Value>(breakdown_json)
        .expect("the breakdown is JSON")
        .get("other_cents")
        .and_then(serde_json::Value::as_i64)
        .expect("the breakdown carries other_cents")
}

fn failed_symbols(results: &[StockRefreshResult]) -> Vec<&str> {
    results
        .iter()
        .filter(|result| !result.ok)
        .map(|result| result.symbol.as_str())
        .collect()
}

#[tokio::test]
async fn a_base_currency_holding_is_priced_without_any_fx_request() {
    let (_dir, state) = state();
    let asset_id = add_holding(&state, "SHOP.TO", 2_500_000);
    let provider = FakeProvider::new(&[("SHOP.TO", 123_450_000, "CAD")]);

    let summary = refresh_holdings(&state, &provider, false)
        .await
        .expect("the refresh completes");

    assert_eq!(ok_symbols(&summary.results), vec!["SHOP.TO"]);
    assert!(summary.changed);
    assert_eq!(value_cents(&state, asset_id), 30_863);
    assert_eq!(
        provider.requests(),
        vec![vec!["SHOP.TO".to_string()]],
        "a CAD holding must not cost an FX request"
    );
}

/// Edge-case matrix: "USD holding, CAD base -> FX USDCAD=X fetched, rate stored, value in CAD".
#[tokio::test]
async fn a_usd_holding_is_converted_through_the_fx_pair_and_the_rate_is_stored() {
    let (_dir, state) = state();
    let asset_id = add_holding(&state, "AAPL", 1_000_000);
    let provider = FakeProvider::new(&[
        ("AAPL", 200_000_000, "USD"),
        ("USDCAD=X", 1_370_000, "CAD"),
    ]);

    let summary = refresh_holdings(&state, &provider, false)
        .await
        .expect("the refresh completes");

    assert_eq!(ok_symbols(&summary.results), vec!["AAPL"]);
    let stored = holding(&state, asset_id);
    assert_eq!(stored.currency.as_deref(), Some("USD"));
    assert_eq!(stored.last_price_cents, Some(20_000));
    assert_eq!(stored.fx_rate_to_base_micros, Some(1_370_000));
    assert_eq!(value_cents(&state, asset_id), 27_400);
    assert_eq!(
        provider.requests(),
        vec![
            vec!["AAPL".to_string()],
            vec![fx_symbol("USD", "CAD")]
        ]
    );
}

/// Edge-case matrix: "Partial refresh — 1 of 3 symbols fails; other 2 updated, failed keep cached".
#[tokio::test]
async fn one_dead_symbol_does_not_stop_the_others_and_keeps_its_own_cached_value() {
    let (_dir, state) = state();
    let shop = add_holding(&state, "SHOP.TO", 1_000_000);
    let bns = add_holding(&state, "BNS.TO", 1_000_000);
    let dead = add_holding(&state, "DEAD.TO", 1_000_000);

    let priced = FakeProvider::new(&[
        ("SHOP.TO", 100_000_000, "CAD"),
        ("BNS.TO", 50_000_000, "CAD"),
        ("DEAD.TO", 10_000_000, "CAD"),
    ]);
    refresh_holdings(&state, &priced, true)
        .await
        .expect("the first pass prices all three");
    let cached_dead_value = value_cents(&state, dead);
    assert_eq!(cached_dead_value, 1_000);

    let partial = FakeProvider::new(&[
        ("SHOP.TO", 110_000_000, "CAD"),
        ("BNS.TO", 55_000_000, "CAD"),
    ]);
    let summary = refresh_holdings(&state, &partial, true)
        .await
        .expect("the second pass completes");

    assert_eq!(failed_symbols(&summary.results), vec!["DEAD.TO"]);
    assert_eq!(ok_symbols(&summary.results), vec!["SHOP.TO", "BNS.TO"]);
    assert_eq!(value_cents(&state, shop), 11_000);
    assert_eq!(value_cents(&state, bns), 5_500);
    assert_eq!(
        value_cents(&state, dead),
        cached_dead_value,
        "a symbol that did not price must keep what it had"
    );
    assert_eq!(
        holding(&state, dead).last_price_cents,
        Some(1_000),
        "and must keep its cached price, not be blanked"
    );
}

/// Edge-case matrix: "FX fail -> keep previous price+fx+value for that holding".
#[tokio::test]
async fn a_missing_fx_leg_leaves_the_holding_exactly_as_it_was() {
    let (_dir, state) = state();
    let asset_id = add_holding(&state, "AAPL", 1_000_000);
    let full = FakeProvider::new(&[
        ("AAPL", 200_000_000, "USD"),
        ("USDCAD=X", 1_370_000, "CAD"),
    ]);
    refresh_holdings(&state, &full, true)
        .await
        .expect("the first pass prices it");
    let before = holding(&state, asset_id);

    let no_fx = FakeProvider::new(&[("AAPL", 250_000_000, "USD")]);
    let summary = refresh_holdings(&state, &no_fx, true)
        .await
        .expect("the second pass completes");

    assert_eq!(failed_symbols(&summary.results), vec!["AAPL"]);
    assert!(!summary.changed);
    let after = holding(&state, asset_id);
    assert_eq!(after.last_price_cents, before.last_price_cents);
    assert_eq!(after.fx_rate_to_base_micros, before.fx_rate_to_base_micros);
    assert_eq!(value_cents(&state, asset_id), 27_400);
}

/// Edge-case matrix: offline — the provider answers nothing and the command is still `Ok`.
#[tokio::test]
async fn an_offline_refresh_fails_every_symbol_without_failing_the_call() {
    let (_dir, state) = state();
    let asset_id = add_holding(&state, "SHOP.TO", 1_000_000);
    let offline = FakeProvider::new(&[]);

    let summary = refresh_holdings(&state, &offline, true)
        .await
        .expect("an offline refresh is not an error");

    assert_eq!(failed_symbols(&summary.results), vec!["SHOP.TO"]);
    assert!(!summary.changed);
    assert_eq!(value_cents(&state, asset_id), 0);
    assert!(holding(&state, asset_id).last_price_at.is_none());
}

#[tokio::test]
async fn a_refresh_under_the_fresh_window_makes_no_request_unless_it_is_forced() {
    let (_dir, state) = state();
    add_holding(&state, "SHOP.TO", 1_000_000);
    let first = FakeProvider::new(&[("SHOP.TO", 100_000_000, "CAD")]);
    refresh_holdings(&state, &first, false)
        .await
        .expect("the first pass prices it");

    let skipped = FakeProvider::new(&[("SHOP.TO", 999_000_000, "CAD")]);
    let summary = refresh_holdings(&state, &skipped, false)
        .await
        .expect("the throttled pass completes");

    assert!(summary.results.is_empty());
    assert!(!summary.changed);
    assert!(
        skipped.requests().is_empty(),
        "a price minutes old must not cost a request"
    );

    let forced = FakeProvider::new(&[("SHOP.TO", 999_000_000, "CAD")]);
    let summary = refresh_holdings(&state, &forced, true)
        .await
        .expect("the forced pass completes");
    assert_eq!(ok_symbols(&summary.results), vec!["SHOP.TO"]);
    assert_eq!(forced.requests().len(), 1);
}

#[tokio::test]
async fn a_single_stale_holding_refreshes_the_whole_portfolio() {
    let (_dir, state) = state();
    add_holding(&state, "SHOP.TO", 1_000_000);
    let fresh = FakeProvider::new(&[("SHOP.TO", 100_000_000, "CAD")]);
    refresh_holdings(&state, &fresh, false)
        .await
        .expect("the first pass prices it");

    add_holding(&state, "BNS.TO", 1_000_000);
    let provider = FakeProvider::new(&[
        ("SHOP.TO", 110_000_000, "CAD"),
        ("BNS.TO", 50_000_000, "CAD"),
    ]);
    let summary = refresh_holdings(&state, &provider, false)
        .await
        .expect("the pass completes");

    assert_eq!(ok_symbols(&summary.results), vec!["SHOP.TO", "BNS.TO"]);
}

/// Edge-case matrix: "Dataset switched mid-fetch -> results discarded, nothing written".
#[tokio::test]
async fn results_are_discarded_when_the_dataset_changes_during_the_fetch() {
    let (_dir, state) = state();
    let asset_id = add_holding(&state, "SHOP.TO", 1_000_000);

    let switcher = Arc::clone(&state);
    let provider = FakeProvider::new(&[("SHOP.TO", 100_000_000, "CAD")]).with_hook(Box::new(
        move || {
            switcher
                .0
                .lock()
                .expect("the dataset lock")
                .id = Some("another-profile".to_string());
        },
    ));

    let summary = refresh_holdings(&state, &provider, true)
        .await
        .expect("the discard is not an error");

    assert!(summary.results.is_empty());
    assert!(!summary.changed);
    assert_eq!(value_cents(&state, asset_id), 0);
    assert!(holding(&state, asset_id).last_price_cents.is_none());
}

#[tokio::test]
async fn a_dataset_with_no_holdings_never_reaches_the_provider() {
    let (_dir, state) = state();
    let provider = FakeProvider::new(&[("SHOP.TO", 100_000_000, "CAD")]);

    let summary = refresh_holdings(&state, &provider, true)
        .await
        .expect("the refresh completes");

    assert!(summary.results.is_empty());
    assert!(provider.requests().is_empty());
}

#[tokio::test]
async fn a_refresh_that_re_reads_the_same_price_reports_no_change() {
    let (_dir, state) = state();
    add_holding(&state, "SHOP.TO", 1_000_000);
    let quotes = [("SHOP.TO", 100_000_000, "CAD")];

    refresh_holdings(&state, &FakeProvider::new(&quotes), true)
        .await
        .expect("the first pass");
    let summary = refresh_holdings(&state, &FakeProvider::new(&quotes), true)
        .await
        .expect("the second pass");

    assert_eq!(ok_symbols(&summary.results), vec!["SHOP.TO"]);
    assert!(
        !summary.changed,
        "an unchanged value must not trigger a snapshot or a UI invalidation"
    );
}

#[test]
fn freshness_needs_a_price_a_currency_and_a_recent_stamp() {
    let now = Utc::now();
    let base = StockHolding {
        passive_asset_id: 1,
        symbol: "SHOP.TO".to_string(),
        exchange: "TOR".to_string(),
        currency: Some("CAD".to_string()),
        quantity_micros: 1_000_000,
        last_price_cents: Some(10_000),
        last_price_at: Some(
            (now - TimeDelta::minutes(FRESH_WINDOW_MINUTES - 1))
                .format("%Y-%m-%d %H:%M:%S")
                .to_string(),
        ),
        fx_rate_to_base_micros: Some(1_000_000),
        created_at: String::new(),
        updated_at: String::new(),
    };
    assert!(is_fresh(&base, now));

    let stale = StockHolding {
        last_price_at: Some(
            (now - TimeDelta::minutes(FRESH_WINDOW_MINUTES + 1))
                .format("%Y-%m-%d %H:%M:%S")
                .to_string(),
        ),
        ..base.clone()
    };
    assert!(!is_fresh(&stale, now));

    assert!(!is_fresh(
        &StockHolding {
            last_price_at: None,
            ..base.clone()
        },
        now
    ));
    assert!(!is_fresh(
        &StockHolding {
            last_price_cents: None,
            ..base.clone()
        },
        now
    ));
    // A NULL-currency holding is priced on its next refresh (Design Notes), so it is never fresh.
    assert!(!is_fresh(
        &StockHolding {
            currency: None,
            ..base.clone()
        },
        now
    ));
    assert!(!is_fresh(
        &StockHolding {
            last_price_at: Some("not a timestamp".to_string()),
            ..base.clone()
        },
        now
    ));

    // A stamp in the FUTURE is a wrong clock, not freshness. Counting it as fresh would park the
    // holding on a price nothing refreshes until real time catches up to the skew.
    assert!(!is_fresh(
        &StockHolding {
            last_price_at: Some(
                (now + TimeDelta::minutes(FRESH_WINDOW_MINUTES * 4))
                    .format("%Y-%m-%d %H:%M:%S")
                    .to_string(),
            ),
            ..base.clone()
        },
        now
    ));
    // Including one only just ahead of now, which is the common synced-row case.
    assert!(!is_fresh(
        &StockHolding {
            last_price_at: Some(
                (now + TimeDelta::seconds(90))
                    .format("%Y-%m-%d %H:%M:%S")
                    .to_string(),
            ),
            ..base
        },
        now
    ));
}

/// Acceptance criterion: "Given a refresh changed any value, when it completes, then a net-worth
/// snapshot reflecting the new value is recorded." Plus the Design Note that an audit row is
/// written ONLY for a holding whose `value_cents` moved — otherwise every launch would append one
/// row per holding forever.
#[tokio::test]
async fn a_value_changing_refresh_snapshots_the_new_total_and_audits_only_what_moved() {
    let (_dir, state) = state();
    let shop = add_holding(&state, "SHOP.TO", 2_500_000);
    let bns = add_holding(&state, "BNS.TO", 1_000_000);

    assert_eq!(snapshots(&state).0, 0, "nothing has happened yet");

    let first = FakeProvider::new(&[
        ("SHOP.TO", 100_000_000, "CAD"),
        ("BNS.TO", 50_000_000, "CAD"),
    ]);
    let summary = refresh_holdings(&state, &first, true)
        .await
        .expect("the first pass completes");
    assert!(summary.changed);

    // 2.5 x $100.00 = $250.00 and 1 x $50.00 = $50.00.
    assert_eq!(value_cents(&state, shop), 25_000);
    assert_eq!(value_cents(&state, bns), 5_000);

    let (count, total_cents, breakdown) = snapshots(&state);
    assert_eq!(count, 1, "a refresh records a snapshot");
    assert_eq!(
        total_cents, 30_000,
        "the snapshot total must reflect the values the refresh just wrote"
    );
    assert_eq!(other_cents(&breakdown), 30_000);
    assert_eq!(
        price_refresh_audit(&state),
        vec![
            (shop, "0".to_string(), "25000".to_string()),
            (bns, "0".to_string(), "5000".to_string()),
        ],
        "both holdings moved off zero, so both are audited"
    );

    // Second pass: SHOP moves, BNS is re-quoted at the SAME price.
    let second = FakeProvider::new(&[
        ("SHOP.TO", 110_000_000, "CAD"),
        ("BNS.TO", 50_000_000, "CAD"),
    ]);
    let summary = refresh_holdings(&state, &second, true)
        .await
        .expect("the second pass completes");
    assert!(summary.changed);
    assert_eq!(ok_symbols(&summary.results), vec!["SHOP.TO", "BNS.TO"]);

    assert_eq!(value_cents(&state, shop), 27_500);
    assert_eq!(value_cents(&state, bns), 5_000);

    let (count, total_cents, breakdown) = snapshots(&state);
    assert_eq!(count, 1, "the snapshot is upserted per date, not appended");
    assert_eq!(total_cents, 32_500, "the snapshot followed the new value");
    assert_eq!(other_cents(&breakdown), 32_500);

    assert_eq!(
        price_refresh_audit(&state),
        vec![
            (shop, "0".to_string(), "25000".to_string()),
            (bns, "0".to_string(), "5000".to_string()),
            (shop, "25000".to_string(), "27500".to_string()),
        ],
        "only the holding whose value moved earns a second audit row"
    );
}

/// A refresh that changes nothing must leave the history alone: a snapshot per launch would make
/// net-worth history a record of app starts rather than of money.
#[tokio::test]
async fn a_refresh_that_changes_nothing_records_no_snapshot_and_no_audit_row() {
    let (_dir, state) = state();
    add_holding(&state, "SHOP.TO", 1_000_000);
    let quotes = [("SHOP.TO", 100_000_000, "CAD")];

    refresh_holdings(&state, &FakeProvider::new(&quotes), true)
        .await
        .expect("the first pass");
    let (count, total_cents, _) = snapshots(&state);
    let audited = price_refresh_audit(&state);

    refresh_holdings(&state, &FakeProvider::new(&quotes), true)
        .await
        .expect("the second pass");

    assert_eq!(snapshots(&state).0, count);
    assert_eq!(snapshots(&state).1, total_cents);
    assert_eq!(price_refresh_audit(&state), audited);
}

/// Matrix row "Create online": the holding is saved first and priced second, so this is what the
/// create command's second step does — and it must touch ONLY the new holding.
#[tokio::test]
async fn refresh_one_prices_the_new_holding_and_leaves_every_other_alone() {
    let (_dir, state) = state();
    let untouched = add_holding(&state, "BNS.TO", 1_000_000);
    let created = add_holding(&state, "SHOP.TO", 2_500_000);
    let provider = FakeProvider::new(&[
        ("SHOP.TO", 123_450_000, "CAD"),
        ("BNS.TO", 50_000_000, "CAD"),
    ]);

    let summary = refresh_one(&state, &provider, created)
        .await
        .expect("the new holding prices");

    assert_eq!(ok_symbols(&summary.results), vec!["SHOP.TO"]);
    assert!(summary.changed);

    let stored = holding(&state, created);
    assert_eq!(stored.last_price_cents, Some(12_345));
    assert_eq!(stored.currency.as_deref(), Some("CAD"));
    assert_eq!(stored.fx_rate_to_base_micros, Some(stock_db::UNIT_FX_MICROS));
    assert!(stored.last_price_at.is_some());
    assert_eq!(value_cents(&state, created), 30_863);

    assert_eq!(
        provider.requests(),
        vec![vec!["SHOP.TO".to_string()]],
        "pricing one new holding must not cost a request per unrelated symbol"
    );
    assert_eq!(
        value_cents(&state, untouched),
        0,
        "the rest of the portfolio is not part of this write"
    );
    assert!(holding(&state, untouched).last_price_cents.is_none());
    assert_eq!(
        price_refresh_audit(&state),
        vec![(created, "0".to_string(), "30863".to_string())]
    );
}

/// `refresh_one` is unconditional: a user who has just added a holding is owed a price, even if
/// another holding was quoted seconds ago.
#[tokio::test]
async fn refresh_one_ignores_the_fresh_window() {
    let (_dir, state) = state();
    let created = add_holding(&state, "SHOP.TO", 1_000_000);

    refresh_one(&state, &FakeProvider::new(&[("SHOP.TO", 100_000_000, "CAD")]), created)
        .await
        .expect("the first pass");
    assert_eq!(value_cents(&state, created), 10_000);

    let again = FakeProvider::new(&[("SHOP.TO", 120_000_000, "CAD")]);
    refresh_one(&state, &again, created)
        .await
        .expect("the second pass");

    assert_eq!(again.requests().len(), 1, "the throttle must not apply here");
    assert_eq!(value_cents(&state, created), 12_000);
}

/// Matrix row "Create offline": the asset and holding are saved, the price is NULL, `value_cents`
/// is 0, and the command is still `Ok` — the failure is logged, never surfaced.
#[tokio::test]
async fn refresh_one_offline_keeps_the_new_holding_saved_and_unpriced() {
    let (_dir, state) = state();
    let created = add_holding(&state, "SHOP.TO", 2_500_000);
    let offline = FakeProvider::new(&[]);

    let summary = refresh_one(&state, &offline, created)
        .await
        .expect("an offline create is not an error");

    assert_eq!(failed_symbols(&summary.results), vec!["SHOP.TO"]);
    assert!(!summary.changed);

    let stored = holding(&state, created);
    assert_eq!(stored.symbol, "SHOP.TO");
    assert_eq!(stored.quantity_micros, 2_500_000);
    assert_eq!(
        (
            stored.currency,
            stored.last_price_cents,
            stored.last_price_at,
            stored.fx_rate_to_base_micros
        ),
        (None, None, None, None),
        "nothing may be invented for a holding that never priced"
    );
    assert_eq!(value_cents(&state, created), 0);
    assert_eq!(snapshots(&state).0, 0, "no value moved, so no history point");
    assert!(price_refresh_audit(&state).is_empty());
}

/// An unpriced holding stays priceable: the matrix's "A NULL-currency holding is priced on its next
/// refresh", which is what makes an offline create recoverable without the user doing anything.
#[tokio::test]
async fn a_holding_that_failed_at_create_prices_on_the_next_refresh() {
    let (_dir, state) = state();
    let created = add_holding(&state, "SHOP.TO", 2_500_000);
    refresh_one(&state, &FakeProvider::new(&[]), created)
        .await
        .expect("the offline create");

    let online = FakeProvider::new(&[("SHOP.TO", 123_450_000, "CAD")]);
    let summary = refresh_holdings(&state, &online, false)
        .await
        .expect("the later refresh");

    assert_eq!(ok_symbols(&summary.results), vec!["SHOP.TO"]);
    assert_eq!(value_cents(&state, created), 30_863);
    assert_eq!(snapshots(&state).1, 30_863);
}

/// A holding read before the lock was released can be GONE by the time its price is written. The
/// failure must cost that one holding, not the whole pass — the savepoint is what buys that.
#[tokio::test]
async fn a_holding_deleted_mid_fetch_fails_alone_and_the_others_still_price() {
    let (_dir, state) = state();
    let shop = add_holding(&state, "SHOP.TO", 1_000_000);
    let doomed = add_holding(&state, "DOOM.TO", 1_000_000);
    let bns = add_holding(&state, "BNS.TO", 2_000_000);

    let deleter = Arc::clone(&state);
    let provider = FakeProvider::new(&[
        ("SHOP.TO", 100_000_000, "CAD"),
        ("DOOM.TO", 10_000_000, "CAD"),
        ("BNS.TO", 50_000_000, "CAD"),
    ])
    .with_hook(Box::new(move || {
        // Deleted while its quote is in flight, which is exactly the window the lock is released
        // for. `ON DELETE CASCADE` takes the holding row with it.
        delete_asset(&deleter, doomed);
    }));

    let summary = refresh_holdings(&state, &provider, true)
        .await
        .expect("one dead holding is not a failed pass");

    assert_eq!(failed_symbols(&summary.results), vec!["DOOM.TO"]);
    assert_eq!(ok_symbols(&summary.results), vec!["SHOP.TO", "BNS.TO"]);
    assert!(summary.changed);
    assert_eq!(value_cents(&state, shop), 10_000);
    assert_eq!(value_cents(&state, bns), 10_000);
    assert_eq!(
        price_refresh_audit(&state),
        vec![
            (shop, "0".to_string(), "10000".to_string()),
            (bns, "0".to_string(), "10000".to_string()),
        ],
        "the deleted holding must not be audited"
    );
}

/// Edge case: an FX symbol that comes back denominated in something other than the base currency.
/// Converting by it would value a USD holding in whatever that currency is, silently.
#[tokio::test]
async fn an_fx_quote_that_is_not_in_the_base_currency_is_discarded() {
    let (_dir, state) = state();
    let asset_id = add_holding(&state, "AAPL", 1_000_000);
    // `USDCAD=X` priced in EUR: the right symbol, the wrong instrument.
    let provider = FakeProvider::new(&[
        ("AAPL", 200_000_000, "USD"),
        ("USDCAD=X", 1_370_000, "EUR"),
    ]);

    let summary = refresh_holdings(&state, &provider, true)
        .await
        .expect("the pass completes");

    assert_eq!(failed_symbols(&summary.results), vec!["AAPL"]);
    assert!(!summary.changed);
    assert_eq!(value_cents(&state, asset_id), 0);
    assert!(holding(&state, asset_id).last_price_cents.is_none());
}

/// A zero quote is not a quote: a halted ticker must keep the price it had rather than be revalued
/// at nothing.
#[tokio::test]
async fn a_zero_quote_leaves_the_cached_price_and_value_untouched() {
    let (_dir, state) = state();
    let asset_id = add_holding(&state, "SHOP.TO", 1_000_000);
    refresh_holdings(&state, &FakeProvider::new(&[("SHOP.TO", 100_000_000, "CAD")]), true)
        .await
        .expect("the first pass prices it");

    let halted = FakeProvider::new(&[("SHOP.TO", 0, "CAD")]);
    let summary = refresh_holdings(&state, &halted, true)
        .await
        .expect("the halted pass completes");

    assert_eq!(failed_symbols(&summary.results), vec!["SHOP.TO"]);
    assert!(!summary.changed);
    assert_eq!(holding(&state, asset_id).last_price_cents, Some(10_000));
    assert_eq!(value_cents(&state, asset_id), 10_000);
}

/// A re-quote at the same price moves no value but DOES move "as of", so the pass reports `priced`
/// even though it reports no change — which is what lets the stale badge clear without a reload.
#[tokio::test]
async fn an_unchanged_price_still_counts_as_priced_so_the_as_of_time_can_update() {
    let (_dir, state) = state();
    let asset_id = add_holding(&state, "SHOP.TO", 1_000_000);
    let quotes = [("SHOP.TO", 100_000_000, "CAD")];

    refresh_holdings(&state, &FakeProvider::new(&quotes), true)
        .await
        .expect("the first pass");
    let first_stamp = holding(&state, asset_id).last_price_at;

    let summary = refresh_holdings(&state, &FakeProvider::new(&quotes), true)
        .await
        .expect("the second pass");

    assert!(summary.priced, "a price was written");
    assert!(!summary.changed, "but no value moved");
    assert!(first_stamp.is_some());
    assert!(holding(&state, asset_id).last_price_at.is_some());
}

/// Two overlapping passes — the startup task and a Refresh click — must not both fetch and both
/// write. The loser reports nothing rather than failing.
#[tokio::test]
async fn an_overlapping_pass_is_skipped_rather_than_run_twice() {
    let (_dir, state) = state();
    let asset_id = add_holding(&state, "SHOP.TO", 1_000_000);

    // The first pass yields inside its fetch, which is the window the second one arrives in.
    let slow = FakeProvider::new(&[("SHOP.TO", 100_000_000, "CAD")])
        .with_delay(Duration::from_millis(50));
    let fast = FakeProvider::new(&[("SHOP.TO", 999_000_000, "CAD")]);

    let (first, second) = tokio::join!(
        refresh_holdings(&state, &slow, true),
        refresh_holdings(&state, &fast, true),
    );
    let first = first.expect("the pass that won the guard completes");
    let second = second.expect("the pass that lost it returns rather than failing");

    assert_eq!(ok_symbols(&first.results), vec!["SHOP.TO"]);
    assert!(first.priced);
    assert!(
        second.results.is_empty() && !second.priced && !second.changed,
        "the overlapping pass must report nothing at all"
    );
    assert!(
        fast.requests().is_empty(),
        "and must not have spent a request"
    );
    assert_eq!(slow.requests().len(), 1);
    assert_eq!(
        value_cents(&state, asset_id),
        10_000,
        "the winner's price is the one that landed"
    );
}

/// The guard must be RELEASED when a pass ends, including when it ends early. Otherwise the first
/// refresh of a session would be the only one that ever runs.
#[tokio::test]
async fn the_in_flight_guard_is_released_after_every_pass_including_a_skipped_one() {
    let (_dir, state) = state();

    // No holdings: an early return, before any fetch.
    refresh_holdings(&state, &FakeProvider::new(&[]), true)
        .await
        .expect("the empty pass");

    let asset_id = add_holding(&state, "SHOP.TO", 1_000_000);
    refresh_holdings(&state, &FakeProvider::new(&[("SHOP.TO", 100_000_000, "CAD")]), true)
        .await
        .expect("a later pass still runs");
    assert_eq!(value_cents(&state, asset_id), 10_000);

    // And after the throttled early return too.
    refresh_holdings(&state, &FakeProvider::new(&[("SHOP.TO", 110_000_000, "CAD")]), false)
        .await
        .expect("the throttled pass");
    let forced = FakeProvider::new(&[("SHOP.TO", 120_000_000, "CAD")]);
    refresh_holdings(&state, &forced, true)
        .await
        .expect("and the pass after it");

    assert_eq!(forced.requests().len(), 1);
    assert_eq!(value_cents(&state, asset_id), 12_000);
}
