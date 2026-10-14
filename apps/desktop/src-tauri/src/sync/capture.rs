//! Capture (AD-3): a pre-update hook that only buffers, and a flush that turns the buffer into
//! `sync_log` messages INSIDE the write transaction.
//!
//! The split is the whole design. The hook runs while SQLite is mid-statement, so it does the one
//! thing that cannot fail interestingly: it appends the change to an in-memory buffer. Everything
//! that needs the database — minting an identity, resolving a foreign key into a parent uuid,
//! writing a message — happens in [`Capture::flush`], which `ActiveDataset::write` calls after the
//! caller's closure and before `COMMIT`. A rolled-back transaction therefore cannot leave a message
//! behind, and a committed one cannot be missing its messages: both are one transaction.
//!
//! Two consequences worth stating, because they are load-bearing rather than incidental:
//!
//! - The hook is handed column INDEXES, not names, so every travelling table's column list is
//!   resolved from the live schema when the hook is installed. That also means the hook never
//!   touches the connection, so it cannot re-enter SQLite while SQLite is inside a statement.
//! - Only tables the registry classifies as travelling are buffered at all. That is what stops the
//!   flush's own writes to `sync_log` and `sync_uuid` from being captured recursively: they are
//!   `LocalOnly` (AD-5), so the hook drops them before it even takes the buffer's lock.
//!
//! A local-only profile gets no `Capture` at all (inherited AD-12): no hook, no clock, no install
//! id, and `ActiveDataset::write` is a plain transaction.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::hooks::{Action, PreUpdateCase, PreUpdateNewValueAccessor, PreUpdateOldValueAccessor};
use sha2::{Digest, Sha256};
use rusqlite::types::{Value, ValueRef};
use rusqlite::Connection;
use tracing::warn;

use crate::db::sync_capture::{self, ColumnState, LoggedMessage, CONTENT_HASH_LEN};
use crate::db::sync_identity::{self, RowUuid};
use crate::error::AppError;
use crate::models::DatasetKind;

use super::clock::Clock;
use super::identity;
use super::registry::{self, MergeKind, RowIdentity, TableClass};

/// Domain separation for the field digest, so a `content_hash` can never be confused with any
/// other sha256 of the same bytes produced elsewhere in the app.
const FIELD_HASH_DOMAIN: &[u8] = b"nixus/sync/field-content/v1";

/// The marker a ROW-LEVEL `field` message carries instead of a column name.
///
/// AD-5 merges per COLUMN, and it still does: `sync_field_state` holds one row per column with its
/// own `hlc` and `content_hash`. What this changes is only how those columns TRAVEL — one message
/// carrying the whole changed row instead of one message per column — because a `sync_log` row with
/// its two indexes costs 3.6 µs and four of them per inserted row was measured as the dominant
/// cost of capture (AD-19's latency gate).
///
/// WHY a marker and not a NULL `column_name`: migration 032 is already shipped and its
/// `sync_log_names_a_column_only_when_it_has_one` CHECK requires a `field` message to name a
/// column. `*` cannot collide with a real column — `no_column_of_the_real_schema_is_named_like_the_
/// row_marker` checks the live schema — so the marker is unambiguous without a migration. Story 19
/// freezes the wire format and may replace it with a kind of its own; the ledger records the shape.
pub const ROW_COLUMN_MARKER: &str = "*";

/// The provisional on-disk payload encoding.
///
/// One tag byte, then the value's bytes, plus a length-prefixed map form for a row-level message.
/// Story 19 freezes the WIRE encoding when it cuts the first segment; until then nothing has left
/// the machine, so this only has to be unambiguous and deterministic — which it is, and
/// `the_payload_encoding_is_deterministic` and `a_row_payload_round_trips` pin it.
pub mod payload {
    use rusqlite::types::Value;

    use crate::error::AppError;

    pub const TAG_NULL: u8 = 0;
    pub const TAG_INTEGER: u8 = 1;
    pub const TAG_REAL: u8 = 2;
    pub const TAG_TEXT: u8 = 3;
    pub const TAG_BLOB: u8 = 4;

    /// Big-endian for the two fixed-width cases, so the bytes of two payloads sort like the numbers
    /// they encode and a later reader can compare them without decoding.
    pub fn encode(value: &Value) -> Vec<u8> {
        match value {
            Value::Null => vec![TAG_NULL],
            Value::Integer(number) => with_tag(TAG_INTEGER, &number.to_be_bytes()),
            Value::Real(number) => with_tag(TAG_REAL, &number.to_bits().to_be_bytes()),
            Value::Text(text) => with_tag(TAG_TEXT, text.as_bytes()),
            Value::Blob(bytes) => with_tag(TAG_BLOB, bytes),
        }
    }

    /// A changed row as `count, then (name, value) pairs`, every part length-prefixed big-endian.
    ///
    /// Length-prefixed rather than delimited because a column value can contain any byte, and
    /// sorted by column name so the same change always produces the same bytes.
    ///
    /// Capture itself calls [`encode_row_of`], because it has already encoded each value to hash
    /// it; this is the form Story 19's segment writer and the tests use.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn encode_row(fields: &[(String, Value)]) -> Vec<u8> {
        let encoded: Vec<(&str, Vec<u8>)> = fields
            .iter()
            .map(|(name, value)| (name.as_str(), encode(value)))
            .collect();

