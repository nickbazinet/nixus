//! Refresh orchestration: read holdings, price them, write what came back.
//!
//! The lock discipline is the whole design. `DbState`'s mutex is taken to READ the holdings,
//! released for the HTTP calls, and taken again to WRITE — because holding it across a 10-second
//! request would freeze every other command behind the network. The price of releasing it is that
//! the dataset can be switched underneath, which is why the second acquisition re-checks
//! `active.id` and discards the results rather than writing them into the wrong profile.
//!
//! The same gap is why a pass is also mutually exclusive with every other pass: the startup refresh
//! and a user's Refresh click would otherwise both read "stale", both fetch, and both write.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::{Mutex, MutexGuard};

use chrono::{DateTime, NaiveDateTime, TimeDelta, Utc};

use crate::db::audit as audit_db;
use crate::db::net_worth as net_worth_db;
use crate::db::stock as stock_db;
use crate::db::{ActiveDataset, DbState};
use crate::error::AppError;
use crate::models::{StockHolding, StockRefreshResult};
use crate::stock::provider::{fx_symbol, PriceProvider, Quote};

/// Free quotes are delayed 15-20 minutes anyway, so refreshing inside this window would spend a
/// request to be told the same number.
pub const FRESH_WINDOW_MINUTES: i64 = 15;

/// The audit action a price refresh records, distinct from the hand-typed `value_update`.
pub const PRICE_REFRESH_ACTION: &str = "price_refresh";

pub struct RefreshSummary {
    pub results: Vec<StockRefreshResult>,
    /// Whether any holding's `value_cents` actually moved — the condition for a net-worth snapshot
    /// and for an audit row.
    pub changed: bool,
    /// Whether any price was WRITTEN, which is a weaker condition than `changed`: a re-quote at the
    /// same price moves no value but does move "as of", and the UI has to be told so the timestamp
    /// and the stale badge stop lying.
    pub priced: bool,
}

impl RefreshSummary {
    fn skipped() -> Self {
        Self {
            results: Vec::new(),
            changed: false,
            priced: false,
        }
    }
}

/// At most one refresh pass per `DbState`.
///
/// Startup spawns one and the Refresh button can fire another a moment later. Both would read the
/// same stale holdings, spend the same requests and write the same rows — doubling the load on a
/// provider that rate-limits by client. The loser returns an empty summary, which the UI reads as
/// "nothing to report" rather than as a failure.
///
/// Keyed by the state's own address rather than one process-wide flag. In the app the two are the
/// same thing, because there is exactly one `DbState`; but the address states the invariant that
/// actually matters — one pass per dataset handle — instead of a stronger one that merely coincides
/// with it, and it keeps two independent states from blocking each other.
///
/// The key cannot go stale: a pass borrows `&DbState` for its whole duration, so the state cannot
/// be dropped and its address reused while its key is still in the set.
static IN_FLIGHT: Mutex<BTreeSet<usize>> = Mutex::new(BTreeSet::new());

fn in_flight() -> MutexGuard<'static, BTreeSet<usize>> {
    // A poisoned set is still a usable set: the worst a panicked pass can leave behind is one
    // stale key, and refusing every later refresh over it would be the larger failure.
    IN_FLIGHT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Releases the key however the pass ends — early return, `?`, or panic.
struct InFlightGuard(usize);

impl InFlightGuard {
    fn acquire(state: &DbState) -> Option<Self> {
        let key = std::ptr::from_ref(state) as usize;
        // The guard is bound and scoped explicitly, never left as a temporary of the expression
        // that returns: this runs inside an `async fn`, where a lock still held at the next
        // `.await` stops every other task on the thread — including the one that would release it.
        let inserted = {
            let mut in_flight = in_flight();
            in_flight.insert(key)
        };

        inserted.then_some(Self(key))
    }
}

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        in_flight().remove(&self.0);
    }
}

struct Applied {
    asset_id: i64,
    symbol: String,
    ok: bool,
    old_value_cents: i64,
    new_value_cents: i64,
}

impl Applied {
    /// Equal old and new values, so a failed holding can never look like a change.
    fn failed(holding: &StockHolding) -> Self {
        Self {
            asset_id: holding.passive_asset_id,
            symbol: holding.symbol.clone(),
            ok: false,
            old_value_cents: 0,
            new_value_cents: 0,
        }
    }
}

fn lock(state: &DbState) -> Result<MutexGuard<'_, ActiveDataset>, AppError> {
    state.0.lock().map_err(|error| AppError::Database {
        message: error.to_string(),
    })
}

