//! Reconcile (AD-3): the half of capture that heals what `ActiveDataset::write` never saw.
//!
//! AD-3's rule has two halves. The pre-update hook plus the in-transaction flush make a captured
//! write and its messages one fact. Everything else — a write site that has not been migrated, a
//! row that predates capture, a file edited by a build that did not have the hook — is healed HERE,
//! by comparing the live tables with `sync_field_state` and emitting whatever is missing. "Tables
//! are truth": reconcile never corrects a row, it only reports it.
//!
//! Four shapes of difference, each with the message AD-5 gives it:
//!
//! - a live column whose hash differs from the recorded one, or has no recorded hash at all, joins
//!   ONE row-level `field` message (the same shape capture emits);
//! - a live row with no identity is an unwrapped INSERT, which is the same case with every column
//!   differing — so it needs no separate code path, only an identity;
//! - an identity naming a row that is GONE is an unwrapped DELETE and becomes a `tombstone`;
//! - `balance_cents` is never a generic field (AD-5): a live value that differs from the fold of
//!   the recorded balance messages emits a `balance_set`, and a counter emits the DELTA between the
//!   live value and the sum of its recorded deltas.
//!
//! Three properties are structural rather than checked:
//!
//! - **Capture is off.** Reconcile runs on the sync actor's own connection, which never had the
//!   hook installed (the hook is per connection — story 15 pinned that, story 20 relies on the same
//!   fact for apply), and writes its messages through `db::sync_capture`, the capture path's own
//!   writer. There is nothing to detach and nothing that could re-capture its writes.
//! - **Bounded work per tick** (AD-16). [`step`] does ONE transaction over at most
//!   [`ROWS_PER_CHUNK`] rows of ONE table and phase, then returns; the [`Cursor`] resumes where it
//!   stopped. A reconcile of a heavy-year dataset is therefore many short transactions, never one
//!   long one holding the write lock the UI needs.
//! - **A local-only dataset runs none of it** (AD-14). The caller reaches reconcile only after the
//!   gate has admitted the dataset, exactly like the log cycle.
//!
//! Idempotent by construction: the second pass hashes the values the first pass just recorded, so
//! it finds nothing and emits nothing.

use rusqlite::types::Value;
use rusqlite::Connection;
use tracing::warn;

use crate::db::sync_capture::{self, ColumnState, LoggedMessage};
use crate::db::sync_identity::{self, RowUuid};
use crate::db::{sync_apply as apply_db, sync_reconcile as reconcile_db};
use crate::error::AppError;

use super::adopt;
use super::apply::{self, TOMBSTONE_RETENTION_DAYS};
use super::capture::{payload, ROW_COLUMN_MARKER};
use super::clock::Clock;
use super::identity;
use super::registry::{self, MergeKind, RowIdentity, TableClass};

/// How many rows one [`step`] looks at (AD-16).
///
/// 500 and not "the whole table": the chunk is one transaction, and the transaction holds the
/// write lock the UI needs. It is the same order as `apply::APPLY_MAX_MESSAGES` for the same
/// reason, and the pass simply takes more ticks on a larger dataset.
pub(crate) const ROWS_PER_CHUNK: usize = 500;

/// The marker a reconcile-detected delete records instead of the row it cannot produce.
///
/// AD-5 wants a tombstone to carry the FULL ROW so the delete is restorable for 30 days. Reconcile
/// learns about the delete by noticing that the row is gone, so there is nothing left to render —
/// the document is therefore this marker and nothing else, and `sync::restore` refuses it rather
/// than attempting a restore from a row it does not have. The replication half is unaffected: what
/// makes a delete WIN and converge is the tombstone's existence and its `hlc`, not its document.
pub(crate) const RECONCILED_DELETE_MARKER: &str = "_reconciled";

/// The document a reconcile-detected delete retains.
fn reconciled_delete_document() -> String {
    format!("{{\"{RECONCILED_DELETE_MARKER}\":true}}")
}

/// Whether a retained document is one reconcile wrote, i.e. one nothing can be restored from.
pub(crate) fn is_reconciled_delete(row_json: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(row_json)
        .ok()
        .and_then(|document| {
            document
                .get(RECONCILED_DELETE_MARKER)
                .and_then(serde_json::Value::as_bool)
        })
        .unwrap_or(false)
}