        encode_row_of(&encoded)
    }

    /// The same, from values that are ALREADY encoded.
    ///
    /// The caller hashes each column's bytes for `sync_field_state`, so encoding them a second time
    /// here would be one extra allocation and one extra pass per captured column — thousands of
    /// both in a 1,000-row import (AD-19's latency gate).
    pub fn encode_row_of(fields: &[(&str, Vec<u8>)]) -> Vec<u8> {
        let mut sorted: Vec<&(&str, Vec<u8>)> = fields.iter().collect();
        sorted.sort_by(|left, right| left.0.cmp(right.0));

        let mut encoded = Vec::with_capacity(sorted.len() * 32);
        encoded.extend_from_slice(&(sorted.len() as u32).to_be_bytes());

        for (name, value) in sorted {
            encoded.extend_from_slice(&(name.len() as u32).to_be_bytes());
            encoded.extend_from_slice(name.as_bytes());
            encoded.extend_from_slice(&(value.len() as u32).to_be_bytes());
            encoded.extend_from_slice(value);
        }

        encoded
    }

    /// The inverse of [`encode_row`], as the raw per-column payloads the writer encoded.
    ///
    /// Returns them still encoded rather than as `Value`s: that is what `sync_field_state`'s
    /// `content_hash` is computed over, so a reader comparing hashes never has to re-encode and
    /// cannot re-encode differently.
    // Story 20 is the first production caller: apply splits a row message back into its columns.
    #[allow(dead_code)]
    pub fn decode_row(encoded: &[u8]) -> Result<Vec<(String, Vec<u8>)>, AppError> {
        let mut cursor = 0;
        let count = take_u32(encoded, &mut cursor)? as usize;
        let mut fields = Vec::with_capacity(count);

        for _ in 0..count {
            let name = take_slice(encoded, &mut cursor)?;
            let name = std::str::from_utf8(name).map_err(|_| malformed())?.to_string();
            let value = take_slice(encoded, &mut cursor)?.to_vec();
            fields.push((name, value));
        }

        if cursor != encoded.len() {
            return Err(malformed());
        }

        Ok(fields)
    }

    fn take_u32(encoded: &[u8], cursor: &mut usize) -> Result<u32, AppError> {
        let end = cursor.checked_add(4).ok_or_else(malformed)?;
        let bytes: [u8; 4] = encoded
            .get(*cursor..end)
            .ok_or_else(malformed)?
            .try_into()
            .map_err(|_| malformed())?;
        *cursor = end;

        Ok(u32::from_be_bytes(bytes))
    }

    fn take_slice<'a>(encoded: &'a [u8], cursor: &mut usize) -> Result<&'a [u8], AppError> {
        let length = take_u32(encoded, cursor)? as usize;
        let end = cursor.checked_add(length).ok_or_else(malformed)?;
        let slice = encoded.get(*cursor..end).ok_or_else(malformed)?;
        *cursor = end;

        Ok(slice)
    }

    fn malformed() -> AppError {
        AppError::Database {
            message: "a captured row payload is malformed".to_string(),
        }
    }

    fn with_tag(tag: u8, bytes: &[u8]) -> Vec<u8> {
        let mut encoded = Vec::with_capacity(bytes.len() + 1);
        encoded.push(tag);
        encoded.extend_from_slice(bytes);
        encoded
    }
}

/// The account table the two balance emitters write, named once (AD-5 gives `balance_cents` to
/// `accounts` alone, and `registry::COLUMNS` is what pins that).
const ACCOUNTS: &str = "accounts";

thread_local! {
    /// The capture of the `ActiveDataset::write` currently running on this thread.
    ///
    /// AMBIENT rather than a parameter, and this is the one place in `sync/` where that is the
    /// right answer. AD-5's emitters live in `db/account.rs` and are reached through
    /// `adjust_account_balance`, whose callers take `&Connection` all the way up to `commands/`;
    /// handing them a `&Capture` would mean migrating every finance write site in this story
    /// instead of in Story 17. The emission goes into the SAME buffer the hook appends to, so
    /// ordering, savepoint rollback and discard-on-failure are the hook's, not a second mechanism.
    ///
    /// An emitter that runs OUTSIDE a write finds nothing and buffers nothing — identical to what
    /// the hook already does for a write site that has not been migrated yet.
    static ACTIVE_WRITE: std::cell::RefCell<Option<Arc<CaptureInner>>> =
        const { std::cell::RefCell::new(None) };
}

/// Makes `capture` the ambient capture until it is dropped, restoring whatever was there before.
pub(crate) struct ActiveWrite {
    restore: Option<Arc<CaptureInner>>,
}

impl Drop for ActiveWrite {
    fn drop(&mut self) {
        let restore = self.restore.take();
        ACTIVE_WRITE.with(|active| *active.borrow_mut() = restore);
    }
}

/// Whether a captured `ActiveDataset::write` is running on this thread.
///
/// The one question a write site outside `sync/` is allowed to ask, and it exists for AD-2's
/// derived identities: binding one writes a `sync_uuid` row, which a local-only profile must never
/// grow (inherited AD-12), while a captured write MUST have it or the flush fails.
pub fn is_capturing() -> bool {
    ACTIVE_WRITE.with(|active| active.borrow().is_some())
}

/// AD-5's absolute set: the user typed a balance, or an account was created with one.
pub fn emit_balance_set(account_id: i64, balance_cents: i64) {
    buffer_balance(account_id, BalanceEmission::Set { cents: balance_cents });
}

/// AD-5's cause-keyed delta: the signed amount that was added to the account locally, computed
/// ONCE here with the credit-card sign rules, so every replica adds the same number verbatim
/// instead of recomputing it against a balance of its own.
pub fn emit_balance_delta(
    account_id: i64,
    delta_cents: i64,
    cause_table: &'static str,
    cause_row_id: i64,
    cause: BalanceCause,
) {
    if delta_cents == 0 {
        return;
    }

    buffer_balance(
        account_id,
        BalanceEmission::Delta {
            cents: delta_cents,
            cause_table,
            cause_row_id,
            cause,
        },
    );
}

fn buffer_balance(account_id: i64, emission: BalanceEmission) {
    let Some(inner) = ACTIVE_WRITE.with(|active| active.borrow().clone()) else {
        return;
    };

    lock(&inner.buffer).changes.push(BufferedChange {
        table: ACCOUNTS,
        row_id: Some(account_id),
        depth: 0,
        op: ChangeOp::Balance(emission),
    });
}

struct ColumnShape {
    name: String,
    merge: MergeKind,
    /// `Some` for a foreign key: AD-2 keeps local integers out of messages, so the value travels as
    /// the PARENT'S uuid and this is the table to resolve it in.
    parent: Option<&'static str>,
}

struct TableShape {
    table: &'static str,
    identity: RowIdentity,
    /// `false` for a `WITHOUT ROWID` table, whose hook row id is meaningless.
    has_rowid: bool,
    columns: Vec<ColumnShape>,
}

type Shapes = HashMap<&'static str, TableShape>;

struct BufferedChange {
    table: &'static str,
    row_id: Option<i64>,
    /// 0 for a statement the caller wrote, >= 1 for a cascade or trigger. Recorded rather than
    /// filtered: AD-3 captures cascade children as ORDINARY changes.
    depth: i32,
    op: ChangeOp,
}

