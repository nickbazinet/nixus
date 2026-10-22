//! AD-1's single apply path: remote messages folded into the local tables, and nothing else.
//!
//! # Where it runs (AD-11)
//!
//! On a SECOND connection to the active dataset file, opened by [`DatasetApplier::open`] through
//! `db::open_configured` (WAL, `busy_timeout`, `foreign_keys=ON`). The capture hook is per
//! connection, so this connection captures nothing by construction — there is no detaching to get
//! wrong and no flag to forget (Story 15 pins it with
//! `a_second_connection_to_the_same_file_captures_nothing`). Remote-applied changes therefore write
//! no `sync_log` message of this install's own and no `audit_log` row (AD-5: the action log carries
//! the ORIGIN computer's entries, and apply reaches no `db::audit` function at all).
//!
//! # The shape of a batch
//!
//! One segment is applied in `BEGIN IMMEDIATE` transactions of at most [`APPLY_MAX_MESSAGES`]
//! messages. `PRAGMA defer_foreign_keys=ON` is re-issued inside every transaction because SQLite
//! clears it at each commit. `PRAGMA foreign_keys=ON` is re-issued too, but OUTSIDE the `BEGIN`:
//! SQLite documents that pragma as a no-op while a transaction is open, so issuing it inside one
//! would read like compliance and enforce nothing.
//!
//! If a transaction fails to commit — which, with every foreign key translated through `sync_uuid`
//! before it is written, means a deferred constraint that only surfaces at `COMMIT` — the chunk is
//! replayed message by message in SAVEPOINTs with IMMEDIATE foreign keys, so each message fails on
//! its own rather than at a commit that describes the whole batch. A message that still cannot be
//! applied is quarantined with a reason and never blocks the messages after it.
//!
//! # What the merge state is
//!
//! Per column, `sync_field_state` (AD-5): a field applies only if its `hlc` is greater than the
//! stored one, and the frozen 33-character encoding carries the install id in its second half, so a
//! plain string comparison IS the clock comparison with AD-4's tiebreak.
//!
//! For the two kinds whose payload is an increment rather than a value, the state is the LOG: every
//! applied message is recorded in `sync_log` under its origin `(install, seq, idx)`, a counter is
//! the sum of its recorded deltas (base zero, Story 16) and a balance is [`BalanceLedger`]'s fold
//! over its recorded messages. That makes a counter and a balance idempotent under re-delivery for
//! the same structural reason a field is — the state is keyed by the message instead of accumulated
//! per arrival — and it is what lets a delta that arrives BEFORE its row land in that row the
//! moment it is created.

use std::collections::HashSet;
use std::path::Path;

use rusqlite::types::Value;
use rusqlite::Connection;
use tracing::warn;

use crate::db::sync_apply::{self as apply_db, AppliedMessage};
use crate::db::sync_capture::{self, ColumnState};
use crate::db::{open_configured, sync_identity};
use std::sync::Arc;

use crate::error::AppError;

use super::balance::BalanceLedger;
use super::capture::{payload, ROW_COLUMN_MARKER};
use super::clock::{self, Clock, Hlc};
use super::registry::{self, FkPolicy, MergeKind, RowIdentity, TableClass};
use super::segment::{Applier, MessageKind, SegmentBatch, SegmentMessage};
use super::state::ensure_install_on;

/// AD-11's transaction size: at most this many messages commit together, so a local write waits for
/// a short lock instead of for a whole segment.
pub const APPLY_MAX_MESSAGES: usize = 500;

/// AD-5: a deleted row stays restorable for 30 days.
pub const TOMBSTONE_RETENTION_DAYS: u32 = 30;

/// How long a message may wait for a row that never arrives before it is quarantined instead
/// (AD-11 requires the parking queue to be bounded).
///
/// Measured in days and not in attempts, because the queue is drained by arrivals rather than by a
/// timer: a message parked for a month waits for a row no computer is going to send, while one
/// parked for an hour waits for a segment that is still being fetched.
pub const PENDING_GIVE_UP_DAYS: u32 = 30;

/// How many times the parking queue is re-driven inside one batch. A round only runs when the
/// previous one made progress, so this bounds a cycle in the waiting graph, not a retry budget.
const PENDING_DRAIN_ROUNDS: usize = 16;

/// How many of this computer's own unsent messages a post-swap replay re-materializes. Bounded for
/// the same reason every other batch here is: a replay must not hold one transaction open over an
/// unbounded tail.
pub const REPLAY_MAX_MESSAGES: usize = 5_000;

const INSERT_SAVEPOINT: &str = "nixus_apply_insert";
const MESSAGE_SAVEPOINT: &str = "nixus_apply_message";
const RETRY_SAVEPOINT: &str = "nixus_apply_retry";

/// Counts only (AD-16): what a batch did, with no value and no table name in it.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ApplyReport {
    pub applied: usize,
    pub dropped: usize,
    pub parked: usize,
    pub quarantined: usize,
    pub skipped: usize,
}

impl ApplyReport {
    fn add(&mut self, other: ApplyReport) {
        self.applied += other.applied;
        self.dropped += other.dropped;
        self.parked += other.parked;
        self.quarantined += other.quarantined;
        self.skipped += other.skipped;
    }

    /// Everything that was dealt with, which is what the pull side counts as consumed.
    pub fn handled(&self) -> usize {
        self.applied + self.dropped + self.parked + self.quarantined + self.skipped
    }
}

/// What happened to one message.
enum Outcome {
    Applied,
    /// Addressed to a tombstoned row, or to a child of one: delete wins (AD-5, AD-12) and the
    /// message is recorded as handled so it is never reconsidered.
    Dropped,
    /// Already applied, parked or quarantined. Re-delivery is expected (AD-6).
    Skipped,
    /// Waiting for a row to exist (AD-11).
    Parked {
        table: &'static str,
        row_uuid: [u8; 16],
    },
    Quarantined,
}

/// Folds one segment's messages into the tables and advances `sync_applied_vector` in the same
/// transaction as the last of them.
pub fn apply_batch(
    conn: &Connection,
    clock: &Clock,
    batch: &SegmentBatch,
) -> Result<ApplyReport, AppError> {
    let total = batch.messages.len();

    // The vector only ever names a FULLY applied segment, so anything at or below it is done. A
    // segment that stopped part-way is deliberately not recorded: its committed messages are
    // recognized one by one on the next delivery, which is what makes losing partial progress safe.
    if let Some((applied_seq, _)) = apply_db::applied_position(conn, &batch.install)? {
        if batch.seq <= applied_seq {
            return Ok(ApplyReport {
                skipped: total,
                ..ApplyReport::default()
            });
        }

        // AD-11 applies one install's segments in CONTIGUOUS `seq` order, and the pull side hands
        // over only the contiguous prefix (Story 19). Refusing a gap rather than trusting that is
        // what keeps the watermark honest: applying past a hole would advance the vector over a
        // segment that was never applied, and the pull side would never ask for it again.
        if batch.seq > applied_seq + 1 {
            return Err(AppError::Database {
                message: format!(
                    "a sync segment arrived out of order for install {}",
                    batch.install
                ),
            });
        }
    }

    let mut report = ApplyReport::default();
    let chunks = total.div_ceil(APPLY_MAX_MESSAGES).max(1);

    for chunk in 0..chunks {
        let start = chunk * APPLY_MAX_MESSAGES;
        let end = (start + APPLY_MAX_MESSAGES).min(total);
        let last = chunk + 1 == chunks;

        let committed = in_transaction(conn, true, |conn| {
            let mut chunk_report = ApplyReport::default();

            for (offset, message) in batch.messages[start..end].iter().enumerate() {
                let idx = (start + offset) as i64;
                let outcome = apply_message(conn, clock, &batch.install, batch.seq, idx, message, true)?;
                record(
                    &mut chunk_report,
                    conn,
                    &batch.install,
                    batch.seq,
                    idx,
                    message,
                    outcome,
                )?;
            }

            if last {
                finish_batch(conn, clock, batch, total, &mut chunk_report)?;
            }

            Ok(chunk_report)
        });

        match committed {
            Ok(chunk_report) => report.add(chunk_report),
            Err(error) => {
                warn!(
                    "a sync batch of {} message(s) did not commit, replaying it message by message: {}",
                    end - start,
                    error
                );
                report.add(replay_chunk(conn, clock, batch, start, end, total, last)?);
            }
        }
    }

    Ok(report)
}