/// The write sites that still bypass `ActiveDataset::write` and whose rows reconcile therefore has
/// to keep healing while the app IDLES, not only at startup (AD-3).
///
/// It is the checked-in budget file MINUS the justified structural exclusions, and
/// `the_idle_reconcile_trigger_follows_the_write_site_budget` in `sync/tests_write_site_budget.rs`
/// fails if the two drift — so this const follows the ratchet instead of being a second, staler
/// opinion about it. EMPTY today: story 18 took the remainder to the writes that structurally
/// cannot join a dataset transaction (a different database file, the snapshot copy, the AD-10 blob
/// fetch, the wipe/restore internals), and none of those describes a row another computer needs.
///
/// Consequence, stated plainly: reconcile runs ONCE PER STARTUP and the idle pass is dormant. A
/// story that adds an unmigrated write site turns it back on by failing that test.
pub(crate) const UNMIGRATED_WRITE_SITES: &[&str] = &[];

/// Whether the idle reconcile has anything to do (AD-3: "for as long as any unmigrated write site
/// exists").
pub(crate) fn unmigrated_write_sites_remain() -> bool {
    !UNMIGRATED_WRITE_SITES.is_empty()
}

/// What one pass, or one chunk of it, found. Counts only (AD-16): no value of any row is reported.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct ReconcileReport {
    pub rows: usize,
    pub fields: usize,
    pub counters: usize,
    pub balances: usize,
    pub tombstones: usize,
    /// Rows whose identity could not be resolved, so nothing was emitted for them. A natural-key
    /// row whose parent has no identity yet is the case: the next pass resolves it.
    pub deferred: usize,
}

impl ReconcileReport {
    fn add(&mut self, other: ReconcileReport) {
        self.rows += other.rows;
        self.fields += other.fields;
        self.counters += other.counters;
        self.balances += other.balances;
        self.tombstones += other.tombstones;
        self.deferred += other.deferred;
    }

    pub(crate) fn messages(&self) -> usize {
        self.fields + self.counters + self.balances + self.tombstones
    }
}

/// Which half of which table the next chunk reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// The rows that are there, compared with their recorded hashes.
    Live,
    /// The identities whose row is not.
    Deleted,
}

/// Where a pass has got to, so a chunk can stop anywhere and the next one resumes (AD-16).
///
/// IN MEMORY and deliberately not a table: a pass that is interrupted by a relaunch is simply
/// re-run from the start at the next startup, and reconcile is idempotent, so a durable cursor
/// would be a second record of progress that could disagree with the only one that matters — the
/// hashes in `sync_field_state`.
#[derive(Debug, Clone)]
pub(crate) struct Cursor {
    table: usize,
    phase: Phase,
    after_row_id: i64,
    after_uuid: Vec<u8>,
    done: bool,
}

impl Default for Cursor {
    fn default() -> Self {
        Self {
            table: 0,
            phase: Phase::Live,
            after_row_id: 0,
            after_uuid: Vec::new(),
            done: false,
        }
    }
}

impl Cursor {
    pub(crate) fn done(&self) -> bool {
        self.done
    }
}

/// Every table whose rows travel, in a fixed order so a cursor means the same thing twice.
pub(crate) fn travelling() -> Vec<&'static registry::TableRule> {
    registry::TABLES
        .iter()
        .filter(|rule| !matches!(rule.class, TableClass::LocalOnly))
        .collect()
}

/// One bounded chunk of a reconcile pass, in ONE transaction.
pub(crate) fn step(
    conn: &Connection,
    clock: &Clock,
    install: &str,
    cursor: &mut Cursor,
) -> Result<ReconcileReport, AppError> {
    if cursor.done {
        return Ok(ReconcileReport::default());
    }

    let tables = travelling();
    let Some(rule) = tables.get(cursor.table).copied() else {
        cursor.done = true;
        return Ok(ReconcileReport::default());
    };

    let mut next = cursor.clone();
    let report = in_transaction(conn, |conn| match next.phase {
        Phase::Live => live_chunk(conn, clock, install, rule, &mut next),
        Phase::Deleted => deleted_chunk(conn, clock, install, rule, &mut next),
    })?;

    *cursor = next;
    if cursor.table >= tables.len() {
        cursor.done = true;
    }

    Ok(report)
}