enum ChangeOp {
    Insert(Vec<Value>),
    Update { old: Vec<Value>, new: Vec<Value> },
    Delete(Vec<Value>),
    /// AD-5's balance emitters. The hook cannot produce either of these: it sees
    /// `balance_cents` move and has no way to know whether the move was an absolute set by the
    /// user or the consequence of one expense, which is the whole of AD-5's balance rule.
    Balance(BalanceEmission),
}

enum BalanceEmission {
    Set {
        cents: i64,
    },
    Delta {
        cents: i64,
        cause_table: &'static str,
        cause_row_id: i64,
        cause: BalanceCause,
    },
}

/// Why a balance moved, which is what a delta is keyed by (AD-5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BalanceCause {
    /// At most once per cause row, ever.
    Created,
    /// At most once per cause row, and INDEPENDENTLY REACHABLE on two computers: both deleting
    /// the same expense must credit the account once.
    Deleted,
    /// Repeatable: each edit is its own event, so its cause carries the emitted stamp and can
    /// never be mistaken for a replay of the previous edit.
    Edited,
}

impl BalanceCause {
    fn tag(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Deleted => "deleted",
            Self::Edited => "edited",
        }
    }

    fn discriminator(self, hlc: &str) -> &str {
        match self {
            Self::Created | Self::Deleted => "",
            Self::Edited => hlc,
        }
    }
}

#[derive(Default)]
struct Buffer {
    changes: Vec<BufferedChange>,
    /// The first thing the hook could not read. It cannot return an error from inside a statement,
    /// so it records one and the flush fails the whole transaction — a change that could not be
    /// read must never become a silently missing message (AD-3).
    fault: Option<String>,
}

/// The install id and the clock every message of this dataset is stamped with.
///
/// Behind a lock and replaceable rather than fixed at construction: AD-9 swaps the dataset FILE
/// under a live `Capture` (a bootstrap or a restore), and the file that arrives carries its own
/// `sync_state`. Stamping messages with the install id of the file that was replaced would put two
/// machines in one `(install, seq)` space, which is the exact hazard AD-4 exists to prevent.
struct Stamping {
    install: String,
    clock: Clock,
}

struct CaptureInner {
    stamping: Mutex<Stamping>,
    /// Re-resolved on every `attach` for the same reason: the swapped-in file is migrated by
    /// `open_configured` before capture sees it, and its schema may not be the one the previous
    /// shapes were read from.
    shapes: Mutex<Arc<Shapes>>,
    buffer: Arc<Mutex<Buffer>>,
    /// A table the registry does not classify, for the two cases the real schema cannot express
    /// (`WITHOUT ROWID`, and a REPLACE that conflicts on a non-primary unique key). Held rather
    /// than inserted once, because `attach` re-resolves the shapes and would otherwise drop it.
    #[cfg(test)]
    extra: Option<ExtraShape>,
}

#[cfg(test)]
struct ExtraShape {
    table: &'static str,
    identity: RowIdentity,
    merge: MergeKind,
}

/// The capture state of one cloud-linked dataset.
pub struct Capture {
    inner: Arc<CaptureInner>,
}

/// What a flush did, which is what the latency gate measures and Story 19 will report.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FlushReport {
    pub messages: usize,
    pub changes: usize,
}

/// Where a savepoint found the buffer, so rolling back to it restores exactly that.
///
/// It carries the FAULT FLAG as well as the length: a read fault recorded inside a savepoint that
/// was rolled back describes a change that no longer exists, and failing the outer transaction for
/// it would be failing for nothing. A fault that was already there is kept, because the change it
/// describes is still part of this transaction.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Mark {
    changes: usize,
    had_fault: bool,
}