/// The parking sweep and the vector, both in the batch's own transaction.
///
/// The vector moves LAST and in the same transaction as the rows (AD-11), so a rollback leaves both
/// where they were and the segment stays owed.
fn finish_batch(
    conn: &Connection,
    clock: &Clock,
    batch: &SegmentBatch,
    total: usize,
    report: &mut ApplyReport,
) -> Result<(), AppError> {
    report.quarantined += give_up_on_stale_parked(conn)?;

    let drained = drain_parked(conn, clock)?;
    report.applied += drained.applied;
    report.dropped += drained.dropped;
    report.quarantined += drained.quarantined;

    apply_db::advance_applied_vector(conn, &batch.install, batch.seq, total as i64)?;

    Ok(())
}

/// AD-11's commit-failure path: the same messages, one savepoint each, with foreign keys enforced
/// IMMEDIATELY so a violation names the message that caused it instead of the batch.
fn replay_chunk(
    conn: &Connection,
    clock: &Clock,
    batch: &SegmentBatch,
    start: usize,
    end: usize,
    total: usize,
    last: bool,
) -> Result<ApplyReport, AppError> {
    in_transaction(conn, false, |conn| {
        let mut report = ApplyReport::default();

        for (offset, message) in batch.messages[start..end].iter().enumerate() {
            let idx = (start + offset) as i64;
            let attempt = in_savepoint(conn, MESSAGE_SAVEPOINT, |conn| {
                let outcome = apply_message(conn, clock, &batch.install, batch.seq, idx, message, true)?;
                let mut single = ApplyReport::default();
                record(
                    &mut single,
                    conn,
                    &batch.install,
                    batch.seq,
                    idx,
                    message,
                    outcome,
                )?;

                Ok(single)
            });

            match attempt {
                Ok(single) => report.add(single),
                Err(error) => {
                    warn!("a sync message was quarantined after a failed replay: {}", error);
                    apply_db::quarantine(
                        conn,
                        &stored_message(&batch.install, batch.seq, idx, message),
                        "constraint_violation",
                        None,
                    )?;
                    report.quarantined += 1;
                }
            }
        }

        if last {
            finish_batch(conn, clock, batch, total, &mut report)?;
        }

        Ok(report)
    })
}

/// Turns an outcome into the row that records it, so "handled" and "recorded as handled" are one
/// fact. Parking has its own table; everything else was recorded by the arm that decided it.
fn record(
    report: &mut ApplyReport,
    conn: &Connection,
    install: &str,
    seq: i64,
    idx: i64,
    message: &SegmentMessage,
    outcome: Outcome,
) -> Result<(), AppError> {
    match outcome {
        Outcome::Applied => report.applied += 1,
        Outcome::Dropped => report.dropped += 1,
        Outcome::Skipped => report.skipped += 1,
        Outcome::Quarantined => report.quarantined += 1,
        Outcome::Parked { table, row_uuid } => {
            apply_db::park(
                conn,
                &stored_message(install, seq, idx, message),
                table,
                &row_uuid,
            )?;
            report.parked += 1;
        }
    }

    Ok(())
}

fn stored_message<'a>(
    install: &'a str,
    seq: i64,
    idx: i64,
    message: &'a SegmentMessage,
) -> AppliedMessage<'a> {
    remembered_message(install, seq, idx, message, true)
}

fn remembered_message<'a>(
    install: &'a str,
    seq: i64,
    idx: i64,
    message: &'a SegmentMessage,
    record: bool,
) -> AppliedMessage<'a> {
    AppliedMessage {
        install,
        seq,
        idx,
        record,
        hlc: &message.hlc,
        kind: message.kind.as_str(),
        table_name: &message.table_name,
        row_uuid: &message.row_uuid,
        column_name: message.column_name.as_deref(),
        cause_uuid: message.cause_uuid.as_ref().map(|cause| cause.as_slice()),
        payload: message.payload.as_deref(),
    }
}

/// One message, decided and written.
///
/// Every `Ok` arm has already recorded what it decided, so the caller only counts it. An `Err`
/// means the DATABASE refused something unexpected, which is what the replay path turns into a
/// quarantine.
fn apply_message(
    conn: &Connection,
    clock: &Clock,
    install: &str,
    seq: i64,
    idx: i64,
    message: &SegmentMessage,
    record: bool,
) -> Result<Outcome, AppError> {
    // AD-4's message identity. Applied, parked and quarantined all count as handled: re-folding an
    // applied delta would double it, and out-of-order arrival across installs is safe because every
    // merge rule here is commutative.
    if record && apply_db::is_recorded(conn, install, seq, idx)? {
        return Ok(Outcome::Skipped);
    }

    let stored = remembered_message(install, seq, idx, message, record);

    let Ok(hlc) = Hlc::decode(&message.hlc) else {
        apply_db::quarantine(conn, &stored, "malformed_payload", None)?;
        return Ok(Outcome::Quarantined);
    };

    // AD-4: a stamp more than five minutes ahead does NOT move this computer's clock. The message
    // is still applied — refusing it would be data loss and its `hlc` still orders totally. What
    // the refusal costs the remote stamp is the right to move THIS clock, and `Clock` remembers it
    // so the actor can surface `clock_skew` (Story 24) and the user can fix the date and time.
    if let Err(error) = clock.observe(&hlc) {
        warn!("a remote message carried a stamp this computer refused: {}", error);
    }

    let Some(rule) = registry::table(&message.table_name) else {
        apply_db::quarantine(conn, &stored, "unknown_table", None)?;
        return Ok(Outcome::Quarantined);
    };
    if matches!(rule.class, TableClass::LocalOnly) {
        apply_db::quarantine(conn, &stored, "unknown_table", None)?;
        return Ok(Outcome::Quarantined);
    }

    let tombstoned = apply_db::tombstone(conn, rule.table, &message.row_uuid)?;

    match message.kind {
        MessageKind::Tombstone => apply_tombstone(conn, rule, message, &stored),
        MessageKind::Field => {
            // A tombstone is ABSORBING per identity (AD-5, AD-12): an upsert of any clock value
            // after it is dropped, which is sound for a SURROGATE row precisely because AD-2 drops
            // the uuid mapping with the tombstone, so a re-insert is a new identity rather than a
            // resurrection. A DERIVED identity has no such escape — its uuid is a function of its
            // key — so for those a RE-CREATION stamped after the delete revives the row instead.
            if let Some(tombstone) = &tombstoned {
                if !revives(rule, message, tombstone)? {
                    apply_db::record_applied(conn, &stored)?;

                    return Ok(Outcome::Dropped);
                }

                apply_db::delete_tombstone(conn, rule.table, &message.row_uuid)?;
            }

            apply_field(conn, rule.table, rule.class, message, &stored)
        }
        MessageKind::CounterDelta => {
            if tombstoned.is_some() {
                apply_db::record_applied(conn, &stored)?;

                return Ok(Outcome::Dropped);
            }

            apply_counter(conn, rule.table, message, &stored)
        }
        MessageKind::BalanceSet | MessageKind::BalanceDelta => {
            apply_balance(conn, rule.table, message, &stored, tombstoned.is_some())
        }
    }
}