/// Runs a whole pass to completion.
///
/// `#[cfg(test)]` because production deliberately does NOT have this shape: the actor runs one
/// [`step`] per cycle so the write lock is never held for a whole scan (AD-16). A test wants the
/// pass finished before it asserts, which is the one place running it to completion is right.
#[cfg(test)]
pub(crate) fn reconcile_all(
    conn: &Connection,
    clock: &Clock,
    install: &str,
) -> Result<ReconcileReport, AppError> {
    let mut cursor = Cursor::default();
    let mut report = ReconcileReport::default();

    // Bounded rather than `while !done`: the cursor advances on every step by construction, and a
    // loop that trusted that would hang instead of failing if it ever stopped being true.
    for _ in 0..(travelling().len() * 2 + 2) * 1_000 {
        if cursor.done() {
            break;
        }
        report.add(step(conn, clock, install, &mut cursor)?);
    }

    Ok(report)
}

fn live_chunk(
    conn: &Connection,
    clock: &Clock,
    install: &str,
    rule: &'static registry::TableRule,
    cursor: &mut Cursor,
) -> Result<ReconcileReport, AppError> {
    let mut report = ReconcileReport::default();
    let ids = reconcile_db::live_row_ids(conn, rule.table, cursor.after_row_id, ROWS_PER_CHUNK)?;

    for row_id in &ids {
        cursor.after_row_id = *row_id;
        report.add(reconcile_row(conn, clock, install, rule, *row_id)?);
    }

    if ids.len() < ROWS_PER_CHUNK {
        cursor.phase = Phase::Deleted;
        cursor.after_uuid = Vec::new();
    }

    Ok(report)
}

fn deleted_chunk(
    conn: &Connection,
    clock: &Clock,
    install: &str,
    rule: &'static registry::TableRule,
    cursor: &mut Cursor,
) -> Result<ReconcileReport, AppError> {
    let mut report = ReconcileReport::default();
    let mapped = reconcile_db::mapped_rows(conn, rule.table, &cursor.after_uuid, ROWS_PER_CHUNK)?;

    for (uuid, row_id) in &mapped {
        cursor.after_uuid = uuid.clone();

        if reconcile_db::row_exists(conn, rule.table, *row_id)? {
            continue;
        }
        let Ok(row_uuid) = RowUuid::try_from(uuid.as_slice()) else {
            continue;
        };

        report.rows += 1;
        report.add(reconcile_delete(
            conn, clock, install, rule, *row_id, &row_uuid,
        )?);
    }

    if mapped.len() < ROWS_PER_CHUNK {
        cursor.table += 1;
        cursor.phase = Phase::Live;
        cursor.after_row_id = 0;
        cursor.after_uuid = Vec::new();
    }

    Ok(report)
}

/// An identity whose row is gone: an UPDATE this computer made with the hook off, or a DELETE made
/// before the row was ever captured.
fn reconcile_delete(
    conn: &Connection,
    clock: &Clock,
    install: &str,
    rule: &'static registry::TableRule,
    row_id: i64,
    row_uuid: &RowUuid,
) -> Result<ReconcileReport, AppError> {
    let mut report = ReconcileReport::default();

    // AD-5: `audit_log` is append-only, so a locally pruned entry is a local decision and a
    // tombstone would delete it on every other computer. The mapping still goes, because AD-2's
    // rowid-reuse rule does not care why the row went away — exactly what capture does.
    if matches!(rule.class, TableClass::AppendOnly) {
        sync_capture::forget_field_state(conn, rule.table, row_uuid)?;
        sync_identity::forget(conn, rule.table, row_id)?;

        return Ok(report);
    }

    // Already tombstoned: the delete reached the log through some other path (apply, or a captured
    // write whose mapping was left behind), so there is nothing missing to emit.
    if apply_db::tombstone(conn, rule.table, row_uuid)?.is_some() {
        sync_capture::forget_field_state(conn, rule.table, row_uuid)?;
        sync_identity::forget(conn, rule.table, row_id)?;

        return Ok(report);
    }

    let document = reconciled_delete_document();
    let hlc = clock.now().encode();
    let encoded = payload::encode(&Value::Text(document.clone()));

    sync_capture::append(
        conn,
        &LoggedMessage {
            install,
            hlc: &hlc,
            kind: "tombstone",
            table_name: rule.table,
            row_uuid,
            column_name: None,
            cause_uuid: None,
            payload: Some(&encoded),
        },
    )?;
    apply_db::record_tombstone(
        conn,
        rule.table,
        row_uuid,
        &hlc,
        install,
        &document,
        TOMBSTONE_RETENTION_DAYS,
    )?;
    sync_capture::forget_field_state(conn, rule.table, row_uuid)?;
    sync_identity::forget(conn, rule.table, row_id)?;
    report.tombstones += 1;

    Ok(report)
}