/// Rows of one table keyed by their local id, so a 1,000-child import looks its shared parent up
/// once instead of a thousand times.
type IdentityMemo = HashMap<(&'static str, i64), RowUuid>;

/// One buffered change with every database read already done, so the writing pass needs none.
enum Resolved {
    Fields {
        table: &'static str,
        row_uuid: RowUuid,
        /// Column name and the value that travels, already translated into uuid space where the
        /// column is a foreign key (AD-2).
        fields: Vec<(String, Value)>,
        /// Column name and the signed delta AD-5 wants for a counter.
        counters: Vec<(String, i64)>,
    },
    Tombstone {
        table: &'static str,
        row_id: i64,
        row_uuid: RowUuid,
        row_json: String,
    },
    /// A delete of a row that never had an identity: it was never shipped under one, so no other
    /// computer knows it exists. Reconcile (Story 22) owns rows that predate capture.
    Nothing,
    Balance {
        table: &'static str,
        row_uuid: RowUuid,
        emission: ResolvedBalance,
    },
}

enum ResolvedBalance {
    Set {
        cents: i64,
    },
    Delta {
        cents: i64,
        cause_table: &'static str,
        cause_row: RowUuid,
        cause: BalanceCause,
    },
}

impl Capture {
    /// The capture state for a dataset, or `None` when that dataset can never sync.
    ///
    /// `None` for a local profile is the structural half of inherited AD-12: there is no hook to
    /// forget to detach and no install id to mint, so a local-only user provably runs no sync code.
    ///
    /// The install id is settled through the SAME path the sync actor uses
    /// (`sync::state::ensure_install_on`), so a database copied to another computer captures under
    /// its NEW install id whichever of the two runs first — appending under the old one would put
    /// two machines in one `(install, seq)` space (AD-4).
    pub fn for_dataset(kind: DatasetKind, conn: &Connection) -> Result<Option<Self>, AppError> {
        match kind {
            DatasetKind::Local => Ok(None),
            DatasetKind::CloudLinked => Ok(Some(Self::new(conn)?)),
        }
    }

    fn new(conn: &Connection) -> Result<Self, AppError> {
        Self::build(
            conn,
            #[cfg(test)]
            None,
        )
    }

    fn build(conn: &Connection, #[cfg(test)] extra: Option<ExtraShape>) -> Result<Self, AppError> {
        let state = super::state::ensure_install_on(conn)?;
        let inner = CaptureInner {
            stamping: Mutex::new(Stamping {
                clock: clock_for(&state.install_id)?,
                install: state.install_id,
            }),
            shapes: Mutex::new(Arc::new(Shapes::new())),
            buffer: Arc::new(Mutex::new(Buffer::default())),
            #[cfg(test)]
            extra,
        };
        let capture = Self {
            inner: Arc::new(inner),
        };
        *lock(&capture.inner.shapes) = Arc::new(capture.resolve_shapes(conn)?);

        Ok(capture)
    }

    /// The shapes of this dataset, re-read from the live schema.
    fn resolve_shapes(&self, conn: &Connection) -> Result<Shapes, AppError> {
        #[cfg_attr(not(test), allow(unused_mut))]
        let mut shapes = resolve_shapes(conn)?;

        #[cfg(test)]
        if let Some(extra) = &self.inner.extra {
            shapes.insert(
                extra.table,
                TableShape {
                    table: extra.table,
                    identity: extra.identity,
                    has_rowid: sync_capture::table_has_rowid(conn, extra.table)?,
                    columns: sync_capture::table_columns(conn, extra.table)?
                        .into_iter()
                        .map(|name| ColumnShape {
                            name,
                            merge: extra.merge,
                            parent: None,
                        })
                        .collect(),
                },
            );
        }

        Ok(shapes)
    }

    /// Registers the pre-update hook on a connection, re-reading everything that belongs to the
    /// FILE rather than to this process, and discarding anything left buffered.
    ///
    /// Idempotent and re-callable, and that is the point: a restore swaps the file and adopts a NEW
    /// connection (AD-9), so the install id and the schema are re-read here. The clock is kept when
    /// the install id is unchanged, so Story 13's "strictly increasing" property survives a
    /// re-attach instead of restarting from the wall clock.
    pub fn attach(&self, conn: &Connection) -> Result<(), AppError> {
        self.discard();
        self.adopt(conn)?;

        let shapes = self.shapes();
        let buffer = Arc::clone(&self.inner.buffer);

        conn.preupdate_hook(Some(
            move |_action: Action, database: &str, table: &str, case: &PreUpdateCase| {
                observe(&shapes, &buffer, database, table, case);
            },
        ))?;

        Ok(())
    }

    fn adopt(&self, conn: &Connection) -> Result<(), AppError> {
        let state = super::state::ensure_install_on(conn)?;

        {
            let mut stamping = lock(&self.inner.stamping);
            if stamping.install != state.install_id {
                *stamping = Stamping {
                    clock: clock_for(&state.install_id)?,
                    install: state.install_id,
                };
            }
        }

        *lock(&self.inner.shapes) = Arc::new(self.resolve_shapes(conn)?);

        Ok(())
    }

    /// Removes the hook until the returned guard is dropped.
    ///
    /// The explicit "capture off" seam AD-3's neighbours need: `sync::apply` runs on a connection
    /// that never had the hook (AD-11), but a wipe (AD-15) and a restore (AD-9) operate on the UI
    /// connection itself and must not emit a message per deleted row.
    // Story 25 is the first production caller (through `ActiveDataset::write_uncaptured`).
    #[allow(dead_code)]
    pub fn detached<'a>(&'a self, conn: &'a Connection) -> Result<Detached<'a>, AppError> {
        conn.preupdate_hook(None::<fn(Action, &str, &str, &PreUpdateCase)>)?;
        self.discard();

        Ok(Detached {
            capture: self,
            conn,
        })
    }

    /// Starts a captured transaction: whatever an earlier failure left behind is not part of it.
    pub(crate) fn begin(&self) -> ActiveWrite {
        self.discard();

        let restore = ACTIVE_WRITE
            .with(|active| active.borrow_mut().replace(Arc::clone(&self.inner)));

        ActiveWrite { restore }
    }

    pub(crate) fn discard(&self) {
        let mut buffer = self.buffer();
        buffer.changes.clear();
        buffer.fault = None;
    }

    /// Where the buffer is now, which is what a savepoint rolls back to.
    pub(crate) fn mark(&self) -> Mark {
        let buffer = self.buffer();

        Mark {
            changes: buffer.changes.len(),
            had_fault: buffer.fault.is_some(),
        }
    }

    pub(crate) fn rollback_to(&self, mark: Mark) {
        let mut buffer = self.buffer();

        if mark.changes < buffer.changes.len() {
            buffer.changes.truncate(mark.changes);
        }

        if !mark.had_fault {
            buffer.fault = None;
        }
    }

    /// Turns everything buffered into messages, on the caller's own transaction.
    ///
    /// TWO PASSES, and the order is the correctness argument. The first pass does every database
    /// read — minting identities, translating foreign keys into uuids, rendering each deleted row
    /// as JSON — while every identity mapping of the batch is still intact. The second writes the
    /// messages and only THEN drops the mappings of the rows that were deleted. A single pass
    /// cannot do this: a cascade reaches the parent first, so dropping its mapping before the
    /// child's tombstone is rendered would leave the child's row unable to name its parent, and
    /// AD-12 needs that child restorable.
    ///
    /// It also takes the changes OUT of the buffer before writing any of them, so the hook firing
    /// for this function's own writes could never deadlock on the buffer's lock. It cannot fire —
    /// every table written here is `LocalOnly` — and the emptiness check at the end is what proves
    /// that rather than assuming it.
    pub(crate) fn flush(&self, conn: &Connection) -> Result<FlushReport, AppError> {
        let (changes, fault) = {
            let mut buffer = self.buffer();
            (std::mem::take(&mut buffer.changes), buffer.fault.take())
        };

        if let Some(fault) = fault {
            return Err(AppError::Database {
                message: format!(
                    "a change could not be captured and the write was rolled back: {fault}"
                ),
            });
        }

        if changes.is_empty() {
            return Ok(FlushReport::default());
        }

        let shapes = self.shapes();
        let changes = collapse_replacements(changes);
        let mut memo = IdentityMemo::new();

        let mut resolved = Vec::with_capacity(changes.len());
        for change in &changes {
            resolved.push(resolve(conn, &shapes, &mut memo, change)?);
        }

        let report = self.write_resolved(conn, &resolved, changes.len())?;

        let leaked = self.buffer().changes.len();
        if leaked > 0 {
            return Err(AppError::Database {
                message: format!("the capture flush was itself captured ({leaked} changes)"),
            });
        }

        Ok(report)
    }

    /// The writing pass: one HLC per changed ROW, and no database READ at all.
    ///
    /// One stamp per row and not per column, deliberately: one user edit is one event, every column
    /// of it is concurrent with the others by construction, and a message's identity is
    /// `(install, seq, idx)` rather than its stamp (AD-4). It is also a quarter of the clock calls.
    fn write_resolved(
        &self,
        conn: &Connection,
        resolved: &[Resolved],
        changes: usize,
    ) -> Result<FlushReport, AppError> {
        let stamping = lock(&self.inner.stamping);
        let install = stamping.install.as_str();
        let mut written = 0;
        let mut forgotten: Vec<(&'static str, i64, RowUuid)> = Vec::new();

        for item in resolved {
            match item {
                Resolved::Nothing => {}
                Resolved::Balance {
                    table,
                    row_uuid,
                    emission,
                } => {
                    let hlc = stamping.clock.now().encode();
                    let (kind, cents, cause_uuid) = match emission {
                        ResolvedBalance::Set { cents } => ("balance_set", *cents, None),
                        ResolvedBalance::Delta {
                            cents,
                            cause_table,
                            cause_row,
                            cause,
                        } => (
                            "balance_delta",
                            *cents,
                            Some(identity::balance_cause(
                                cause_table,
                                cause_row,
                                cause.tag(),
                                cause.discriminator(&hlc),
                            )),
                        ),
                    };
                    let encoded = payload::encode(&Value::Integer(cents));

                    sync_capture::append(
                        conn,
                        &LoggedMessage {
                            install,
                            hlc: &hlc,
                            kind,
                            table_name: table,
                            row_uuid,
                            column_name: None,
                            cause_uuid: cause_uuid.as_ref().map(|uuid| uuid.as_slice()),
                            payload: Some(&encoded),
                        },
                    )?;
                    written += 1;
                }
                Resolved::Fields {
                    table,
                    row_uuid,
                    fields,
                    counters,
                } => {
                    let hlc = stamping.clock.now().encode();

                    // ONE message for the whole changed row (see `ROW_COLUMN_MARKER`), but still
                    // one `sync_field_state` row per column: AD-5 decides each column on its own
                    // `hlc`, and this only changes how they travel.
                    if !fields.is_empty() {
                        let columns: Vec<(&str, Vec<u8>)> = fields
                            .iter()
                            .map(|(column, value)| (column.as_str(), payload::encode(value)))
                            .collect();
                        let encoded = payload::encode_row_of(&columns);

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
                        written += 1;

                        // ONE row write for the whole changed row (migration 033), still carrying
                        // one entry per column: AD-5 decides each column on its own `hlc`.
                        let states: Vec<(String, ColumnState)> = columns
                            .iter()
                            .map(|(column, value)| {
                                (
                                    (*column).to_string(),
                                    ColumnState {
                                        hlc: hlc.clone(),
                                        content_hash: content_hash(value),
                                    },
                                )
                            })
                            .collect();
                        sync_capture::upsert_field_states(conn, table, row_uuid, &states)?;
                    }

                    // No field state for a counter: its value is the SUM of its deltas, so there is
                    // no single write that owns it (AD-5). It keeps its own message because its
                    // payload is a delta rather than a value.
                    for (column, delta) in counters {
                        let encoded = payload::encode(&Value::Integer(*delta));

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
                        written += 1;
                    }
                }
                Resolved::Tombstone {
                    table,
                    row_id,
                    row_uuid,
                    row_json,
                } => {
                    let encoded = payload::encode(&Value::Text(row_json.clone()));

                    sync_capture::append(
                        conn,
                        &LoggedMessage {
                            install,
                            hlc: &stamping.clock.now().encode(),
                            kind: "tombstone",
                            table_name: table,
                            row_uuid,
                            column_name: None,
                            cause_uuid: None,
                            payload: Some(&encoded),
                        },
                    )?;
                    written += 1;
                    forgotten.push((table, *row_id, *row_uuid));
                }
            }
        }

        // Last, so the reading pass could still resolve every identity this batch names (AD-2 drops
        // a mapping with its tombstone, and a cascade's children are rendered after their parent's
        // tombstone would otherwise have dropped it).
        for (table, row_id, row_uuid) in forgotten {
            sync_capture::forget_field_state(conn, table, &row_uuid)?;
            sync_identity::forget(conn, table, row_id)?;
        }

        Ok(FlushReport {
            messages: written,
            changes,
        })
    }

    fn buffer(&self) -> MutexGuard<'_, Buffer> {
        lock(&self.inner.buffer)
    }

    fn shapes(&self) -> Arc<Shapes> {
        Arc::clone(&lock(&self.inner.shapes))
    }

    #[cfg(test)]
    pub(crate) fn install_id(&self) -> String {
        lock(&self.inner.stamping).install.clone()
    }

    #[cfg(test)]
    pub(crate) fn buffered_depths(&self) -> Vec<(&'static str, i32)> {
        self.buffer()
            .changes
            .iter()
            .map(|change| (change.table, change.depth))
            .collect()
    }

    /// The only way a test can put the buffer in the state a failed hook read leaves it in: the
    /// hook cannot be made to fail on demand against a real SQLite.
    #[cfg(test)]
    pub(crate) fn record_fault(&self, fault: &str) {
        let mut buffer = self.buffer();
        if buffer.fault.is_none() {
            buffer.fault = Some(fault.to_string());
        }
    }
}

/// A panicking hook cannot leave either lock half-written — a push either happened or did not — so
/// the poison flag carries no information worth propagating, and honouring it would turn an
/// unrelated panic elsewhere into permanently uncapturable writes.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The reading pass: everything about one buffered change that needs the database.
fn resolve(
    conn: &Connection,
    shapes: &Shapes,
    memo: &mut IdentityMemo,
    change: &BufferedChange,
) -> Result<Resolved, AppError> {
    let shape = shapes
        .get(change.table)
        .ok_or_else(|| unknown_table(change.table))?;

    let row_id = change.row_id.ok_or_else(|| AppError::Database {
        message: format!(
            "{} is WITHOUT ROWID, so the pre-update hook gives no usable row id and its rows \
             cannot be identified by one (AD-3)",
            change.table
        ),
    })?;

    match &change.op {
        ChangeOp::Balance(emission) => {
            let row_uuid = identity_of(conn, shapes, memo, shape, row_id)?;
            let emission = match emission {
                BalanceEmission::Set { cents } => ResolvedBalance::Set { cents: *cents },
                BalanceEmission::Delta {
                    cents,
                    cause_table,
                    cause_row_id,
                    cause,
                } => {
                    let cause_shape = shapes
                        .get(*cause_table)
                        .ok_or_else(|| unknown_table(cause_table))?;

                    ResolvedBalance::Delta {
                        cents: *cents,
                        cause_table,
                        cause_row: identity_of(conn, shapes, memo, cause_shape, *cause_row_id)?,
                        cause: *cause,
                    }
                }
            };

            Ok(Resolved::Balance {
                table: shape.table,
                row_uuid,
                emission,
            })
        }
        ChangeOp::Insert(new) => {
            let row_uuid = identity_of(conn, shapes, memo, shape, row_id)?;
            resolve_fields(conn, shapes, memo, shape, row_uuid, None, new)
        }
        ChangeOp::Update { old, new } => {
            let row_uuid = identity_of(conn, shapes, memo, shape, row_id)?;
            resolve_fields(conn, shapes, memo, shape, row_uuid, Some(old), new)
        }
        ChangeOp::Delete(old) => {
            let Some(row_uuid) = lookup(conn, memo, shape.table, row_id)? else {
                return Ok(Resolved::Nothing);
            };

            let row_json = row_json(conn, memo, shape, old)?;
            // The mapping is dropped at the end of the writing pass, so the memo must not keep
            // handing this identity to a row that reuses the row id later in the same batch.
            memo.remove(&(shape.table, row_id));

            Ok(Resolved::Tombstone {
                table: shape.table,
                row_id,
                row_uuid,
                row_json,
            })
        }
    }
}

fn resolve_fields(
    conn: &Connection,
    shapes: &Shapes,
    memo: &mut IdentityMemo,
    shape: &TableShape,
    row_uuid: RowUuid,
    old: Option<&[Value]>,
    new: &[Value],
) -> Result<Resolved, AppError> {
    let mut fields: Vec<(String, Value)> = Vec::new();
    let mut counters: Vec<(String, i64)> = Vec::new();

    for (index, column) in shape.columns.iter().enumerate() {
        let after = value_at(new, index, shape.table, &column.name)?;
        let before = match old {
            Some(values) => Some(value_at(values, index, shape.table, &column.name)?),
            None => None,
        };

        if before == Some(after) {
            continue;
        }

        match column.merge {
            MergeKind::Lww => fields.push((column.name.clone(), after.clone())),
            MergeKind::Immutable => match before {
                // AD-5: a later write to an immutable column is a bug, not a concurrent edit, and
                // must not silently become an Lww winner on every other computer. Named without
                // its value, per AD-16.
                Some(_) => warn!(
                    "an immutable column changed locally and was not captured: {}.{}",
                    shape.table, column.name
                ),
                None => fields.push((column.name.clone(), after.clone())),
            },
            // A counter travels as a delta FROM ZERO on insert, so a counter's value is the sum of
            // its deltas with nothing else in it. Letting the schema default stand in for the
            // first increment would bake "the default is 1" into the merge rule and would make two
            // computers that independently create the same hint converge on one use instead of two.
            MergeKind::Counter => {
                let previous = before.unwrap_or(&Value::Integer(0));
                let delta = counter_delta(shape, &column.name, previous, after)?;
                if delta != 0 {
                    counters.push((column.name.clone(), delta));
                }
            }
            MergeKind::LocalId => {
                if let Some(parent) = column.parent {
                    let resolved = parent_reference(conn, shapes, memo, parent, after)?;
                    fields.push((column.name.clone(), resolved));
                }
            }
            // AD-5: `balance_cents` is never generically captured (Story 16's emitters own it),
            // and AD-10 keeps image bytes out of every message.
            MergeKind::Balance | MergeKind::Excluded => {}
        }
    }

    Ok(Resolved::Fields {
        table: shape.table,
        row_uuid,
        fields,
        counters,
    })
}

/// AD-5's counter: the hook's `new − old`, so the value is the sum of deltas and two computers
/// incrementing once each end up at two rather than one.
fn counter_delta(
    shape: &TableShape,
    column: &str,
    before: &Value,
    after: &Value,
) -> Result<i64, AppError> {
    let (Value::Integer(before), Value::Integer(after)) = (before, after) else {
        return Err(AppError::Database {
            message: format!(
                "{}.{} is a counter but did not hold an integer",
                shape.table, column
            ),
        });
    };

    Ok(after.wrapping_sub(*before))
}

/// The row's identity, minted now when the row is surrogate and has never been seen.
///
/// A `Natural` row is an error rather than a mint: its uuid is DERIVED from its natural key (AD-2)
/// and only its insert site knows that key, so minting a random one here would split one logical
/// row into two on two computers. Failing the transaction is the only honest answer.
fn identity_of(
    conn: &Connection,
    shapes: &Shapes,
    memo: &mut IdentityMemo,
    shape: &TableShape,
    row_id: i64,
) -> Result<RowUuid, AppError> {
    if let Some(found) = lookup(conn, memo, shape.table, row_id)? {
        return Ok(found);
    }

    let minted = match shape.identity {
        RowIdentity::Surrogate | RowIdentity::SurrogateOrTemplate => {
            identity::uuid_for(conn, shape.table, row_id)?
        }
        RowIdentity::Natural => {
            return Err(AppError::Database {
                message: format!(
                    "a {} row was written through ActiveDataset::write without the derived \
                     identity AD-2 requires at its insert site",
                    shape.table
                ),
            })
        }
    };

    debug_assert!(shapes.contains_key(shape.table));
    memo.insert((shape.table, row_id), minted);

    Ok(minted)
}

fn lookup(
    conn: &Connection,
    memo: &mut IdentityMemo,
    table: &'static str,
    row_id: i64,
) -> Result<Option<RowUuid>, AppError> {
    if let Some(found) = memo.get(&(table, row_id)) {
        return Ok(Some(*found));
    }

    let found = sync_identity::lookup(conn, table, row_id)?;
    if let Some(found) = found {
        memo.insert((table, row_id), found);
    }

    Ok(found)
}

/// A foreign key in uuid space (AD-2). A NULL stays NULL — that is what the `SET NULL` edges
/// replay as (AD-12).
fn parent_reference(
    conn: &Connection,
    shapes: &Shapes,
    memo: &mut IdentityMemo,
    parent: &'static str,
    value: &Value,
) -> Result<Value, AppError> {
    let parent_row = match value {
        Value::Null => return Ok(Value::Null),
        Value::Integer(row_id) => *row_id,
        _ => {
            return Err(AppError::Database {
                message: format!("a foreign key into {parent} did not hold an integer"),
            })
        }
    };

    let shape = shapes.get(parent).ok_or_else(|| unknown_table(parent))?;

    Ok(Value::Blob(
        identity_of(conn, shapes, memo, shape, parent_row)?.to_vec(),
    ))
}

/// The deleted row as a JSON object, column name to value.
///
/// Self-describing rather than positional because a restore reads it in a LATER app version,
/// possibly after a migration added a column. Local integers are left out and foreign keys are
/// written as their parent's uuid (AD-2); image bytes are left out (AD-10). A blob is hex so the
/// document stays valid JSON.
///
/// The parent uuid is LOOKED UP and never minted: a parent that has no mapping is a parent no
/// other computer knows, and inventing one would name an unresolvable identity in a tombstone.
/// Rendering happens before any mapping of the batch is dropped, which is why a cascaded child can
/// still name the parent that was deleted with it (AD-12).
fn row_json(
    conn: &Connection,
    memo: &mut IdentityMemo,
    shape: &TableShape,
    values: &[Value],
) -> Result<String, AppError> {
    let mut row = serde_json::Map::new();

    for (index, column) in shape.columns.iter().enumerate() {
        let value = value_at(values, index, shape.table, &column.name)?;

        let json = match column.merge {
            MergeKind::Excluded => continue,
            MergeKind::LocalId => match (column.parent, value) {
                (Some(parent), Value::Integer(row_id)) => {
                    match lookup(conn, memo, parent, *row_id)? {
                        Some(uuid) => serde_json::Value::String(hex(&uuid)),
                        None => serde_json::Value::Null,
                    }
                }
                (Some(_), _) => serde_json::Value::Null,
                (None, _) => continue,
            },
            _ => json_value(value),
        };

        row.insert(column.name.clone(), json);
    }

    serde_json::to_string(&serde_json::Value::Object(row)).map_err(|error| AppError::Database {
        message: format!("a deleted {} row could not be recorded: {error}", shape.table),
    })
}

/// Re-attaches the hook when it goes out of scope, however the scope ends.
#[allow(dead_code)]
pub struct Detached<'a> {
    capture: &'a Capture,
    conn: &'a Connection,
}