/// Whether a message revives a tombstoned row.
///
/// For a SURROGATE identity: never. AD-2 drops the uuid mapping with the tombstone, so a row the
/// user re-creates comes back under a new identity and nothing addressed to the dead one may land.
///
/// For a DERIVED identity (AD-2: a natural key or a template period) the uuid is a FUNCTION of the
/// key, so the same logical row re-created anywhere carries the same uuid again — an absorbing
/// tombstone would make it un-restorable and un-regenerable forever. The rule is therefore LWW
/// against a RE-CREATION only: a whole-row message, which capture emits for an INSERT and never for
/// an edit, stamped after the delete. A partial edit is still absorbed, so AD-5's "delete wins over
/// concurrent edits" is untouched. Both halves of the rule read only the message set, so every
/// replica reaches the same answer whatever the arrival order.
fn revives(
    rule: &registry::TableRule,
    message: &SegmentMessage,
    tombstone: &apply_db::TombstoneRow,
) -> Result<bool, AppError> {
    if !has_derived_identity(rule) || message.hlc <= tombstone.hlc {
        return Ok(false);
    }

    let Some(cells) = decode_cells(message) else {
        return Ok(false);
    };

    Ok(is_whole_row(rule.table, &cells))
}

/// A derived uuid cannot be re-minted, which is what makes the absorbing rule unsound for it.
///
/// `SurrogateOrTemplate` (`expenses`, `income_entries`) is covered too, and the reason it is SAFE
/// to cover a table that also holds hand-entered rows is the shape of the message rather than the
/// table: [`is_whole_row`] is only ever an INSERT — capture emits every column on an insert and
/// only the CHANGED ones on an update, and an update never carries the `Immutable` columns at all —
/// while a surrogate row the user re-creates mints a FRESH UUIDv4 (AD-2). So a whole-row message
/// under a uuid a tombstone already claims, stamped after it, cannot be a hand-entered row coming
/// back: it is a recurring occurrence that every computer regenerates from the same template under
/// the same derived uuid. Delete-wins over concurrent EDITS is untouched, because a partial field
/// message is still absorbed.
///
/// DELIBERATE DEVIATION from story 21's proposed fix (re-derive
/// `identity::recurring_{expense,income}` inside apply and treat a match as derived), recorded in
/// the ledger: that derivation needs the TEMPLATE row to exist locally, so the revive decision
/// would depend on local state and two replicas could reach opposite answers about the same message
/// and diverge forever. This rule reads only the message, which is what makes every replica agree.
fn has_derived_identity(rule: &registry::TableRule) -> bool {
    matches!(
        rule.identity,
        Some(RowIdentity::Natural | RowIdentity::SurrogateOrTemplate)
    )
}

/// Whether a field message carries the whole row — every column capture emits for an INSERT.
fn is_whole_row(table: &str, cells: &[(String, Vec<u8>)]) -> bool {
    registry::columns_of(table)
        .filter(|column| travels_in_a_field_message(table, column))
        .all(|column| cells.iter().any(|(name, _)| name == column.column))
}

fn travels_in_a_field_message(table: &str, column: &registry::ColumnRule) -> bool {
    match column.merge {
        MergeKind::Lww | MergeKind::Immutable => true,
        MergeKind::LocalId => registry::fk_parent(table, column.column).is_some(),
        MergeKind::Counter | MergeKind::Balance | MergeKind::Excluded => false,
    }
}

/// When the live row was created, as the OLDEST `hlc` any of its columns was accepted under.
///
/// A whole-row insert stamps every column with one `hlc`, so the minimum is that stamp; a later
/// edit only raises individual columns. It is therefore the stamp a tombstone has to beat for the
/// delete to still describe the row that is there now.
fn creation_hlc(
    conn: &Connection,
    table: &str,
    row_uuid: &[u8; 16],
) -> Result<Option<String>, AppError> {
    let oldest = sync_capture::field_state_columns(conn, table, row_uuid)?
        .into_iter()
        .map(|(_, state)| state.hlc)
        .min();

    Ok(oldest)
}

