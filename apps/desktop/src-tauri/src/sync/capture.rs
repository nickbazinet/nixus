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
use rusqlite::types::{Value, ValueRef};
use rusqlite::Connection;
use tracing::warn;

use crate::db::sync_capture::{self, LoggedMessage};
use crate::db::sync_identity::{self, RowUuid};
use crate::error::AppError;
use crate::models::DatasetKind;

use super::clock::Clock;
use super::identity;
use super::registry::{self, MergeKind, RowIdentity, TableClass};

/// Domain separation for the field digest, so a `content_hash` can never be confused with any
/// other sha256 of the same bytes produced elsewhere in the app.
const FIELD_HASH_DOMAIN: &[u8] = b"nixus/sync/field-content/v1";

/// The provisional on-disk payload encoding.
///
/// One tag byte, then the value's bytes. Story 19 freezes the WIRE encoding when it cuts the first
/// segment; until then nothing has left the machine, so this only has to be unambiguous and
/// deterministic — which it is, and `the_payload_encoding_is_deterministic` pins it.
pub mod payload {
    use rusqlite::types::Value;

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

    fn with_tag(tag: u8, bytes: &[u8]) -> Vec<u8> {
        let mut encoded = Vec::with_capacity(bytes.len() + 1);
        encoded.push(tag);
        encoded.extend_from_slice(bytes);
        encoded
    }
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
}

#[derive(Default)]
struct Buffer {
    changes: Vec<BufferedChange>,
    /// The first thing the hook could not read. It cannot return an error from inside a statement,
    /// so it records one and the flush fails the whole transaction — a change that could not be
    /// read must never become a silently missing message (AD-3).
    fault: Option<String>,
}

struct CaptureInner {
    install: String,
    clock: Clock,
    shapes: Arc<Shapes>,
    buffer: Arc<Mutex<Buffer>>,
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
        let state = super::state::ensure_install_on(conn)?;