impl Drop for Detached<'_> {
    fn drop(&mut self) {
        if let Err(error) = self.capture.attach(self.conn) {
            // Logged rather than propagated: `Drop` cannot fail, and panicking while unwinding
            // would take the process down. The hook is re-installed on the next dataset selection
            // and reconcile (Story 22) heals the gap.
            warn!("the capture hook could not be re-attached: {}", error);
        }
    }
}

fn clock_for(install_id: &str) -> Result<Clock, AppError> {
    Clock::new(install_id).map_err(|error| AppError::Database {
        message: format!("the dataset's install id is unusable: {error}"),
    })
}

fn observe(
    shapes: &Shapes,
    buffer: &Mutex<Buffer>,
    database: &str,
    table: &str,
    case: &PreUpdateCase,
) {
    // The shape lookup happens BEFORE the lock, which is what keeps the flush's own writes
    // (`sync_log`, `sync_field_state`, `sync_uuid` — all `LocalOnly`) off this lock entirely.
    if database != "main" {
        return;
    }

    let Some(shape) = shapes.get(table) else {
        return;
    };

    let read = read_change(shape, case);

    let mut buffer = buffer
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    match read {
        Ok(change) => buffer.changes.push(change),
        Err(fault) => {
            if buffer.fault.is_none() {
                buffer.fault = Some(fault);
            }
        }
    }
}