/// `datetime('now')` writes `YYYY-MM-DD HH:MM:SS` in UTC; RFC 3339 is accepted too so a row written
/// by a future code path cannot silently read as "never priced".
fn parse_stamp(raw: &str) -> Option<DateTime<Utc>> {
    let raw = raw.trim();

    NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|naive| naive.and_utc())
        .or_else(|| {
            DateTime::parse_from_rfc3339(raw)
                .ok()
                .map(|stamp| stamp.with_timezone(&Utc))
        })
}

pub fn is_fresh(holding: &StockHolding, now: DateTime<Utc>) -> bool {
    if holding.last_price_cents.is_none() || holding.currency.is_none() {
        return false;
    }

    // A stamp in the FUTURE is not freshness, it is a wrong clock — this computer's, or the one
    // that wrote the row before it synced here. Treating it as fresh would park the holding on a
    // price that never refreshes until real time catches up to the skew.
    holding
        .last_price_at
        .as_deref()
        .and_then(parse_stamp)
        .map(|stamp| now.signed_duration_since(stamp))
        .is_some_and(|age| {
            age >= TimeDelta::zero() && age < TimeDelta::minutes(FRESH_WINDOW_MINUTES)
        })
}

/// What to write for one holding, or `None` when this pass cannot value it — an unpriced symbol or
/// a missing FX leg both keep the holding's cached values untouched.
///
/// Returns the price it resolved rather than leaving the caller to look the quote up again: a
/// second lookup inside the write closure is where an indexing panic would live.
fn resolve<'a>(
    quotes: &'a HashMap<String, Quote>,
    rates: &HashMap<String, Quote>,
    base_currency: &str,
    holding: &StockHolding,
) -> Option<stock_db::PriceWrite<'a>> {
    let quote = quotes.get(&holding.symbol)?;

    // A non-positive price is not a quote. `Quote::from_parts` already refuses one at the parse
    // boundary, but `resolve` is what turns a quote into a WRITE and it consumes whatever the
    // injected `&dyn PriceProvider` produced — so the value that would overwrite a good cached
    // price with zero is checked here, where the overwrite would happen.
    if quote.price_micros <= 0 || quote.price_cents() <= 0 {
        tracing::warn!(
            "Discarding a non-positive quote for {} rather than revaluing it at nothing",
            holding.symbol
        );
        return None;
    }

    if quote.currency == base_currency {
        return Some(stock_db::PriceWrite {
            last_price_cents: quote.price_cents(),
            currency: &quote.currency,
            fx_rate_to_base_micros: stock_db::UNIT_FX_MICROS,
        });
    }

    let rate = rates.get(&fx_symbol(&quote.currency, base_currency))?;
    // `{CCY}{BASE}=X` must come back quoted IN the base currency. Anything else means the symbol
    // resolved to a different instrument than the pair that was asked for, and converting by it
    // would silently value the holding in the wrong currency.
    if rate.currency != base_currency || rate.price_micros <= 0 {
        tracing::warn!(
            "Discarding an FX quote for {} that is denominated in {} rather than {base_currency}",
            holding.symbol,
            rate.currency
        );
        return None;
    }

    Some(stock_db::PriceWrite {
        last_price_cents: quote.price_cents(),
        currency: &quote.currency,
        fx_rate_to_base_micros: rate.price_micros,
    })
}

fn fx_pairs_needed(
    holdings: &[StockHolding],
    quotes: &HashMap<String, Quote>,
    base_currency: &str,
) -> Vec<String> {
    let mut pairs: Vec<String> = holdings
        .iter()
        .filter_map(|holding| quotes.get(&holding.symbol))
        .filter(|quote| quote.currency != base_currency)
        .map(|quote| fx_symbol(&quote.currency, base_currency))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    pairs.sort();

    pairs
}