        Ok(Self {
            inner: Arc::new(CaptureInner {
                clock: clock_for(&state.install_id)?,
                install: state.install_id,
                shapes: Arc::new(resolve_shapes(conn)?),
                buffer: Arc::new(Mutex::new(Buffer::default())),
            }),
        })
    }

    /// Registers the pre-update hook on a connection, discarding anything left buffered.
    ///
    /// Idempotent and re-callable: a restore swaps the file and adopts a NEW connection (AD-9), and
    /// that connection needs the hook as much as the first one did.
    pub fn attach(&self, conn: &Connection) -> Result<(), AppError> {
        self.discard();

        let shapes = Arc::clone(&self.inner.shapes);
        let buffer = Arc::clone(&self.inner.buffer);

        conn.preupdate_hook(Some(
            move |_action: Action, database: &str, table: &str, case: &PreUpdateCase| {
                observe(&shapes, &buffer, database, table, case);
            },
        ))?;

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
    pub(crate) fn begin(&self) {
        self.discard();
    }

    pub(crate) fn discard(&self) {
        let mut buffer = self.lock();
        buffer.changes.clear();
        buffer.fault = None;
    }

    /// How many changes are buffered, which is what a savepoint rolls back to.
    // Story 17 is the first production caller, through `WriteTx::savepoint`.
    #[allow(dead_code)]
    pub(crate) fn mark(&self) -> usize {
        self.lock().changes.len()
    }

    #[allow(dead_code)]
    pub(crate) fn rollback_to(&self, mark: usize) {
        let mut buffer = self.lock();
        if mark < buffer.changes.len() {
            buffer.changes.truncate(mark);
        }
    }

    /// Turns everything buffered into messages, on the caller's own transaction.
    ///
    /// Takes the changes OUT of the buffer before writing any of them, so the hook firing for this
    /// function's own writes could never deadlock on the buffer's lock. It cannot fire — every
    /// table written here is `LocalOnly` — and the emptiness check at the end is what proves that
    /// rather than assuming it.
    pub(crate) fn flush(&self, conn: &Connection) -> Result<FlushReport, AppError> {
        let (changes, fault) = {
            let mut buffer = self.lock();
            (std::mem::take(&mut buffer.changes), buffer.fault.take())
        };

        if let Some(fault) = fault {
            return Err(AppError::Database {
                message: format!(
                    "a change could not be captured and the write was rolled back: {fault}"
                ),
            });
        }

        let changes = collapse_replacements(changes);
        let mut report = FlushReport {
            messages: 0,
            changes: changes.len(),
        };

        for change in &changes {
            report.messages += self.write_change(conn, change)?;
        }

        let leaked = self.lock().changes.len();
        if leaked > 0 {
            return Err(AppError::Database {
                message: format!("the capture flush was itself captured ({leaked} changes)"),
            });
        }

        Ok(report)
    }

    fn lock(&self) -> MutexGuard<'_, Buffer> {
        // A panicking hook cannot leave the buffer half-written — a push either happened or did
        // not — so the poison flag carries no information worth propagating, and honouring it
        // would turn an unrelated panic elsewhere into permanently uncapturable writes.
        self.inner
            .buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn write_change(&self, conn: &Connection, change: &BufferedChange) -> Result<usize, AppError> {
        let shape = self
            .inner
            .shapes
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
            ChangeOp::Insert(new) => {
                let row_uuid = self.identity_of(conn, shape, row_id)?;
                self.write_fields(conn, shape, &row_uuid, None, new)
            }
            ChangeOp::Update { old, new } => {
                let row_uuid = self.identity_of(conn, shape, row_id)?;
                self.write_fields(conn, shape, &row_uuid, Some(old), new)
            }
            ChangeOp::Delete(old) => self.write_tombstone(conn, shape, row_id, old),
        }
    }

    /// The row's identity, minted now when the row is surrogate and has never been seen.
    ///
    /// A `Natural` row is an error rather than a mint: its uuid is DERIVED from its natural key
    /// (AD-2) and only its insert site knows that key, so minting a random one here would split one
    /// logical row into two on two computers. Failing the transaction is the only honest answer.
    fn identity_of(
        &self,
        conn: &Connection,
        shape: &TableShape,
        row_id: i64,
    ) -> Result<RowUuid, AppError> {
        match shape.identity {
            RowIdentity::Surrogate | RowIdentity::SurrogateOrTemplate => {
                identity::uuid_for(conn, shape.table, row_id)
            }
            RowIdentity::Natural => sync_identity::lookup(conn, shape.table, row_id)?.ok_or_else(
                || AppError::Database {
                    message: format!(
                        "a {} row was written through ActiveDataset::write without the derived \
                         identity AD-2 requires at its insert site",
                        shape.table
                    ),
                },
            ),
        }
    }

    fn write_fields(
        &self,
        conn: &Connection,
        shape: &TableShape,
        row_uuid: &RowUuid,
        old: Option<&[Value]>,
        new: &[Value],
    ) -> Result<usize, AppError> {
        let mut written = 0;

        for (index, column) in shape.columns.iter().enumerate() {
            let after = value_at(new, index, shape.table, &column.name)?;
            let before = match old {
                Some(values) => Some(value_at(values, index, shape.table, &column.name)?),
                None => None,
            };

            if before == Some(after) {
                continue;
            }

            written += match column.merge {
                MergeKind::Lww => {
                    self.write_field(conn, shape.table, row_uuid, &column.name, after)?
                }
                MergeKind::Immutable => match before {
                    // AD-5: a later write to an immutable column is a bug, not a concurrent edit,
                    // and must not silently become an Lww winner on every other computer. Named
                    // without its value, per AD-16.
                    Some(_) => {
                        warn!(
                            "an immutable column changed locally and was not captured: {}.{}",
                            shape.table, column.name
                        );
                        0
                    }
                    None => self.write_field(conn, shape.table, row_uuid, &column.name, after)?,
                },
                MergeKind::Counter => match before {
                    Some(previous) => self.write_counter_delta(
                        conn,
                        shape,
                        row_uuid,
                        &column.name,
                        previous,
                        after,
                    )?,
                    // The row was just created, so its counter is at the schema default every
                    // computer creates it with; a delta from nothing would double-count it.
                    None => 0,
                },
                MergeKind::LocalId => match column.parent {
                    Some(parent) => {
                        let resolved = self.parent_reference(conn, parent, after)?;
                        self.write_field(conn, shape.table, row_uuid, &column.name, &resolved)?
                    }
                    None => 0,
                },
                // AD-5: `balance_cents` is never generically captured (Story 16's emitters own it),
                // and AD-10 keeps image bytes out of every message.
                MergeKind::Balance | MergeKind::Excluded => 0,
            };
        }

        Ok(written)
    }

    fn write_field(
        &self,
        conn: &Connection,
        table: &str,
        row_uuid: &RowUuid,
        column: &str,
        value: &Value,
    ) -> Result<usize, AppError> {
        let hlc = self.inner.clock.now().encode();
        let encoded = payload::encode(value);

        sync_capture::append(
            conn,
            &LoggedMessage {
                install: &self.inner.install,
                hlc: &hlc,
                kind: "field",
                table_name: table,
                row_uuid,
                column_name: Some(column),
                cause_uuid: None,
                payload: Some(&encoded),
            },
        )?;

        sync_capture::upsert_field_state(
            conn,
            table,
            row_uuid,
            column,
            &hlc,
            &self.inner.install,
            &content_hash(&encoded),
        )?;

        Ok(1)
    }

    /// AD-5's counter: the hook's `new − old`, so the value is the sum of deltas and two computers
    /// incrementing once each end up at two rather than one.
    fn write_counter_delta(
        &self,
        conn: &Connection,
        shape: &TableShape,
        row_uuid: &RowUuid,
        column: &str,
        before: &Value,
        after: &Value,
    ) -> Result<usize, AppError> {
        let (Value::Integer(before), Value::Integer(after)) = (before, after) else {
            return Err(AppError::Database {
                message: format!(
                    "{}.{} is a counter but did not hold an integer",
                    shape.table, column
                ),
            });
        };

        let delta = after.wrapping_sub(*before);
        if delta == 0 {
            return Ok(0);
        }

        let hlc = self.inner.clock.now().encode();
        let encoded = payload::encode(&Value::Integer(delta));

        sync_capture::append(
            conn,
            &LoggedMessage {
                install: &self.inner.install,
                hlc: &hlc,
                kind: "counter_delta",
                table_name: shape.table,
                row_uuid,
                column_name: Some(column),
                cause_uuid: None,
                payload: Some(&encoded),
            },
        )?;

        Ok(1)
    }

    /// A foreign key in uuid space (AD-2). A NULL stays NULL — that is what the `SET NULL` edges
    /// replay as (AD-12).
    fn parent_reference(
        &self,
        conn: &Connection,
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

        let shape = self
            .inner
            .shapes
            .get(parent)
            .ok_or_else(|| unknown_table(parent))?;

        Ok(Value::Blob(
            self.identity_of(conn, shape, parent_row)?.to_vec(),
        ))
    }

    /// A delete is one tombstone message carrying the whole row (AD-5, AD-12), after which the
    /// identity mapping is dropped so a reused rowid cannot inherit the deleted row's identity.
    ///
    /// A row with no mapping produces NO message on purpose: it was never given an identity, so it
    /// has never been shipped under one and no other computer knows it exists. Reconcile (Story 22)
    /// owns rows that predate capture.
    fn write_tombstone(
        &self,
        conn: &Connection,
        shape: &TableShape,
        row_id: i64,
        old: &[Value],
    ) -> Result<usize, AppError> {
        let Some(row_uuid) = sync_identity::lookup(conn, shape.table, row_id)? else {
            return Ok(0);
        };

        let row_json = self.row_json(conn, shape, old)?;
        let hlc = self.inner.clock.now().encode();
        let encoded = payload::encode(&Value::Text(row_json));

        sync_capture::append(
            conn,
            &LoggedMessage {
                install: &self.inner.install,
                hlc: &hlc,
                kind: "tombstone",
                table_name: shape.table,
                row_uuid: &row_uuid,
                column_name: None,
                cause_uuid: None,
                payload: Some(&encoded),
            },
        )?;

        sync_capture::forget_field_state(conn, shape.table, &row_uuid)?;
        sync_identity::forget(conn, shape.table, row_id)?;

        Ok(1)
    }

    /// The deleted row as a JSON object, column name to value.
    ///
    /// Self-describing rather than positional because a restore reads it in a LATER app version,
    /// possibly after a migration added a column. Local integers are left out and foreign keys are
    /// written as their parent's uuid (AD-2); image bytes are left out (AD-10). A blob is hex so
    /// the document stays valid JSON.
    fn row_json(
        &self,
        conn: &Connection,
        shape: &TableShape,
        values: &[Value],
    ) -> Result<String, AppError> {
        let mut row = serde_json::Map::new();

        for (index, column) in shape.columns.iter().enumerate() {
            let value = value_at(values, index, shape.table, &column.name)?;

            let json = match column.merge {
                MergeKind::Excluded => continue,
                // Looked up and never MINTED, unlike a live row's foreign key. A cascade reaches
                // the parent first (depth 0 before depth 1), and recording its tombstone drops the
                // parent's mapping — so minting here would bind a brand-new identity to a row that
                // no longer exists and name it in the child's tombstone, where no replica could
                // ever resolve it. `null` is the honest answer: the parent is gone too.
                MergeKind::LocalId => match (column.parent, value) {
                    (Some(parent), Value::Integer(row_id)) => {
                        match sync_identity::lookup(conn, parent, *row_id)? {
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

    #[cfg(test)]
    pub(crate) fn install_id(&self) -> &str {
        &self.inner.install
    }

    #[cfg(test)]
    pub(crate) fn buffered_depths(&self) -> Vec<(&'static str, i32)> {
        self.lock()
            .changes
            .iter()
            .map(|change| (change.table, change.depth))
            .collect()
    }
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
fn collapse_replacements(changes: Vec<BufferedChange>) -> Vec<BufferedChange> {
    let mut collapsed: Vec<BufferedChange> = Vec::with_capacity(changes.len());

    for change in changes {
        let replaces = matches!(change.op, ChangeOp::Insert(_))
            && collapsed.last().is_some_and(|previous| {
                matches!(previous.op, ChangeOp::Delete(_))
                    && previous.table == change.table
                    && previous.row_id.is_some()
                    && previous.row_id == change.row_id
            });

        match (replaces, collapsed.pop_if(|_| replaces)) {
            (true, Some(previous)) => collapsed.push(upsert(previous, change)),
            (true, None) | (false, None) => collapsed.push(change),
            (false, Some(previous)) => {
                collapsed.push(previous);
                collapsed.push(change);
            }
        }
    }

    collapsed
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
        // Unreachable: the caller matched both halves before popping. Keeping the insert is what
        // makes this an unreachable branch rather than a lost change.
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
    let state = super::state::ensure_install_on(conn)?;
    let mut shapes = resolve_shapes(conn)?;

    let columns = sync_capture::table_columns(conn, extra)?
        .into_iter()
        .map(|name| ColumnShape {
            name,
            merge,
            parent: None,
        })
        .collect();

    shapes.insert(
        extra,
        TableShape {
            table: extra,
            identity,
            has_rowid: sync_capture::table_has_rowid(conn, extra)?,
            columns,
        },
    );

    Ok(Capture {
        inner: Arc::new(CaptureInner {
            clock: clock_for(&state.install_id)?,
            install: state.install_id,
            shapes: Arc::new(shapes),
            buffer: Arc::new(Mutex::new(Buffer::default())),
        }),
    })
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
fn content_hash(encoded: &[u8]) -> String {
    let mut material = Vec::with_capacity(FIELD_HASH_DOMAIN.len() + encoded.len());
    material.extend_from_slice(FIELD_HASH_DOMAIN);
    material.extend_from_slice(encoded);

    crate::projects::image::sha256_hex(&material)
}

fn unknown_table(table: &str) -> AppError {
    AppError::Database {
        message: format!("{table} is not a table sync knows about (AD-5)"),
    }
}