fn read_change(shape: &TableShape, case: &PreUpdateCase) -> Result<BufferedChange, String> {
    let columns = shape.columns.len();

    match case {
        PreUpdateCase::Insert(new) => Ok(BufferedChange {
            table: shape.table,
            row_id: shape.has_rowid.then(|| new.get_new_row_id()),
            depth: new.get_query_depth(),
            op: ChangeOp::Insert(read_new(shape, new, columns)?),
        }),
        PreUpdateCase::Delete(old) => Ok(BufferedChange {
            table: shape.table,
            row_id: shape.has_rowid.then(|| old.get_old_row_id()),
            depth: old.get_query_depth(),
            op: ChangeOp::Delete(read_old(shape, old, columns)?),
        }),
        PreUpdateCase::Update {
            old_value_accessor,
            new_value_accessor,
        } => Ok(BufferedChange {
            table: shape.table,
            row_id: shape.has_rowid.then(|| new_value_accessor.get_new_row_id()),
            depth: new_value_accessor.get_query_depth(),
            op: ChangeOp::Update {
                old: read_old(shape, old_value_accessor, columns)?,
                new: read_new(shape, new_value_accessor, columns)?,
            },
        }),
        // Only reachable against a SQLite that grew a fourth kind of row change. Recorded as a
        // fault so the write fails loudly instead of committing without a message.
        PreUpdateCase::Unknown => Err(format!(
            "SQLite reported a row change on {} that this build does not understand",
            shape.table
        )),
    }
}