/// AD-5's per-column last-write-wins, with the row created on first sight.
fn apply_field(
    conn: &Connection,
    table: &'static str,
    class: TableClass,
    message: &SegmentMessage,
    stored: &AppliedMessage<'_>,
) -> Result<Outcome, AppError> {
    let Some(cells) = decode_cells(message) else {
        apply_db::quarantine(conn, stored, "malformed_payload", None)?;
        return Ok(Outcome::Quarantined);
    };

    let row_id = sync_identity::row_id_for(conn, table, &message.row_uuid)?;

    // AD-5: `audit_log` is append-only, so an edit from another computer describes a row that
    // cannot change. Recorded and dropped rather than written.
    if matches!(class, TableClass::AppendOnly) && row_id.is_some() {
        apply_db::record_applied(conn, stored)?;
        return Ok(Outcome::Dropped);
    }

    let mut accepted: Vec<(&'static str, Value)> = Vec::with_capacity(cells.len());
    let mut states: Vec<(String, ColumnState)> = Vec::with_capacity(cells.len());

    for (name, encoded) in &cells {
        let Some(column) = registry::column_rule(table, name) else {
            apply_db::quarantine(conn, stored, "unknown_column", None)?;
            return Ok(Outcome::Quarantined);
        };

        let value = match column.merge {
            // A counter's value is the sum of its deltas and a balance is its own fold, so neither
            // travels in a field message; image bytes never travel at all (AD-10).
            MergeKind::Counter | MergeKind::Balance | MergeKind::Excluded => continue,
            MergeKind::LocalId => {
                let Some(parent) = registry::fk_parent(table, column.column) else {
                    continue;
                };

                match translate_parent(conn, parent, encoded)? {
                    ParentReference::Resolved(value) => value,
                    ParentReference::Missing(row_uuid) => {
                        return Ok(Outcome::Parked {
                            table: parent,
                            row_uuid,
                        })
                    }
                    // AD-12: a child message addressed to a tombstoned parent is dropped, never
                    // parked — parking it would wait for a row that is not coming back. The child
                    // is tombstoned WITH it: the cascade that killed it ran on a computer that
                    // never had this row, so no tombstone message for it exists anywhere, and
                    // without one every later message about it would park forever.
                    ParentReference::ParentTombstoned(parent_uuid) => {
                        if let Some(parent_tombstone) =
                            apply_db::tombstone(conn, parent, &parent_uuid)?
                        {
                            apply_db::record_tombstone(
                                conn,
                                table,
                                &message.row_uuid,
                                &parent_tombstone.hlc,
                                &parent_tombstone.install,
                                &cells_as_json(table, &cells),
                                TOMBSTONE_RETENTION_DAYS,
                            )?;
                        }
                        apply_db::record_applied(conn, stored)?;

                        return Ok(Outcome::Dropped);
                    }
                    ParentReference::Malformed => {
                        apply_db::quarantine(conn, stored, "malformed_payload", None)?;
                        return Ok(Outcome::Quarantined);
                    }
                }
            }
            MergeKind::Lww | MergeKind::Immutable => match payload::decode(encoded) {
                Ok(value) => value,
                Err(_) => {
                    apply_db::quarantine(conn, stored, "malformed_payload", None)?;
                    return Ok(Outcome::Quarantined);
                }
            },
        };

        if !sync_capture::field_state_accepts(
            conn,
            table,
            &message.row_uuid,
            column.column,
            &message.hlc,
        )? {
            continue;
        }

        accepted.push((column.column, value));
        states.push((
            column.column.to_string(),
            ColumnState {
                hlc: message.hlc.clone(),
                content_hash: content_hash(encoded),
            },
        ));
    }

    match row_id {
        Some(row_id) => apply_db::update_row(conn, table, row_id, &accepted)?,
        None => {
            if accepted.is_empty() {
                apply_db::record_applied(conn, stored)?;
                return Ok(Outcome::Dropped);
            }

            // A message carrying only SOME of a row's columns cannot create it: the schema's own
            // `NOT NULL`/`CHECK` refuses. That is a legal out-of-order arrival (AD-11) — the
            // creating message is still on its way — so it waits for its own identity instead of
            // being quarantined.
            if let Err(error) = create_row(conn, table, &message.row_uuid, accepted) {
                warn!("a remote row could not be created yet, parking its message: {}", error);

                return Ok(Outcome::Parked {
                    table,
                    row_uuid: message.row_uuid,
                });
            }
        }
    }

    sync_capture::upsert_field_states(conn, table, &message.row_uuid, &states)?;
    apply_db::record_applied(conn, stored)?;

    Ok(Outcome::Applied)
}

/// Creates a row on first sight, in a savepoint so a constraint refusal parks the message instead
/// of failing the transaction, and binds the identity the message named (AD-2).
fn create_row(
    conn: &Connection,
    table: &'static str,
    row_uuid: &[u8; 16],
    mut columns: Vec<(&'static str, Value)>,
) -> Result<(), AppError> {
    for column in registry::columns_of(table) {
        match column.merge {
            // Story 16: a counter's base is ZERO and a row's creation travels as its first delta,
            // so a row created here starts at the sum of whatever deltas have already arrived.
            MergeKind::Counter => columns.push((
                column.column,
                Value::Integer(counter_total(conn, table, row_uuid, column.column)?),
            )),
            MergeKind::Balance => columns.push((
                column.column,
                Value::Integer(balance_value(conn, table, row_uuid)?),
            )),
            _ => {}
        }
    }

    // An audit row's `entity_id` is a machine-local integer that does not travel (it is not a
    // foreign key, so AD-2's translation cannot reach it), and the schema makes it NOT NULL. Left
    // out, no audit row could ever be created from another computer — every one parked for a row
    // that was never coming. It is rebuilt here from `entity_uuid`, the same fact in uuid space.
    if table == "audit_log" && !columns.iter().any(|(name, _)| *name == "entity_id") {
        let entity_id = audit_entity_id(conn, &columns)?;
        columns.push(("entity_id", Value::Integer(entity_id)));
    }

    in_savepoint(conn, INSERT_SAVEPOINT, |conn| {
        let row_id = apply_db::insert_row(conn, table, &columns)?;

        // `sync_identity::ensure` is first-writer-wins on both keys, so a stale mapping left on a
        // REUSED rowid would hand back the wrong row and this identity would never bind. Capture
        // drops a mapping with its tombstone and so does this module, which makes that case
        // impossible; dropping it here first is what keeps the claim from being load-bearing.
        sync_identity::forget(conn, table, row_id)?;
        let mapping = sync_identity::ensure(conn, table, row_id, row_uuid)?;
        if mapping.row_id != row_id {
            return Err(AppError::Database {
                message: format!("a remote {table} row collided with an existing identity"),
            });
        }

        Ok(())
    })
}

/// The local id of the row an audit entry describes, or 0.
///
/// 0 is the audit convention for "no single entity" (`import`, `budget_template`, the AI chat
/// actions), and it is also the honest answer for an entity this computer does not hold — one that
/// was deleted before the entry arrived, or that has not arrived yet. The entry still belongs to the
/// shared action log; it just cannot be filed under a row that is not here.
fn audit_entity_id(
    conn: &Connection,
    columns: &[(&'static str, Value)],
) -> Result<i64, AppError> {
    let entity_type = columns.iter().find_map(|(name, value)| match value {
        Value::Text(text) if *name == "entity_type" => Some(text.as_str()),
        _ => None,
    });
    let entity_uuid = columns.iter().find_map(|(name, value)| match value {
        Value::Blob(bytes) if *name == "entity_uuid" => <[u8; 16]>::try_from(bytes.as_slice()).ok(),
        _ => None,
    });

    let (Some(entity_type), Some(entity_uuid)) = (entity_type, entity_uuid) else {
        return Ok(0);
    };
    let Some(table) = crate::db::audit::entity_table(entity_type) else {
        return Ok(0);
    };

    Ok(sync_identity::row_id_for(conn, table, &entity_uuid)?.unwrap_or(0))
}

enum ParentReference {
    Resolved(Value),
    Missing([u8; 16]),
    ParentTombstoned([u8; 16]),
    Malformed,
}

/// AD-2: a foreign key travels as the PARENT'S uuid and is translated back into this computer's
/// integer id. A NULL stays NULL, which is what the `SET NULL` edges replay as (AD-12).
fn translate_parent(
    conn: &Connection,
    parent: &'static str,
    encoded: &[u8],
) -> Result<ParentReference, AppError> {
    let Ok(value) = payload::decode(encoded) else {
        return Ok(ParentReference::Malformed);
    };

    let bytes = match value {
        Value::Null => return Ok(ParentReference::Resolved(Value::Null)),
        Value::Blob(bytes) => bytes,
        _ => return Ok(ParentReference::Malformed),
    };
    let Ok(row_uuid) = <[u8; 16]>::try_from(bytes.as_slice()) else {
        return Ok(ParentReference::Malformed);
    };

    if let Some(row_id) = sync_identity::row_id_for(conn, parent, &row_uuid)? {
        return Ok(ParentReference::Resolved(Value::Integer(row_id)));
    }
    if apply_db::tombstone(conn, parent, &row_uuid)?.is_some() {
        return Ok(ParentReference::ParentTombstoned(row_uuid));
    }

    Ok(ParentReference::Missing(row_uuid))
}

/// AD-5's counter: its value is the sum of the recorded deltas, so applying one is recording it and
/// then rewriting the column from the log.
fn apply_counter(
    conn: &Connection,
    table: &'static str,
    message: &SegmentMessage,
    stored: &AppliedMessage<'_>,
) -> Result<Outcome, AppError> {
    let column = message
        .column_name
        .as_deref()
        .and_then(|column| registry::column_rule(table, column))
        .filter(|column| matches!(column.merge, MergeKind::Counter));
    let Some(column) = column else {
        apply_db::quarantine(conn, stored, "unknown_column", None)?;
        return Ok(Outcome::Quarantined);
    };
    if decoded_cents(message.payload.as_deref()).is_none() {
        apply_db::quarantine(conn, stored, "malformed_payload", None)?;
        return Ok(Outcome::Quarantined);
    }

    apply_db::record_applied(conn, stored)?;

    // A delta for a row that has not arrived is KEPT, not parked: the row is created from the sum of
    // whatever is recorded, so the increment is neither lost nor applied twice.
    refold_counter(conn, table, &message.row_uuid, column.column)?;

    Ok(Outcome::Applied)
}

/// Writes a counter column's folded value, wherever the message that moved it came from.
pub(crate) fn refold_counter(
    conn: &Connection,
    table: &'static str,
    row_uuid: &[u8; 16],
    column: &'static str,
) -> Result<(), AppError> {
    if let Some(row_id) = sync_identity::row_id_for(conn, table, row_uuid)? {
        let total = counter_total(conn, table, row_uuid, column)?;
        apply_db::set_folded_value(conn, table, row_id, column, total)?;
    }

    Ok(())
}

/// AD-5's balance: the latest `balance_set` by `hlc` plus every delta stamped after it, folded by
/// the one implementation of that rule. A delta is added VERBATIM and never recomputed.
fn apply_balance(
    conn: &Connection,
    table: &'static str,
    message: &SegmentMessage,
    stored: &AppliedMessage<'_>,
    tombstoned: bool,
) -> Result<Outcome, AppError> {
    let Some(column) = balance_column(table) else {
        apply_db::quarantine(conn, stored, "unknown_column", None)?;
        return Ok(Outcome::Quarantined);
    };
    if decoded_cents(message.payload.as_deref()).is_none() {
        apply_db::quarantine(conn, stored, "malformed_payload", None)?;
        return Ok(Outcome::Quarantined);
    }

    // AD-5, fix F4: the fold is the whole truth only for a row that has published a BASE. A row
    // that predates capture holds its opening balance in the COLUMN and nothing about it in the
    // log, so folding a remote delta over base zero would replace a real opening balance with the
    // sum of the deltas — exactly the trap `refold_emitted_balances` guards against locally (fix
    // F1). The part of the column the log has never described is carried as an OFFSET
    // (`column - fold without this message`, which is the opening balance by induction), so a
    // delta is additive until Story 22's reconcile publishes a base and the fold takes over. Both
    // halves stay a pure function of the log plus that offset, so a replay re-folds to the same
    // number and a duplicated cause is still counted once.
    let described = balance_value(conn, table, &message.row_uuid)?;
    apply_db::record_applied(conn, stored)?;
    let ledger = balance_ledger(conn, table, &message.row_uuid)?;
    let folded = ledger.value();
    let based = ledger.has_base();
    let resolved = move |current: i64| {
        if based {
            folded
        } else {
            current.wrapping_sub(described).wrapping_add(folded)
        }
    };

    // AD-12: a delta addressed to an already-deleted account is added to the row retained in
    // `sync_tombstone`, so a restore brings back the balance the other computers agree on.
    if tombstoned {
        retain_balance_in_tombstone(conn, table, &message.row_uuid, column, resolved)?;

        return Ok(Outcome::Applied);
    }

    if let Some(row_id) = sync_identity::row_id_for(conn, table, &message.row_uuid)? {
        let current = apply_db::read_columns(conn, table, row_id, &[column])?
            .into_iter()
            .find_map(|(_, value)| match value {
                Value::Integer(cents) => Some(cents),
                _ => None,
            })
            .unwrap_or(0);
        apply_db::set_folded_value(conn, table, row_id, column, resolved(current))?;
    }

    Ok(Outcome::Applied)
}

/// Writes an account's folded balance, wherever the message that moved it came from.
///
/// THE one code path for the balance column, and the reason it is `pub(crate)`: `sync::capture`
/// calls it in the same transaction as a LOCAL emission (AD-5, fix F1). A local emitter adding its
/// own delta straight to the column is only right until a second computer emits the SAME cause —
/// the cause-keyed fold then keeps the minimum-HLC copy, which an intervening `balance_set` may
/// absorb, and a column that was accumulated per write cannot reach that conclusion.
pub(crate) fn refold_balance(
    conn: &Connection,
    table: &'static str,
    row_uuid: &[u8; 16],
    require_base: bool,
) -> Result<(), AppError> {
    if let Some(row_id) = sync_identity::row_id_for(conn, table, row_uuid)? {
        let Some(column) = balance_column(table) else {
            return Ok(());
        };
        let ledger = balance_ledger(conn, table, row_uuid)?;
        if require_base && !ledger.has_base() {
            return Ok(());
        }
        apply_db::set_folded_value(conn, table, row_id, column, ledger.value())?;
    }

    Ok(())
}

/// Re-folds every balance and every counter the log knows about.
///
/// What a FILE SWAP needs, and the half AD-9 left implicit. A restore takes its table values from
/// someone else's snapshot while keeping this computer's own `sync_log` rows beside them, and a
/// clone/`replace` DROPS unsent rows out of a log whose effects are still in the columns. In both
/// cases the column and the log stop agreeing for every row no later message happens to touch, so
/// the fold is re-driven for all of them rather than for the ones that were replayed.
pub fn refold_increments(conn: &Connection) -> Result<usize, AppError> {
    let mut refolded = 0;

    for (table, row_uuid) in apply_db::balance_rows(conn)? {
        let (Some(rule), Ok(row_uuid)) = (
            registry::table(&table),
            <[u8; 16]>::try_from(row_uuid.as_slice()),
        ) else {
            continue;
        };
        refold_balance(conn, rule.table, &row_uuid, true)?;
        refolded += 1;
    }

    for (table, row_uuid, column) in apply_db::counter_rows(conn)? {
        let (Some(rule), Some(column), Ok(row_uuid)) = (
            registry::table(&table),
            registry::column_rule(&table, &column)
                .filter(|column| matches!(column.merge, MergeKind::Counter)),
            <[u8; 16]>::try_from(row_uuid.as_slice()),
        ) else {
            continue;
        };
        refold_counter(conn, rule.table, &row_uuid, column.column)?;
        refolded += 1;
    }

    Ok(refolded)
}

/// `db::sync_capture::discard_unsent` plus the re-fold it leaves owed (AD-5, fix F1).
///
/// The two CAP-5 paths that drop this computer's unsent tail — a `replace` link choice and
/// `load_remote` — delete balance and counter deltas whose effect is still in the columns the swap
/// brought in. Without the re-fold those columns stay ahead of the log until some later message
/// re-folds them, and then silently jump.
pub fn discard_unsent_and_refold(conn: &Connection) -> Result<usize, AppError> {
    in_transaction(conn, false, |conn| {
        let dropped = sync_capture::discard_unsent(conn)?;
        refold_increments(conn)?;

        Ok(dropped)
    })
}

fn retain_balance_in_tombstone(
    conn: &Connection,
    table: &'static str,
    row_uuid: &[u8; 16],
    column: &'static str,
    value: impl FnOnce(i64) -> i64,
) -> Result<(), AppError> {
    let Some(tombstone) = apply_db::tombstone(conn, table, row_uuid)? else {
        return Ok(());
    };
    let Ok(serde_json::Value::Object(mut row)) =
        serde_json::from_str::<serde_json::Value>(&tombstone.row_json)
    else {
        return Ok(());
    };

    let retained = row
        .get(column)
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    row.insert(column.to_string(), serde_json::Value::from(value(retained)));
    let document = serde_json::Value::Object(row).to_string();
    apply_db::set_tombstone_row_json(conn, table, row_uuid, &document)?;

    Ok(())
}

/// AD-5/AD-12's delete: the full row is retained for a restore, the local row is deleted so the
/// schema's own `CASCADE` and `SET NULL` run, and every mapping that went with it is dropped.
fn apply_tombstone(
    conn: &Connection,
    rule: &registry::TableRule,
    message: &SegmentMessage,
    stored: &AppliedMessage<'_>,
) -> Result<Outcome, AppError> {
    let table = rule.table;
    let Some(row_json) = decoded_text(message.payload.as_deref()) else {
        apply_db::quarantine(conn, stored, "malformed_payload", None)?;
        return Ok(Outcome::Quarantined);
    };
    if serde_json::from_str::<serde_json::Value>(&row_json)
        .ok()
        .filter(serde_json::Value::is_object)
        .is_none()
    {
        apply_db::quarantine(conn, stored, "malformed_payload", None)?;
        return Ok(Outcome::Quarantined);
    }

    let row_id = sync_identity::row_id_for(conn, table, &message.row_uuid)?;

    // The other half of the derived-identity rule in [`revives`]: a row re-created AFTER this
    // delete is not the row this delete describes, so the delete loses and leaves no tombstone
    // behind — which is what makes the two halves agree whichever message arrives first.
    if row_id.is_some() && has_derived_identity(rule) {
        if let Some(created) = creation_hlc(conn, table, &message.row_uuid)? {
            if created > message.hlc {
                apply_db::record_applied(conn, stored)?;

                return Ok(Outcome::Dropped);
            }
        }
    }

    // AD-12's one `RESTRICT` edge: a live child WINS and the parent's tombstone is overridden. It is
    // parked rather than dropped, so the delete still happens on the day the child's own tombstone
    // arrives — which is what keeps two computers from disagreeing forever.
    if let Some(row_id) = row_id {
        if let Some(blocked) = restrict_blocker(conn, table, row_id)? {
            return Ok(blocked);
        }
    }

    let install = Hlc::decode(&message.hlc)
        .map(|hlc| hlc.install().hex())
        .unwrap_or_else(|_| stored.install.to_string());
    apply_db::record_tombstone(
        conn,
        table,
        &message.row_uuid,
        &message.hlc,
        &install,
        &row_json,
        TOMBSTONE_RETENTION_DAYS,
    )?;

    if let Some(row_id) = row_id {
        let cascaded = cascaded_rows(conn, table, row_id)?;

        // Each cascaded child gets its OWN tombstone before the cascade removes it. The origin
        // computer captured one too and its copy wins by the lower `hlc`, but it may never arrive:
        // a computer that deleted the parent without ever having this child could not capture a
        // message about it, and a child with no tombstone would absorb nothing and park every later
        // message about it forever.
        for (child_table, child_row_id) in &cascaded {
            let child_json = row_as_json(conn, child_table, *child_row_id)?;
            if let Some(child_uuid) = sync_identity::lookup(conn, child_table, *child_row_id)? {
                apply_db::record_tombstone(
                    conn,
                    child_table,
                    &child_uuid,
                    &message.hlc,
                    &install,
                    &child_json,
                    TOMBSTONE_RETENTION_DAYS,
                )?;
            }
        }

        apply_db::delete_row(conn, table, row_id)?;

        // AD-2: a mapping is dropped with its tombstone, because the data tables are
        // `INTEGER PRIMARY KEY` without `AUTOINCREMENT` and a surviving mapping would let a reused
        // rowid inherit a deleted row's identity. The cascade took the children with it, so their
        // mappings go too; each child's OWN tombstone message carries its full row for a restore.
        for (child_table, child_row_id) in cascaded {
            if let Some(child_uuid) = sync_identity::lookup(conn, child_table, child_row_id)? {
                sync_capture::forget_field_state(conn, child_table, &child_uuid)?;
            }
            sync_identity::forget(conn, child_table, child_row_id)?;
        }
        sync_capture::forget_field_state(conn, table, &message.row_uuid)?;
        sync_identity::forget(conn, table, row_id)?;
    }

    apply_db::record_applied(conn, stored)?;

    Ok(Outcome::Applied)
}

/// A partial row for a child this computer never held, so its tombstone is still a JSON object and
/// a later message about it is absorbed. Only what the message carried can be in it.
fn cells_as_json(table: &str, cells: &[(String, Vec<u8>)]) -> String {
    let mut row = serde_json::Map::new();

    for (name, encoded) in cells {
        let Some(column) = registry::column_rule(table, name) else {
            continue;
        };
        if matches!(column.merge, MergeKind::Excluded) {
            continue;
        }
        if let Ok(value) = payload::decode(encoded) {
            row.insert(column.column.to_string(), json_scalar(&value));
        }
    }

    serde_json::Value::Object(row).to_string()
}

/// The local row of a cascaded child, in the same self-describing shape capture renders a tombstone
/// in: local integers out, foreign keys as the parent's uuid (AD-2), blobs as hex.
fn row_as_json(conn: &Connection, table: &'static str, row_id: i64) -> Result<String, AppError> {
    let columns: Vec<&'static str> = registry::columns_of(table)
        .filter(|column| !matches!(column.merge, MergeKind::Excluded))
        .map(|column| column.column)
        .collect();

    let mut row = serde_json::Map::new();
    for (column, value) in apply_db::read_columns(conn, table, row_id, &columns)? {
        let rendered = match (registry::fk_parent(table, column), &value) {
            (Some(parent), Value::Integer(parent_row_id)) => {
                match sync_identity::lookup(conn, parent, *parent_row_id)? {
                    Some(parent_uuid) => serde_json::Value::String(hex(&parent_uuid)),
                    None => serde_json::Value::Null,
                }
            }
            _ if matches!(registry::merge_kind(table, column), Some(MergeKind::LocalId)) => continue,
            _ => json_scalar(&value),
        };
        row.insert(column.to_string(), rendered);
    }

    Ok(serde_json::Value::Object(row).to_string())
}

fn json_scalar(value: &Value) -> serde_json::Value {
    match value {
        Value::Null => serde_json::Value::Null,
        Value::Integer(number) => serde_json::Value::from(*number),
        Value::Real(number) => serde_json::Number::from_f64(*number)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        Value::Text(text) => serde_json::Value::String(text.clone()),
        Value::Blob(bytes) => serde_json::Value::String(hex(bytes)),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The first live child on a `RESTRICT` edge, as the parked outcome that waits for it.
fn restrict_blocker(
    conn: &Connection,
    table: &'static str,
    row_id: i64,
) -> Result<Option<Outcome>, AppError> {
    for edge in registry::edges_into(table) {
        if !matches!(edge.policy, FkPolicy::Restrict) {
            continue;
        }

        let children = apply_db::child_row_ids(conn, edge.child_table, edge.child_column, row_id)?;
        if let Some(child) = children.first() {
            // A child with no identity predates capture (Story 22's reconcile owns those). The
            // tombstone then waits on the zero uuid, which no row ever has, so it is re-driven by
            // the drain rounds of later batches rather than by that child's arrival.
            let row_uuid = sync_identity::lookup(conn, edge.child_table, *child)?.unwrap_or([0; 16]);

            return Ok(Some(Outcome::Parked {
                table: edge.child_table,
                row_uuid,
            }));
        }
    }

    Ok(None)
}

/// Every row the schema's `ON DELETE CASCADE` will take with this one, transitively.
fn cascaded_rows(
    conn: &Connection,
    table: &'static str,
    row_id: i64,
) -> Result<Vec<(&'static str, i64)>, AppError> {
    let mut found = Vec::new();
    let mut seen: HashSet<(&'static str, i64)> = HashSet::new();
    let mut frontier = vec![(table, row_id)];

    while let Some((parent_table, parent_row_id)) = frontier.pop() {
        for edge in registry::edges_into(parent_table) {
            if !matches!(edge.policy, FkPolicy::Cascade) {
                continue;
            }

            for child in
                apply_db::child_row_ids(conn, edge.child_table, edge.child_column, parent_row_id)?
            {
                if seen.insert((edge.child_table, child)) {
                    found.push((edge.child_table, child));
                    frontier.push((edge.child_table, child));
                }
            }
        }
    }

    Ok(found)
}

/// Re-materializes this computer's own unsent messages into a file a snapshot has just replaced
/// (AD-9: "unsent `sync_log` rows re-applied after").
///
/// Recording is OFF for every one of them, which is what makes this safe to run: the rows are
/// already in `sync_log` with `seq IS NULL` and must stay exactly there so the next cycle ships
/// them, so nothing is written to `sync_log`, `sync_pending` or `sync_quarantine` and no delta can
/// be folded twice. A message that cannot be applied yet is therefore COUNTED and left unsent
/// rather than parked — the row it names is not in the snapshot and no local retry can conjure it,
/// while shipping it still gets the change to every other computer.
pub fn replay_own_unsent(
    conn: &Connection,
    clock: &Clock,
    install: &str,
) -> Result<ApplyReport, AppError> {
    // Before the replay, and unconditionally: the snapshot's own balances and counters were folded
    // from the log of the computer that WROTE it, which does not hold this computer's rows. Rows no
    // unsent message happens to name would otherwise keep that stale value for good (fix F1).
    in_transaction(conn, false, refold_increments)?;

    let rows = crate::db::sync_segment::unshipped(conn, install, REPLAY_MAX_MESSAGES)?;
    if rows.is_empty() {
        return Ok(ApplyReport::default());
    }

    let mut report = ApplyReport::default();
    for chunk in rows.chunks(APPLY_MAX_MESSAGES) {
        let applied = in_transaction(conn, true, |conn| {
            let mut chunk_report = ApplyReport::default();
            for (idx, row) in chunk.iter().enumerate() {
                let Ok(message) = super::segment::wire_message(row.clone()) else {
                    chunk_report.quarantined += 1;
                    continue;
                };
                match apply_message(conn, clock, install, 0, idx as i64, &message, false)? {
                    Outcome::Applied => chunk_report.applied += 1,
                    Outcome::Dropped => chunk_report.dropped += 1,
                    Outcome::Skipped => chunk_report.skipped += 1,
                    Outcome::Quarantined => chunk_report.quarantined += 1,
                    Outcome::Parked { .. } => chunk_report.parked += 1,
                }
            }

            Ok(chunk_report)
        })?;
        report.add(applied);
    }

    Ok(report)
}

/// Re-drives the parking queue until it stops making progress (AD-11).
fn drain_parked(conn: &Connection, clock: &Clock) -> Result<ApplyReport, AppError> {
    let mut report = ApplyReport::default();

    for _ in 0..PENDING_DRAIN_ROUNDS {
        let queued = apply_db::parked(conn)?;
        if queued.is_empty() {
            break;
        }

        let mut progressed = false;
        for parked in queued {
            let install = parked.install.clone();
            let (seq, idx) = (parked.seq, parked.idx);
            let Some(message) = parked_as_message(&parked) else {
                apply_db::forget_parked(conn, parked.id)?;
                report.quarantined += 1;
                progressed = true;
                continue;
            };

            // Taken OUT of the queue before the retry, or `is_recorded` would find its own row and
            // the retry would be a no-op forever.
            apply_db::forget_parked(conn, parked.id)?;

            let attempt = in_savepoint(conn, RETRY_SAVEPOINT, |conn| {
                apply_message(conn, clock, &install, seq, idx, &message, true)
            });

            match attempt {
                Ok(Outcome::Parked { table, row_uuid }) => apply_db::park(
                    conn,
                    &stored_message(&install, seq, idx, &message),
                    table,
                    &row_uuid,
                )?,
                Ok(Outcome::Applied) => {
                    report.applied += 1;
                    progressed = true;
                }
                Ok(Outcome::Dropped | Outcome::Skipped) => {
                    report.dropped += 1;
                    progressed = true;
                }
                Ok(Outcome::Quarantined) => {
                    report.quarantined += 1;
                    progressed = true;
                }
                Err(error) => {
                    warn!("a parked sync message was quarantined on retry: {}", error);
                    apply_db::quarantine(
                        conn,
                        &stored_message(&install, seq, idx, &message),
                        "constraint_violation",
                        None,
                    )?;
                    report.quarantined += 1;
                    progressed = true;
                }
            }
        }

        if !progressed {
            break;
        }
    }

    Ok(report)
}

/// The bound on parking: a message still waiting after [`PENDING_GIVE_UP_DAYS`] is quarantined with
/// a reason instead of waiting forever.
fn give_up_on_stale_parked(conn: &Connection) -> Result<usize, AppError> {
    let stale = apply_db::parked_before(conn, PENDING_GIVE_UP_DAYS)?;
    let mut given_up = 0;

    for parked in stale {
        if let Some(message) = parked_as_message(&parked) {
            apply_db::quarantine(
                conn,
                &stored_message(&parked.install, parked.seq, parked.idx, &message),
                "apply_failed",
                None,
            )?;
        }
        apply_db::forget_parked(conn, parked.id)?;
        given_up += 1;
    }

    Ok(given_up)
}

fn parked_as_message(parked: &apply_db::ParkedMessage) -> Option<SegmentMessage> {
    Some(SegmentMessage {
        hlc: parked.hlc.clone(),
        kind: MessageKind::parse(&parked.kind)?,
        table_name: parked.table_name.clone(),
        row_uuid: <[u8; 16]>::try_from(parked.row_uuid.as_slice()).ok()?,
        column_name: parked.column_name.clone(),
        cause_uuid: parked
            .cause_uuid
            .as_ref()
            .and_then(|cause| <[u8; 16]>::try_from(cause.as_slice()).ok()),
        payload: parked.payload.clone(),
    })
}

/// A field message's columns, still encoded. One message carries the whole changed row
/// (`ROW_COLUMN_MARKER`, Story 15); the single-column form is still decoded, because the kind
/// permits it and refusing it would be a silent drop.
fn decode_cells(message: &SegmentMessage) -> Option<Vec<(String, Vec<u8>)>> {
    let payload = message.payload.as_deref()?;

    match message.column_name.as_deref()? {
        ROW_COLUMN_MARKER => payload::decode_row(payload).ok(),
        column => Some(vec![(column.to_string(), payload.to_vec())]),
    }
}

fn decoded_cents(payload: Option<&[u8]>) -> Option<i64> {
    match payload::decode(payload?) {
        Ok(Value::Integer(cents)) => Some(cents),
        _ => None,
    }
}

fn decoded_text(payload: Option<&[u8]>) -> Option<String> {
    match payload::decode(payload?) {
        Ok(Value::Text(text)) => Some(text),
        _ => None,
    }
}

fn balance_column(table: &str) -> Option<&'static str> {
    registry::columns_of(table)
        .find(|column| matches!(column.merge, MergeKind::Balance))
        .map(|column| column.column)
}

pub(crate) fn counter_total(
    conn: &Connection,
    table: &str,
    row_uuid: &[u8; 16],
    column: &str,
) -> Result<i64, AppError> {
    let mut total: i64 = 0;
    for encoded in apply_db::counter_deltas(conn, table, row_uuid, column)? {
        if let Some(delta) = decoded_cents(Some(&encoded)) {
            total = total.wrapping_add(delta);
        }
    }

    Ok(total)
}

/// The fold AD-5 defines, over every balance message this computer holds for the row — its own and
/// every other computer's.
pub(crate) fn balance_value(conn: &Connection, table: &str, row_uuid: &[u8; 16]) -> Result<i64, AppError> {
    Ok(balance_ledger(conn, table, row_uuid)?.value())
}

fn balance_ledger(
    conn: &Connection,
    table: &str,
    row_uuid: &[u8; 16],
) -> Result<BalanceLedger<[u8; 16]>, AppError> {
    let mut ledger: BalanceLedger<[u8; 16]> = BalanceLedger::default();

    for logged in apply_db::balance_messages(conn, table, row_uuid)? {
        let Ok(hlc) = Hlc::decode(&logged.hlc) else {
            continue;
        };
        let Some(cents) = decoded_cents(logged.payload.as_deref()) else {
            continue;
        };

        match (logged.kind.as_str(), logged.cause_uuid) {
            ("balance_set", _) => ledger.observe_set(hlc, cents, false),
            ("balance_delta", Some(cause)) => {
                if let Ok(cause) = <[u8; 16]>::try_from(cause.as_slice()) {
                    ledger.observe_delta(hlc, cause, cents);
                }
            }
            _ => {}
        }
    }

    Ok(ledger)
}

/// The same domain-separated digest capture computes, so a field written by apply and the same field
/// written locally hash identically and Story 22's reconcile sees no difference.
pub(crate) fn content_hash(encoded: &[u8]) -> [u8; sync_capture::CONTENT_HASH_LEN] {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(b"nixus/sync/field-content/v1");
    hasher.update(encoded);

    hasher.finalize().into()
}

/// One apply transaction (AD-11).
///
/// `PRAGMA foreign_keys=ON` is issued BEFORE the `BEGIN`: SQLite documents that pragma as a no-op
/// inside a transaction, so issuing it after would read like compliance and enforce nothing.
/// `defer_foreign_keys` is issued INSIDE, because that one does take effect there and SQLite clears
/// it at every commit — which is exactly why AD-11 asks for it per transaction.
fn in_transaction<T>(
    conn: &Connection,
    defer_foreign_keys: bool,
    body: impl FnOnce(&Connection) -> Result<T, AppError>,
) -> Result<T, AppError> {
    conn.execute_batch("PRAGMA foreign_keys=ON")?;
    conn.execute_batch("BEGIN IMMEDIATE")?;

    let prepared = if defer_foreign_keys {
        conn.execute_batch("PRAGMA defer_foreign_keys=ON")
            .map_err(AppError::from)
    } else {
        Ok(())
    };

    match prepared.and_then(|()| body(conn)) {
        Ok(value) => {
            conn.execute_batch("COMMIT")?;
            Ok(value)
        }
        Err(error) => {
            if let Err(rollback) = conn.execute_batch("ROLLBACK") {
                warn!("an apply transaction could not be rolled back: {}", rollback);
            }

            Err(error)
        }
    }
}

/// One message's savepoint, so a poison message is isolated instead of taking the batch with it.
///
/// Raw SQL rather than `Transaction::savepoint`, which needs `&mut Connection` and would have to be
/// threaded through every function above — the same reason `WriteTx::savepoint` is raw. The name is
/// always one of this module's constants, never input.
fn in_savepoint<T>(
    conn: &Connection,
    name: &'static str,
    body: impl FnOnce(&Connection) -> Result<T, AppError>,
) -> Result<T, AppError> {
    conn.execute_batch(&format!("SAVEPOINT {name}"))?;

    match body(conn) {
        Ok(value) => {
            conn.execute_batch(&format!("RELEASE {name}"))?;
            Ok(value)
        }
        Err(error) => {
            conn.execute_batch(&format!("ROLLBACK TO {name}; RELEASE {name}"))?;
            Err(error)
        }
    }
}

/// The real `Applier` (AD-11): the actor's second connection to the active dataset file.
pub(crate) struct DatasetApplier {
    conn: Connection,
    clock: Arc<Clock>,
    notify: Option<Box<dyn Fn(usize) + Send>>,
}

impl DatasetApplier {
    pub(crate) fn open(
        db_path: &Path,
        notify: Option<Box<dyn Fn(usize) + Send>>,
    ) -> Result<Self, AppError> {
        // The hook is per connection, so this one captures nothing: there is no detach to forget.
        let conn = open_configured(db_path)?;

        // The same function capture and the segment cutter call, so a COPIED database is re-minted
        // by AD-4's fingerprint check instead of applying under the original's install id.
        let install = ensure_install_on(&conn)?.install_id;
        // The SAME clock capture stamps from (AD-4): a stamp this path accepts has to be in the
        // past of the next local write, or the two computers order the two messages differently.
        let clock = clock::shared(&conn, &install)?;

        Ok(Self {
            conn,
            clock,
            notify,
        })
    }
}

impl Applier for DatasetApplier {
    fn apply(&mut self, batch: &SegmentBatch) -> Result<usize, AppError> {
        let report = apply_batch(&self.conn, &self.clock, batch)?;

        if report.applied > 0 {
            if let Some(notify) = &self.notify {
                notify(report.applied);
            }
        }

        Ok(report.handled())
    }

    /// AD-4: this connection's clock is the one that refused the stamp, so it is the one that
    /// knows. Draining it here is what makes `clock_skew` a per-cycle state rather than a latch.
    fn take_clock_skew(&mut self) -> Option<i64> {
        self.clock.take_skew()
    }
}