fn unique_symbols(holdings: &[StockHolding]) -> Vec<String> {
    let mut symbols: Vec<String> = holdings
        .iter()
        .map(|holding| holding.symbol.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    symbols.sort();

    symbols
}

pub async fn refresh_holdings(
    state: &DbState,
    provider: &dyn PriceProvider,
    force: bool,
) -> Result<RefreshSummary, AppError> {
    run(state, provider, force, None).await
}

/// One holding, unconditionally: what a freshly created stock asset needs, without spending a
/// request per unrelated symbol in the portfolio.
pub async fn refresh_one(
    state: &DbState,
    provider: &dyn PriceProvider,
    asset_id: i64,
) -> Result<RefreshSummary, AppError> {
    run(state, provider, true, Some(asset_id)).await
}

async fn run(
    state: &DbState,
    provider: &dyn PriceProvider,
    force: bool,
    only: Option<i64>,
) -> Result<RefreshSummary, AppError> {
    let Some(_in_flight) = InFlightGuard::acquire(state) else {
        tracing::info!("A price refresh is already running; this one was skipped");
        return Ok(RefreshSummary::skipped());
    };

    let (dataset_id, mut holdings, base_currency) = {
        let active = lock(state)?;
        let dataset_id = active.id.clone().ok_or(AppError::NotConfigured)?;
        let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

        (
            dataset_id,
            stock_db::list_holdings(conn)?,
            stock_db::base_currency(conn)?,
        )
    };

    if let Some(asset_id) = only {
        holdings.retain(|holding| holding.passive_asset_id == asset_id);
    }

    if holdings.is_empty() {
        return Ok(RefreshSummary::skipped());
    }

    let now = Utc::now();
    if !force && holdings.iter().all(|holding| is_fresh(holding, now)) {
        tracing::info!("Every stock price is under {FRESH_WINDOW_MINUTES} minutes old; skipping refresh");
        return Ok(RefreshSummary::skipped());
    }

    let quotes = provider.quote(&unique_symbols(&holdings)).await?;
    let pairs = fx_pairs_needed(&holdings, &quotes, &base_currency);
    let rates = if pairs.is_empty() {
        HashMap::new()
    } else {
        provider.quote(&pairs).await?
    };

    let active = lock(state)?;
    if active.id.as_deref() != Some(dataset_id.as_str()) {
        tracing::warn!(
            "The active dataset changed during a price refresh; the results were discarded"
        );
        return Ok(RefreshSummary::skipped());
    }

    let applied = active.write(|tx| {
        let mut applied = Vec::with_capacity(holdings.len());

        for holding in &holdings {
            let Some(price) = resolve(&quotes, &rates, &base_currency, holding) else {
                applied.push(Applied::failed(holding));
                continue;
            };

            // A SAVEPOINT per holding, not one transaction for the batch. The holding was read
            // before the lock was released, so by now the user may have deleted it — and
            // `apply_price` then fails. Letting that error out would discard the prices of every
            // OTHER holding in the same pass, which is the partial-failure guarantee inverted.
            // `WriteTx::savepoint` rolls back its rows AND its captured messages together.
            let written = tx.savepoint(|conn| {
                stock_db::apply_price(conn, holding.passive_asset_id, &price)
            });

            match written {
                Ok((old_value_cents, asset)) => applied.push(Applied {
                    asset_id: holding.passive_asset_id,
                    symbol: holding.symbol.clone(),
                    ok: true,
                    old_value_cents,
                    new_value_cents: asset.value_cents,
                }),
                Err(error) => {
                    tracing::warn!(
                        "Could not store the price of {} (asset {}): {error}",
                        holding.symbol,
                        holding.passive_asset_id
                    );
                    applied.push(Applied::failed(holding));
                }
            }
        }

        Ok(applied)
    })?;

    let changed = record_outcomes(&active, &applied);

    Ok(RefreshSummary {
        results: applied
            .iter()
            .map(|entry| StockRefreshResult {
                asset_id: entry.asset_id,
                symbol: entry.symbol.clone(),
                ok: entry.ok,
            })
            .collect(),
        changed,
        priced: applied.iter().any(|entry| entry.ok),
    })
}

/// Audits only the holdings whose value actually moved, then snapshots once if any did.
///
/// A refresh that re-reads the same price is not an event worth a row — otherwise every launch
/// would append one audit entry per holding forever. Snapshot failure is logged and never returned:
/// losing a history point must not undo the prices that were just written.
fn record_outcomes(active: &ActiveDataset, applied: &[Applied]) -> bool {
    let mut changed = false;

    for entry in applied {
        if !entry.ok || entry.old_value_cents == entry.new_value_cents {
            continue;
        }

        changed = true;
        audit_db::record(
            active,
            "passive_asset",
            entry.asset_id,
            PRICE_REFRESH_ACTION,
            Some(&entry.old_value_cents.to_string()),
            Some(&entry.new_value_cents.to_string()),
        );
    }

    if changed {
        if let Err(error) = active.write(|tx| net_worth_db::record_net_worth_snapshot(tx)) {
            tracing::error!("Failed to record snapshot after a price refresh: {error}");
        }
    }

    changed
}