fn read_new(
    shape: &TableShape,
    accessor: &PreUpdateNewValueAccessor,
    columns: usize,
) -> Result<Vec<Value>, String> {
    expect_shape(shape, accessor.get_column_count(), columns)?;

    (0..columns)
        .map(|index| {
            accessor
                .get_new_column_value(index as i32)
                .map_err(|error| read_failure(shape, index, &error.to_string()))
                .and_then(|value| owned(shape, index, value))
        })
        .collect()
}

fn read_old(
    shape: &TableShape,
    accessor: &PreUpdateOldValueAccessor,
    columns: usize,
) -> Result<Vec<Value>, String> {
    expect_shape(shape, accessor.get_column_count(), columns)?;

    (0..columns)
        .map(|index| {
            accessor
                .get_old_column_value(index as i32)
                .map_err(|error| read_failure(shape, index, &error.to_string()))
                .and_then(|value| owned(shape, index, value))
        })
        .collect()
}

/// The hook's indexes mean nothing if the table has a different number of columns than the shape
/// resolved at install time, which is what a migration applied by another connection would look
/// like. Refusing is the difference between a missing message and a message about the wrong column.
fn expect_shape(shape: &TableShape, live: i32, resolved: usize) -> Result<(), String> {
    if live as usize == resolved {
        return Ok(());
    }

    Err(format!(
        "{} has {live} columns but capture was installed against {resolved}",
        shape.table
    ))
}

/// Copied out of SQLite's own memory while the statement is still running, because the accessor's
/// borrow ends with the callback and the flush happens later.
fn owned(shape: &TableShape, index: usize, value: ValueRef<'_>) -> Result<Value, String> {
    Value::try_from(value).map_err(|error| read_failure(shape, index, &error.to_string()))
}