/// One live row, compared column by column with what the log says about it.
fn reconcile_row(
    conn: &Connection,
    clock: &Clock,
    install: &str,
    rule: &'static registry::TableRule,
    row_id: i64,
) -> Result<ReconcileReport, AppError> {
    let mut report = ReconcileReport {
        rows: 1,
        ..ReconcileReport::default()
    };

    let columns: Vec<&'static str> = registry::columns_of(rule.table)
        .filter(|column| !matches!(column.merge, MergeKind::Excluded))
        .map(|column| column.column)
        .collect();
    let values = apply_db::read_columns(conn, rule.table, row_id, &columns)?;
    if values.is_empty() {
        // The row went away between the id scan and this read, which the delete phase will see.
        report.rows -= 1;
        return Ok(report);
    }

    // AD-5's per-ROW exclusion, answered BEFORE any identity exactly as capture answers it: a
    // deny-listed `config` key must not even acquire a `sync_uuid` row.
    if row_is_local_only(rule.table, &values) {
        return Ok(report);
    }

    let Some(row_uuid) = identity_for(conn, rule.table, row_id, &values)? else {
        report.deferred += 1;
        return Ok(report);
    };

    let recorded = sync_capture::field_state_columns(conn, rule.table, &row_uuid)?;
    let state_of = |name: &str| {
        recorded
            .iter()
            .find(|(column, _)| column == name)
            .map(|(_, state)| state)
    };

    // AD-5: an `AppendOnly` row is never edited, so the only thing reconcile can have missed about
    // one is its creation. A row that already has state is left alone whatever its values say —
    // re-emitting it would ship an edit to a log entry that cannot change.
    if matches!(rule.class, TableClass::AppendOnly) && !recorded.is_empty() {
        return Ok(report);
    }

    let mut missing: Vec<(&'static str, Vec<u8>)> = Vec::new();
    let mut deferred = false;

    for (column, value) in &values {
        let Some(declared) = registry::column_rule(rule.table, column) else {
            continue;
        };

        match declared.merge {
            MergeKind::Lww => {
                let encoded = payload::encode(value);
                if hash_differs(state_of(column), &encoded) {
                    missing.push((declared.column, encoded));
                }
            }
            // AD-5: a later write to an immutable column is a BUG, not a concurrent edit, and must
            // not become an Lww winner on every other computer — capture warns and drops one, so
            // reconcile cannot be the path that lets it travel. What is still missing is the
            // column's FIRST value, which is why a column nothing owns yet is emitted: that is a
            // row this log has never described, not an edit to one.
            MergeKind::Immutable => {
                if state_of(column).is_none() {
                    missing.push((declared.column, payload::encode(value)));
                }
            }
            MergeKind::LocalId => {
                let Some(parent) = registry::fk_parent(rule.table, declared.column) else {
                    continue;
                };
                match parent_reference(conn, parent, value)? {
                    Some(reference) => {
                        let encoded = payload::encode(&reference);
                        if hash_differs(state_of(column), &encoded) {
                            missing.push((declared.column, encoded));
                        }
                    }
                    // A parent with no identity cannot be named, and a field message missing its
                    // foreign key is a row no other computer could create — so the whole row waits
                    // for the pass that resolves the parent instead of travelling incomplete.
                    None => deferred = true,
                }
            }
            MergeKind::Counter => {
                report.add(reconcile_counter(
                    conn,
                    clock,
                    install,
                    rule.table,
                    &row_uuid,
                    declared.column,
                    value,
                )?);
            }
            MergeKind::Balance => {
                report.add(reconcile_balance(
                    conn,
                    clock,
                    install,
                    rule.table,
                    &row_uuid,
                    value,
                )?);
            }
            MergeKind::Excluded => {}
        }
    }

    if deferred {
        report.deferred += 1;
        return Ok(report);
    }
    if missing.is_empty() {
        return Ok(report);
    }

    emit_field(conn, clock, install, rule.table, &row_uuid, &missing)?;
    report.fields += 1;

    Ok(report)
}

/// The row-level `field` message capture would have written, with only the columns that are missing
/// from the log in it.
fn emit_field(
    conn: &Connection,
    clock: &Clock,
    install: &str,
    table: &'static str,
    row_uuid: &RowUuid,
    missing: &[(&'static str, Vec<u8>)],
) -> Result<(), AppError> {
    let hlc = clock.now().encode();
    let encoded = payload::encode_row_of(missing);

    sync_capture::append(
        conn,
        &LoggedMessage {
            install,
            hlc: &hlc,
            kind: "field",
            table_name: table,
            row_uuid,
            column_name: Some(ROW_COLUMN_MARKER),
            cause_uuid: None,
            payload: Some(&encoded),
        },
    )?;

    let states: Vec<(String, ColumnState)> = missing
        .iter()
        .map(|(column, value)| {
            (
                (*column).to_string(),
                ColumnState {
                    hlc: hlc.clone(),
                    content_hash: apply::content_hash(value),
                },
            )
        })
        .collect();
    sync_capture::upsert_field_states(conn, table, row_uuid, &states)?;

    Ok(())
}

/// AD-5's counter: its value is the sum of its deltas, so the missing message is the DIFFERENCE
/// between what the table says and what the log adds up to.
fn reconcile_counter(
    conn: &Connection,
    clock: &Clock,
    install: &str,
    table: &'static str,
    row_uuid: &RowUuid,
    column: &'static str,
    value: &Value,
) -> Result<ReconcileReport, AppError> {
    let mut report = ReconcileReport::default();
    let Value::Integer(live) = value else {
        warn!("{table}.{column} is a counter but does not hold an integer");
        return Ok(report);
    };

    let recorded = apply::counter_total(conn, table, row_uuid, column)?;
    let delta = live.wrapping_sub(recorded);
    if delta == 0 {
        return Ok(report);
    }

    let hlc = clock.now().encode();
    let encoded = payload::encode(&Value::Integer(delta));
    sync_capture::append(
        conn,
        &LoggedMessage {
            install,
            hlc: &hlc,
            kind: "counter_delta",
            table_name: table,
            row_uuid,
            column_name: Some(column),
            cause_uuid: None,
            payload: Some(&encoded),
        },
    )?;
    report.counters += 1;

    Ok(report)
}

/// AD-3, verbatim: "a changed balance emits `balance_set`".
///
/// Never a generic `field` message and never a delta: reconcile does not know WHY the balance
/// moved, and a delta keyed by a cause it invented would be counted again by whoever emitted the
/// real one. An absolute set is the honest statement that the table is truth.
fn reconcile_balance(
    conn: &Connection,
    clock: &Clock,
    install: &str,
    table: &'static str,
    row_uuid: &RowUuid,
    value: &Value,
) -> Result<ReconcileReport, AppError> {
    let mut report = ReconcileReport::default();
    let Value::Integer(live) = value else {
        warn!("{table} holds a balance that is not an integer");
        return Ok(report);
    };

    if apply::balance_value(conn, table, row_uuid)? == *live {
        return Ok(report);
    }

    let hlc = clock.now().encode();
    let encoded = payload::encode(&Value::Integer(*live));
    sync_capture::append(
        conn,
        &LoggedMessage {
            install,
            hlc: &hlc,
            kind: "balance_set",
            table_name: table,
            row_uuid,
            column_name: None,
            cause_uuid: None,
            payload: Some(&encoded),
        },
    )?;
    report.balances += 1;

    Ok(report)
}

fn hash_differs(state: Option<&ColumnState>, encoded: &[u8]) -> bool {
    state.is_none_or(|current| current.content_hash != apply::content_hash(encoded))
}

/// AD-2's foreign key in uuid space, or `None` when the parent has no identity yet.
fn parent_reference(
    conn: &Connection,
    parent: &'static str,
    value: &Value,
) -> Result<Option<Value>, AppError> {
    let parent_row = match value {
        Value::Null => return Ok(Some(Value::Null)),
        Value::Integer(row_id) => *row_id,
        _ => return Ok(None),
    };

    let values = parent_values(conn, parent, parent_row)?;
    if values.is_empty() {
        return Ok(None);
    }

    Ok(identity_for(conn, parent, parent_row, &values)?
        .map(|uuid| Value::Blob(uuid.to_vec())))
}

pub(crate) fn parent_values(
    conn: &Connection,
    table: &'static str,
    row_id: i64,
) -> Result<Vec<(&'static str, Value)>, AppError> {
    let columns: Vec<&'static str> = registry::columns_of(table)
        .filter(|column| !matches!(column.merge, MergeKind::Excluded))
        .map(|column| column.column)
        .collect();

    apply_db::read_columns(conn, table, row_id, &columns)
}

/// The identity of a live row, minted or DERIVED as AD-2 requires for its table.
///
/// Deriving here is what closes the gap capture could only fail on: a `Natural` row written before
/// this dataset was linked has no mapping, and minting a random uuid for it would split one logical
/// row in two across computers (story 16 trap (c)). Reconcile has the whole row in front of it, so
/// it can compute the key the insert site would have computed — the only place in the app other
/// than that insert site where that is true.
pub(crate) fn identity_for(
    conn: &Connection,
    table: &'static str,
    row_id: i64,
    values: &[(&'static str, Value)],
) -> Result<Option<RowUuid>, AppError> {
    if let Some(found) = sync_identity::lookup(conn, table, row_id)? {
        return Ok(Some(found));
    }

    let Some(rule) = registry::table(table) else {
        return Ok(None);
    };

    let derived = match rule.identity {
        // A record with no identity that reconcile is looking at EXISTED BEFORE it: it predates
        // sync, or was written by a site that bypassed capture. It is given the identity every
        // computer gives it (`adopt`), never a random one — a random identity is what made two
        // computers holding the same records give each of them two.
        Some(RowIdentity::Surrogate) => return adopt::legacy_identity(conn, table, row_id, None, None),
        Some(RowIdentity::SurrogateOrTemplate) => match template_identity(conn, table, values)? {
            Some(derived) => derived,
            // A hand-entered row: adopted like any other record, from its creation facts (AD-2).
            None => return adopt::legacy_identity(conn, table, row_id, None, None),
        },
        Some(RowIdentity::Natural) => match natural_identity(conn, table, values)? {
            Some(derived) => derived,
            None => return Ok(None),
        },
        None => return Ok(None),
    };

    let mapping = identity::ensure_derived(conn, table, row_id, &derived)?;
    if mapping.row_id != row_id {
        // The identity this row's key derives to already belongs to another local row, which the
        // schema's own UNIQUE makes impossible for a natural key — so it is left alone rather than
        // bound to two rows.
        warn!("a {table} row derives an identity that already belongs to another local row");
        return Ok(None);
    }

    Ok(Some(mapping.uuid))
}

/// The identity of a row that is already there, adopted if it has none yet; `None` when the row is
/// gone or cannot be named yet.
///
/// What `adopt` calls to name a parent, so a child's creation facts can include its parent's
/// identity whichever kind of identity the parent has.
pub(crate) fn existing_identity(
    conn: &Connection,
    table: &str,
    row_id: i64,
) -> Result<Option<RowUuid>, AppError> {
    let Some(rule) = registry::table(table) else {
        return Ok(None);
    };

    let values = parent_values(conn, rule.table, row_id)?;
    if values.is_empty() {
        return Ok(None);
    }

    identity_for(conn, rule.table, row_id, &values)
}

/// The derived identity of each of AD-2's four natural-key tables, computed from the row itself.
fn natural_identity(
    conn: &Connection,
    table: &str,
    values: &[(&'static str, Value)],
) -> Result<Option<RowUuid>, AppError> {
    let derived = match table {
        "config" => text_of(values, "key").map(|key| identity::config_key(&key)),
        "project_images" => parent_uuid(conn, values, "project_id", "projects")?
            .map(|project| identity::project_image(&project)),
        "maintenance_tasks" => {
            match (
                parent_uuid(conn, values, "vehicle_id", "vehicles")?,
                text_of(values, "task_type_key"),
            ) {
                (Some(vehicle), Some(key)) => Some(identity::maintenance_task(&vehicle, &key)),
                _ => None,
            }
        }
        "merchant_category_hints" => match (
            text_of(values, "merchant"),
            parent_uuid(conn, values, "budget_category_id", "budget_categories")?,
        ) {
            (Some(merchant), Some(category)) => {
                Some(identity::merchant_category_hint(&merchant, &category))
            }
            _ => None,
        },
        _ => None,
    };

    Ok(derived)
}

/// The identity of a row that ALREADY EXISTED before the write that is naming it, from the values it
/// had before that write (see [`adopt::Observed`]): the one every computer derives from its
/// template when it was generated from one, otherwise the one derived from its creation facts.
///
/// What capture's first touch of a record that predates sync must produce, so that naming it by an
/// edit and naming it by reconcile or the settle pass cannot disagree about which record it is.
/// `None` only when there is no such record (not in the table, nothing observed).
pub(crate) fn identity_of_existing(
    conn: &Connection,
    table: &str,
    row_id: i64,
    observed: Option<&adopt::Observed>,
) -> Result<Option<RowUuid>, AppError> {
    if let Some(found) = sync_identity::lookup(conn, table, row_id)? {
        return Ok(Some(found));
    }
    let Some(rule) = registry::table(table) else {
        return Ok(None);
    };

    if can_derive_from_template(rule.table) {
        let live = parent_values(conn, rule.table, row_id)?;
        let values: Vec<(&'static str, Value)> = registry::columns_of(rule.table)
            .filter(|column| !matches!(column.merge, MergeKind::Excluded))
            .filter_map(|column| {
                observed
                    .and_then(|before| before.get(column.column))
                    .cloned()
                    .or_else(|| {
                        live.iter()
                            .find(|(name, _)| *name == column.column)
                            .map(|(_, value)| value.clone())
                    })
                    .map(|value| (column.column, value))
            })
            .collect();

        if let Some(derived) = template_identity(conn, rule.table, &values)? {
            let mapping = identity::ensure_derived(conn, rule.table, row_id, &derived)?;
            if mapping.row_id == row_id {
                return Ok(Some(mapping.uuid));
            }
            // Another local row holds the identity this one derives to; this one is a record in its
            // own right and is named by its own facts instead.
            warn!("a {} row derives an identity that already belongs to another local row", rule.table);
        }
    }

    adopt::legacy_identity(conn, rule.table, row_id, observed, None)
}

/// Whether a row of this table can carry an identity derived from the recurring template it came
/// from. Only income entries keep that reference; an expense keeps none (see below).
pub(crate) fn can_derive_from_template(table: &str) -> bool {
    table == "income_entries"
}

/// The template-derived identity of a row that EVERY computer generates on its own (AD-2), when the
/// row still says which template and which period it came from.
///
/// `income_entries` carries both (`recurring_income_template_id` and `month`), so a generated entry
/// that predates capture gets the identity its insert site would have bound. `expenses` carries
/// NEITHER — the generated row keeps no reference to its template — so a pre-capture recurring
/// expense is indistinguishable from a hand-entered one by its own columns and is minted as a
/// surrogate. Recorded as the honest limit rather than guessed at from `source = 'recurring'`,
/// which would bind an identity derived from a template this row may not have come from.
fn template_identity(
    conn: &Connection,
    table: &str,
    values: &[(&'static str, Value)],
) -> Result<Option<RowUuid>, AppError> {
    if !can_derive_from_template(table) {
        return Ok(None);
    }

    let template = parent_uuid(
        conn,
        values,
        "recurring_income_template_id",
        "recurring_income_templates",
    )?;

    Ok(match (template, text_of(values, "month")) {
        (Some(template), Some(month)) => Some(identity::recurring_income(&template, &month)),
        _ => None,
    })
}

fn text_of(values: &[(&'static str, Value)], column: &str) -> Option<String> {
    values.iter().find_map(|(name, value)| match value {
        Value::Text(text) if *name == column => Some(text.clone()),
        _ => None,
    })
}

/// The uuid of the row a foreign key points at, minting or deriving it if it has none.
fn parent_uuid(
    conn: &Connection,
    values: &[(&'static str, Value)],
    column: &str,
    parent: &'static str,
) -> Result<Option<RowUuid>, AppError> {
    let row_id = values.iter().find_map(|(name, value)| match value {
        Value::Integer(row_id) if *name == column => Some(*row_id),
        _ => None,
    });
    let Some(row_id) = row_id else {
        return Ok(None);
    };

    let parent_values = parent_values(conn, parent, row_id)?;
    if parent_values.is_empty() {
        return Ok(None);
    }

    identity_for(conn, parent, row_id, &parent_values)
}

/// AD-5's per-ROW exclusion inside `config`.
pub(crate) fn row_is_local_only(table: &str, values: &[(&'static str, Value)]) -> bool {
    table == "config"
        && text_of(values, "key").is_some_and(|key| registry::config_key_is_local_only(&key))
}

/// One chunk's transaction (AD-16: short, and one per chunk).
///
/// `BEGIN IMMEDIATE` for the same reason `ActiveDataset::write` uses it: the body reads and then
/// writes, and a deferred transaction would take its read snapshot first and fail with
/// `SQLITE_BUSY_SNAPSHOT` against the UI connection instead of waiting on the busy timeout.
pub(crate) fn in_transaction<T>(
    conn: &Connection,
    body: impl FnOnce(&Connection) -> Result<T, AppError>,
) -> Result<T, AppError> {
    conn.execute_batch("BEGIN IMMEDIATE")?;

    match body(conn) {
        Ok(value) => {
            conn.execute_batch("COMMIT")?;
            Ok(value)
        }
        Err(error) => {
            if let Err(rollback) = conn.execute_batch("ROLLBACK") {
                warn!("a reconcile chunk could not be rolled back: {}", rollback);
            }

            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reconciled_delete_document_is_recognisable_and_nothing_else_is() {
        assert!(is_reconciled_delete(&reconciled_delete_document()));
        assert!(!is_reconciled_delete("{\"name\":\"Rent\"}"));
        assert!(!is_reconciled_delete("not json"));
        assert!(
            !is_reconciled_delete("{\"_reconciled\":\"yes\"}"),
            "the marker is a boolean, so a column that happened to be named like it is not one"
        );
    }

    /// The cursor is an index into this list, so the list has to be stable and complete.
    #[test]
    fn every_travelling_table_is_scanned_and_no_local_only_one_is() {
        let scanned: Vec<&str> = travelling().iter().map(|rule| rule.table).collect();

        assert!(scanned.len() > 20, "got {scanned:?}");
        assert!(scanned.contains(&"accounts"));
        assert!(scanned.contains(&"audit_log"));
        for table in &scanned {
            assert!(
                !table.starts_with("sync_") && *table != "schema_version",
                "{table} never travels and must not be reconciled (AD-5)"
            );
        }
    }

    /// The idle trigger is a statement about the budget file, and it is checked against it in
    /// `sync/tests_write_site_budget.rs`. Here only the shape: it is the list, not a count.
    #[test]
    fn the_idle_trigger_is_the_unmigrated_write_site_list() {
        assert_eq!(
            unmigrated_write_sites_remain(),
            !UNMIGRATED_WRITE_SITES.is_empty()
        );
    }
}