fn read_failure(shape: &TableShape, index: usize, error: &str) -> String {
    format!(
        "column {} of {} could not be read: {error}",
        shape
            .columns
            .get(index)
            .map(|column| column.name.as_str())
            .unwrap_or("?"),
        shape.table
    )
}

/// `INSERT OR REPLACE` reaches the hook as a DELETE of the conflicting row followed by an INSERT.
///
/// When both carry the same row id the two are one logical upsert, and emitting a tombstone plus a
/// fresh identity would make every REPLACE rename the row on every other computer and throw away
/// its merge state. Collapsing them into an UPDATE keeps the identity, which is what "correct
/// logical messages" means here.
///
/// When the row ids DIFFER the pair is not an upsert: SQLite deleted a row that conflicted on some
/// other unique key and inserted a genuinely new one, so it stays a tombstone plus an insert.
///
/// The delete half is SCANNED BACK FOR and not just read off the end, because the deleted row may
/// have cascaded children: a REPLACE of a parent arrives as `Delete(parent)`, the children's
/// deletes at depth >= 1, and only then `Insert(parent)`. The scan skips exactly those deeper
/// changes and stops at the first change at or above the insert's own depth, so it can never reach
/// past the statement that produced it. The children's tombstones are kept: the cascade really did
/// delete those rows.
fn collapse_replacements(changes: Vec<BufferedChange>) -> Vec<BufferedChange> {
    let mut collapsed: Vec<BufferedChange> = Vec::with_capacity(changes.len());

    for change in changes {
        match deleted_half(&collapsed, &change) {
            Some(index) => {
                let deleted = collapsed.remove(index);
                collapsed.push(upsert(deleted, change));
            }
            None => collapsed.push(change),
        }
    }

    collapsed
}

/// The index of the DELETE this INSERT is the other half of, if there is one.
fn deleted_half(collapsed: &[BufferedChange], inserted: &BufferedChange) -> Option<usize> {
    if !matches!(inserted.op, ChangeOp::Insert(_)) || inserted.row_id.is_none() {
        return None;
    }

    for (index, candidate) in collapsed.iter().enumerate().rev() {
        if candidate.depth > inserted.depth {
            continue;
        }

        let matches_row = matches!(candidate.op, ChangeOp::Delete(_))
            && candidate.depth == inserted.depth
            && candidate.table == inserted.table
            && candidate.row_id == inserted.row_id;

        return matches_row.then_some(index);
    }

    None
}

/// The delete half's OLD values plus the insert half's NEW values: the update the REPLACE was.
fn upsert(deleted: BufferedChange, inserted: BufferedChange) -> BufferedChange {
    match (deleted.op, inserted.op) {
        (ChangeOp::Delete(old), ChangeOp::Insert(new)) => BufferedChange {
            table: inserted.table,
            row_id: inserted.row_id,
            depth: inserted.depth,
            op: ChangeOp::Update { old, new },
        },
        // Unreachable: `deleted_half` matched both halves before this was called. Keeping the
        // insert is what makes this an unreachable branch rather than a lost change.
        (_, op) => BufferedChange {
            table: inserted.table,
            row_id: inserted.row_id,
            depth: inserted.depth,
            op,
        },
    }
}

/// Every travelling table of the live schema, in the shape the hook needs.
///
/// Built from the registry INTERSECTED with the schema, so a table the registry declares but this
/// database does not have is simply absent rather than a failure; Story 14's classification tests
/// are what fail on a real mismatch.
fn resolve_shapes(conn: &Connection) -> Result<Shapes, AppError> {
    let mut shapes = Shapes::new();

    for rule in registry::TABLES {
        if matches!(rule.class, TableClass::LocalOnly) {
            continue;
        }

        let names = sync_capture::table_columns(conn, rule.table)?;
        if names.is_empty() {
            continue;
        }

        let identity = rule.identity.ok_or_else(|| AppError::Database {
            message: format!("{} travels but declares no row identity", rule.table),
        })?;

        let columns = names
            .into_iter()
            .map(|name| {
                let merge =
                    registry::merge_kind(rule.table, &name).ok_or_else(|| AppError::Database {
                        message: format!("{}.{} is not classified (AD-5)", rule.table, name),
                    })?;

                Ok(ColumnShape {
                    parent: registry::fk_parent(rule.table, &name),
                    name,
                    merge,
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?;

        shapes.insert(
            rule.table,
            TableShape {
                table: rule.table,
                identity,
                has_rowid: sync_capture::table_has_rowid(conn, rule.table)?,
                columns,
            },
        );
    }

    Ok(shapes)
}

/// Capture over the live schema plus one extra table, for the `WITHOUT ROWID` regression test.
///
/// No travelling table of the real schema is `WITHOUT ROWID` today — `no_travelling_table_of_the_
/// real_schema_is_without_rowid` pins that — so the only way to prove what capture does with one is
/// to hand it one.
#[cfg(test)]
pub(crate) fn capture_including(
    conn: &Connection,
    extra: &'static str,
    identity: RowIdentity,
    merge: MergeKind,
) -> Result<Capture, AppError> {
    Capture::build(
        conn,
        Some(ExtraShape {
            table: extra,
            identity,
            merge,
        }),
    )
}

fn value_at<'a>(
    values: &'a [Value],
    index: usize,
    table: &str,
    column: &str,
) -> Result<&'a Value, AppError> {
    values.get(index).ok_or_else(|| AppError::Database {
        message: format!("{table}.{column} was not part of the captured change"),
    })
}

fn json_value(value: &Value) -> serde_json::Value {
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

/// Reconcile's input (AD-3): the hash of the value the message carried, so a write that bypassed
/// the hook is found by hashing the live value the same way and comparing.
///
/// RAW digest bytes, not hex: it is stored inside the packed map (migration 033), never read by
/// eye, and hex would be twice the size plus a formatting pass per captured column.
fn content_hash(encoded: &[u8]) -> [u8; CONTENT_HASH_LEN] {
    let mut digest = Sha256::new();
    digest.update(FIELD_HASH_DOMAIN);
    digest.update(encoded);

    digest.finalize().into()
}

fn unknown_table(table: &str) -> AppError {
    AppError::Database {
        message: format!("{table} is not a table sync knows about (AD-5)"),
    }
}
