//! The REAL pipeline as a `ReplicaEngine`: capture -> segment -> apply, with nothing simulated.
//!
//! This is what Stories 13 and 15 left as the seam. `local_write` is a real
//! `ActiveDataset::write` with the real pre-update hook, `flush` is `segment::cut` +
//! `mark_shipped`, `deliver` verifies the real framed object and hands it to `sync::apply` on a
//! SECOND connection with no hook, and `observable` reads the whole schema back out of the tables
//! in uuid space. The assertions in `runner.rs` did not move and must not: if a property has to be
//! weakened for this engine, this engine is wrong.
//!
//! WHAT IS STILL THE SIMULATOR'S AND NOT THE PRODUCT'S, stated so no one reads more into a green
//! run than it says:
//!
//! * The TRANSPORT is the runner's in-memory vector of objects. The bytes are the real framed,
//!   compressed, hash-checked segment; what is missing is S3's conditional writes, which Story 19
//!   proves against `FakeObjectStore` instead.
//! * The WALL CLOCK is each dataset's own: capture builds its `Clock` inside `Capture::attach`
//!   from the install id in `sync_state`, so what the runner injects is the thread's DEFAULT wall
//!   clock (`clock::scope_default_wall_clock`) rather than an argument. It has to inject one: with
//!   the system clock behind the real pipeline, two ops landing in the same millisecond are
//!   resolved by the install-id tiebreak instead of by the order they happened, which made a
//!   pinned seed pass or fail depending on how fast the machine ran. The reference engine reads
//!   the same millisecond, so the same-millisecond tiebreak is still exercised — deterministically.
//! * The SHARED BASE rows (`budget_groups`, `budget_categories`) are given DETERMINISTIC identities
//!   at open. They stand for the rows a dataset already held when it was cloned, and every replica
//!   has to agree on them or a hint's `budget_category_id` would travel as a uuid the other
//!   computer has never seen. In production that agreement comes from the bootstrap snapshot, which
//!   is why the ledger records that Story 23's snapshot MUST carry `sync_uuid`.

use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use rusqlite::Connection;

use crate::db::backup::{self, DatasetSlot};
use crate::db::sim_tables::{self, SimCell};
use crate::db::sync_apply as apply_db;
use crate::db::{snapshot_strip, sync_identity, sync_segment, sync_state, test_dataset, ActiveDataset};
use crate::models::DatasetKind;
use crate::sync::apply;
use crate::sync::capture::{BalanceCause, Capture};
use crate::sync::clock::{self, machine_fingerprint, Clock, Hlc, MachineSignals, WallClock};
use crate::sync::registry::{self, MergeKind, TableClass};
use crate::sync::segment::{self, SegmentBatch};
use crate::sync::sim::engine::{ReplicaEngine, SimError};
use crate::sync::sim::model::{self, Change, Observable, RowUuid, Table};
use crate::sync::snapshot;
use crate::sync::state::{remint_install_on, InstallOutcome};

/// The table a simulated balance cause is attributed to.
///
/// `expenses` because that is what the real emitters key a delta by (AD-5: "two computers deleting
/// the same expense produce one delta"). The row itself is never inserted — the cause key is a pure
/// function of the cause ROW'S uuid, and `sync_uuid` deliberately has no foreign key into a data
/// table (Story 14), so binding the identity is all a cause needs.
const CAUSE_TABLE: &str = "expenses";

/// One segment as it really travels: the framed, compressed object plus the key it was written
/// under, which is what `read_segment` checks the payload against (AD-6, AD-8).
#[derive(Debug, Clone)]
pub(crate) struct RealSegment {
    install: String,
    seq: i64,
    object: Vec<u8>,
}

pub(crate) struct RealEngine {
    install: String,
    db_path: PathBuf,
    dataset: ActiveDataset,
    /// AD-11's second connection: WAL, busy timeout, foreign keys on, and no capture hook because
    /// the hook is per connection.
    apply: Connection,
    clock: Arc<Clock>,
    causes: HashMap<RowUuid, i64>,
    next_cause_row_id: i64,
    /// Segments that arrived ahead of a gap, keyed `(install, seq)`.
    ///
    /// AD-11 applies one install's segments in CONTIGUOUS `seq` order, and in production that
    /// ordering is the pull side's (Story 19's `PullCursor` buffers exactly like this). The
    /// simulator's transport reorders deliberately, so the engine — which stands for the whole
    /// computer, not just the apply function — has to hold a segment back until its predecessor
    /// has been applied.
    buffered: BTreeMap<(String, i64), Vec<u8>>,
}

impl RealEngine {
    pub(crate) fn open(
        install_id: &str,
        db_path: &Path,
        _wall: WallClock,
    ) -> Result<Self, SimError> {
        let conn = test_dataset::migrated_dataset(db_path);
        sim_tables::seed_shared_base(&conn)?;

        // Seeded BEFORE the hook is installed, so capture stamps under the install id the scenario
        // names instead of minting a random one — which is what keeps a seed replayable.
        sync_state::ensure(
            &conn,
            install_id,
            &machine_fingerprint(&MachineSignals::from_environment()),
        )
        .map_err(sql)?;
        bind_base_identities(&conn)?;

        let capture = Capture::for_dataset(DatasetKind::CloudLinked, &conn)
            .map_err(sql)?
            .ok_or_else(|| SimError::Model("a cloud-linked dataset must capture".into()))?;
        capture.attach(&conn).map_err(sql)?;

        let apply = crate::db::open_configured(db_path).map_err(sql)?;
        let clock = clock::shared(install_id, &clock::dataset_key(&apply))?;

        Ok(Self {
            install: install_id.to_string(),
            db_path: db_path.to_path_buf(),
            dataset: ActiveDataset {
                id: Some(format!("sim-{install_id}")),
                conn: Some(conn),
                capture: Some(capture),
            },
            apply,
            clock,
            causes: HashMap::new(),
            next_cause_row_id: 1,
            buffered: BTreeMap::new(),
        })
    }

    /// Opens a database that is ALREADY a dataset — restored, or copied from another replica —
    /// instead of migrating and seeding a fresh one.
    ///
    /// Everything `open` does to a blank file (migrate, seed the shared base, mint an install id,
    /// bind the base identities) is already in this file, and re-doing any of it would either
    /// duplicate the base rows or split the `(install, seq)` space.
    fn attach_existing(db_path: &Path, conn: Connection) -> Result<(ActiveDataset, Connection, String, Arc<Clock>), SimError> {
        let install = sync_state::load(&conn)
            .map_err(sql)?
            .ok_or_else(|| SimError::Model("an adopted dataset has no sync_state row".into()))?
            .install_id;

        let capture = Capture::for_dataset(DatasetKind::CloudLinked, &conn)
            .map_err(sql)?
            .ok_or_else(|| SimError::Model("a cloud-linked dataset must capture".into()))?;
        capture.attach(&conn).map_err(sql)?;

        let apply = crate::db::open_configured(db_path).map_err(sql)?;
        let clock = clock::shared(&install, &clock::dataset_key(&apply))?;

        Ok((
            ActiveDataset {
                id: Some(format!("sim-{install}")),
                conn: Some(conn),
                capture: Some(capture),
            },
            apply,
            install,
            clock,
        ))
    }

    /// Folds the WAL back into the main database file.
    ///
    /// Mandatory before anything reads this dataset as a FILE: a `-wal` holding the most recent
    /// commits does not travel with a `fs::copy`, so a copy taken without this is a silently
    /// stale database. Every production copy site checkpoints first for the same reason.
    fn fold_wal(&self) -> Result<(), SimError> {
        self.conn()?
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
        self.apply.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;

        Ok(())
    }

    fn conn(&self) -> Result<&Connection, SimError> {
        self.dataset
            .conn
            .as_ref()
            .ok_or_else(|| SimError::Model("the live connection is gone".into()))
    }

    fn row_id_of(&self, table: Table, row: RowUuid) -> Result<Option<i64>, SimError> {
        sync_identity::row_id_for(self.conn()?, table.sql(), &row).map_err(sql)
    }

    fn next_seq(&self, install: &str) -> Result<i64, SimError> {
        let next = match apply_db::applied_position(&self.apply, install).map_err(sql)? {
            Some((seq, _)) => seq + 1,
            None => 0,
        };

        Ok(next)
    }

    fn apply_object(&self, install: &str, seq: i64, object: &[u8]) -> Result<(), SimError> {
        let verified = segment::read_segment(object, install, seq)
            .map_err(|error| SimError::Model(format!("a segment was refused: {error:?}")))?;

        apply::apply_batch(
            &self.apply,
            &self.clock,
            &SegmentBatch {
                install: install.to_string(),
                seq,
                messages: verified.messages,
            },
        )
        .map_err(sql)?;

        Ok(())
    }

    /// The local id of a cause row, taken from the FILE whenever the file already names it.
    ///
    /// The cause key is a function of the cause ROW'S uuid (Story 16), so an id this engine made up
    /// on its own is only usable while no other numbering is in the file. A restore puts one there:
    /// the snapshot carries the account's cause rows together with their `sync_uuid` mappings, under
    /// the id they had on the computer that wrote it, and `sync_identity::ensure` is
    /// first-writer-wins on the uuid — so a private counter would quietly bind a FRESH uuid to its
    /// own id and emit a different cause key for the same real-world action. In production the cause
    /// row is a real `expenses` row whose id and uuid travel together for exactly this reason; here
    /// the rows are identities only, so the engine has to ask the file the same question.
    fn cause_row_id(&mut self, cause: RowUuid) -> Result<i64, SimError> {
        if let Some(row_id) =
            sync_identity::row_id_for(self.conn()?, CAUSE_TABLE, &cause).map_err(sql)?
        {
            self.causes.insert(cause, row_id);
            return Ok(row_id);
        }

        if let Some(row_id) = self.causes.get(&cause) {
            return Ok(*row_id);
        }

        let mut row_id = self.next_cause_row_id;
        while sync_identity::lookup(self.conn()?, CAUSE_TABLE, row_id)
            .map_err(sql)?
            .is_some()
        {
            row_id += 1;
        }
        self.next_cause_row_id = row_id + 1;
        self.causes.insert(cause, row_id);

        Ok(row_id)
    }

    /// The stamp capture gave the messages this write produced, read back out of the log.
    ///
    /// The oracle needs the REAL stamp — it computes the expected winner from the stamps alone — and
    /// capture owns the clock, so the only honest way to learn it is to read what it wrote. The
    /// FIRST new row is taken because a cascading delete stamps one message per row.
    fn stamp_after(&self, highest_before: i64) -> Result<Hlc, SimError> {
        let encoded: String = self
            .conn()?
            .query_row(
                "SELECT hlc FROM sync_log WHERE id > ?1 ORDER BY id LIMIT 1",
                [highest_before],
                |row| row.get(0),
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => {
                    SimError::Model("a local write produced no message".into())
                }
                other => SimError::Sql(other.to_string()),
            })?;

        Hlc::decode(&encoded).map_err(SimError::Clock)
    }

    fn highest_message_id(&self) -> Result<i64, SimError> {
        let highest = self
            .conn()?
            .query_row("SELECT COALESCE(MAX(id), 0) FROM sync_log", [], |row| {
                row.get(0)
            })
            .map_err(|error| SimError::Sql(error.to_string()))?;

        Ok(highest)
    }

    fn write_upsert(
        &mut self,
        table: Table,
        row: RowUuid,
        parent: Option<RowUuid>,
        fields: &[(&'static str, SimCell)],
    ) -> Result<(), SimError> {
        let existing = self.row_id_of(table, row)?;
        let parent_id = match (table.parent(), parent) {
            (Some((parent_table, _)), Some(parent_row)) => self.row_id_of(parent_table, parent_row)?,
            _ => None,
        };
        let table_sql = table.sql();
        let fields = fields.to_vec();

        self.dataset
            .write(|tx| match existing {
                Some(row_id) => {
                    sim_tables::update_row(tx, table_sql, row_id, &fields)?;
                    Ok(())
                }
                None => {
                    let mut columns = fields.clone();
                    // Created at ZERO, so the row's count is carried entirely by deltas (Story 16).
                    // The hook emits the initial value of a counter column as a delta from zero, and
                    // the scenario emits its own `+1` right after the insert to model exactly that;
                    // letting the schema default of 1 stand would make those two the same increment
                    // counted twice.
                    if let Some(counter) = table.counter_column() {
                        columns.push((counter, SimCell::Int(0)));
                    }
                    if let Some((_, foreign_key)) = table.parent() {
                        let parent_id = parent_id.ok_or_else(|| crate::error::AppError::Database {
                            message: format!("a {table_sql} row was written before its parent"),
                        })?;
                        columns.push((foreign_key, SimCell::Int(parent_id)));
                    }

                    let row_id = sim_tables::insert_row(tx, table_sql, &columns)?;

                    // AD-2: the scenario owns the identity, so it is bound BEFORE the flush would
                    // mint a random one. For `merchant_category_hints` this is not an optimization:
                    // capture FAILS the whole write for a natural-key row with no mapping.
                    sync_identity::ensure(tx, table_sql, row_id, &row)?;

                    Ok(())
                }
            })
            .map_err(sql)
    }

    fn write_balance_set(&mut self, row: RowUuid, cents: i64) -> Result<(), SimError> {
        let Some(row_id) = self.row_id_of(Table::Accounts, row)? else {
            return Err(SimError::Model("a balance set before its account".into()));
        };

        self.dataset
            .write(|tx| {
                sim_tables::update_row(
                    tx,
                    Table::Accounts.sql(),
                    row_id,
                    &[("balance_cents", SimCell::Int(cents))],
                )?;
                crate::sync::capture::emit_balance_set(row_id, cents);

                Ok(())
            })
            .map_err(sql)
    }

    fn write_balance_delta(
        &mut self,
        row: RowUuid,
        cause: RowUuid,
        cents: i64,
    ) -> Result<(), SimError> {
        let Some(row_id) = self.row_id_of(Table::Accounts, row)? else {
            return Err(SimError::Model("a balance delta before its account".into()));
        };
        let cause_row_id = self.cause_row_id(cause)?;

        self.dataset
            .write(|tx| {
                // The cause key is a function of the cause ROW'S uuid (Story 16), so the two
                // computers only agree if both resolve this cause to the same identity.
                sync_identity::ensure(tx, CAUSE_TABLE, cause_row_id, &cause)?;

                let current: i64 = tx.query_row(
                    "SELECT balance_cents FROM accounts WHERE id = ?1",
                    [row_id],
                    |stored| stored.get(0),
                )?;
                sim_tables::update_row(
                    tx,
                    Table::Accounts.sql(),
                    row_id,
                    &[("balance_cents", SimCell::Int(current.wrapping_add(cents)))],
                )?;
                crate::sync::capture::emit_balance_delta(
                    row_id,
                    cents,
                    CAUSE_TABLE,
                    cause_row_id,
                    BalanceCause::Deleted,
                );

                Ok(())
            })
            .map_err(sql)
    }
}

/// Deterministic identities for the rows every replica started with.
///
/// Without them a `merchant_category_hints` message would carry a `budget_category_id` uuid minted
/// locally and random, and the other replica would park it forever — the "rows that predate
/// capture" gap Story 15 recorded and Story 22's reconcile owns in production.
fn bind_base_identities(conn: &Connection) -> Result<(), SimError> {
    sync_identity::ensure(conn, "budget_groups", 1, &model::base_row_uuid("budget_groups", 1))
        .map_err(sql)?;

    for id in crate::db::sim_tables::SIM_CATEGORY_IDS {
        sync_identity::ensure(
            conn,
            "budget_categories",
            id,
            &model::base_row_uuid("budget_categories", id),
        )
        .map_err(sql)?;
    }

    Ok(())
}

fn sql(error: crate::error::AppError) -> SimError {
    SimError::Sql(error.to_string())
}

/// The `DatasetSlot` a replica is, for the one call that needs it.
///
/// `restore_snapshot_file` closes the dataset's connections through this seam and publishes the
/// restored one back through it, and it takes `&self` while the engine owns itself by `&mut self`
/// — the exact shape Story 25 recorded as the blocker. The engine therefore MOVES its connections
/// in here before the call and takes the restored one back out after it, so the live file is still
/// open while `carry_local_only` reads this computer's own state out of it (AD-9) and closed before
/// the single copy that replaces it.
#[derive(Default)]
struct ReplicaSlot {
    live: RefCell<Vec<Connection>>,
    restored: RefCell<Option<Connection>>,
}

impl DatasetSlot for ReplicaSlot {
    fn close(&self) -> Result<(), crate::error::AppError> {
        for conn in self.live.borrow_mut().drain(..) {
            if let Err(error) = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)") {
                return Err(crate::error::AppError::Database {
                    message: error.to_string(),
                });
            }
            drop(conn);
        }

        Ok(())
    }

    fn adopt(&self, conn: Connection) -> Result<(), crate::error::AppError> {
        *self.restored.borrow_mut() = Some(conn);

        Ok(())
    }
}

impl ReplicaEngine for RealEngine {
    type Segment = RealSegment;

    fn local_write(&mut self, change: &Change) -> Result<Hlc, SimError> {
        let before = self.highest_message_id()?;

        match change {
            Change::Upsert {
                table,
                row,
                parent,
                fields,
            } => {
                let existed = self.row_id_of(*table, *row)?.is_some();
                self.write_upsert(*table, *row, *parent, fields)?;

                // An upsert onto a row this replica already holds can write the values it already
                // has — the natural key of a `merchant_category_hints` row IS its columns — and the
                // hook emits nothing for an unchanged column (AD-3). The stamp is then only needed
                // to record the intent, and the values it would "win" with are the ones every
                // replica already agrees on.
                if existed {
                    return self.stamp_after(before).or_else(|_| Ok(self.clock.now()));
                }
            }
            Change::Tombstone { table, row } => {
                // A second delete of a row this replica no longer holds produces NO message, and
                // that is the correct behaviour rather than a gap: the row is already gone here, so
                // there is no change to capture. The scenario still counts the intent (AD-19's
                // double delete), and the stamp it gets back is only ever compared for a FIELD —
                // `tombstoned` is a set, not a clock.
                let Some(row_id) = self.row_id_of(*table, *row)? else {
                    return Ok(self.clock.now());
                };
                let table_sql = table.sql();
                self.dataset
                    .write(|tx| {
                        sim_tables::delete_row(tx, table_sql, row_id)?;
                        Ok(())
                    })
                    .map_err(sql)?;
            }
            Change::BalanceSet { row, cents } => self.write_balance_set(*row, *cents)?,
            Change::BalanceDelta { row, cause, cents } => {
                self.write_balance_delta(*row, cause.0, *cents)?
            }
            Change::CounterDelta { table, row, delta } => {
                let Some(row_id) = self.row_id_of(*table, *row)? else {
                    return Err(SimError::Model("a counter delta before its row".into()));
                };
                let column = table
                    .counter_column()
                    .ok_or_else(|| SimError::Model("a counter delta on a counterless table".into()))?;
                let table_sql = table.sql();
                let delta = *delta;
                self.dataset
                    .write(|tx| {
                        sim_tables::bump_counter(tx, table_sql, row_id, column, delta)?;
                        Ok(())
                    })
                    .map_err(sql)?;
            }
        }

        self.stamp_after(before)
    }

    fn flush(&mut self) -> Result<Option<Self::Segment>, SimError> {
        let schema_version = u32::try_from(crate::db::latest_schema_version()).unwrap_or(u32::MAX);
        let conn = self.conn()?;

        let Some(cut) = segment::cut(conn, &self.install, schema_version).map_err(sql)? else {
            return Ok(None);
        };
        segment::mark_shipped(conn, &cut).map_err(sql)?;

        Ok(Some(RealSegment {
            install: cut.install.clone(),
            seq: cut.seq,
            object: cut.object.clone(),
        }))
    }

    fn deliver(&mut self, segment: &Self::Segment) -> Result<(), SimError> {
        // A segment at or below the applied position is handed straight on: it is a DUPLICATE
        // delivery (AD-6 expects them) and apply recognizes it, while buffering it would leave a
        // key behind the watermark in the buffer forever.
        if self.next_seq(&segment.install)? > segment.seq {
            return self.apply_object(&segment.install, segment.seq, &segment.object);
        }

        self.buffered.insert(
            (segment.install.clone(), segment.seq),
            segment.object.clone(),
        );

        loop {
            let next = self.next_seq(&segment.install)?;
            let key = (segment.install.clone(), next);
            let Some(object) = self.buffered.remove(&key) else {
                return Ok(());
            };

            self.apply_object(&segment.install, next, &object)?;
        }
    }

    /// The WHOLE schema in uuid space, which is what Story 13 left to this story.
    ///
    /// Every `Synced`/`AppendOnly` table is dumped, not only the four the scenario drives, so a
    /// remote message that wrote a row into any other table shows up as a divergence rather than as
    /// nothing. A row with no `sync_uuid` mapping is invisible: in uuid space it has no identity to
    /// compare, and the only such rows are the never-edited shared base.
    fn observable(&self) -> Result<Observable, SimError> {
        let conn = &self.apply;
        let mut observable = Observable::new();
        for table in Table::ALL {
            observable.insert(table.sql(), BTreeMap::new());
        }

        for rule in registry::TABLES {
            if matches!(rule.class, TableClass::LocalOnly) {
                continue;
            }

            let simulated = Table::from_sql(rule.table);
            let columns = dump_columns(rule.table, simulated);
            let mut rows = BTreeMap::new();

            for (row_id, cells) in sim_tables::dump_rows(conn, rule.table, &columns)? {
                let Some(row_uuid) =
                    sync_identity::lookup(conn, rule.table, row_id).map_err(sql)?
                else {
                    continue;
                };
                // The shared base is identical on every replica BY CONSTRUCTION and the oracle —
                // which only knows the ops the scenario issued — cannot express it. It is proven
                // identical by `db::sim_tables`'s own test instead; what belongs in this dump is
                // every row the PIPELINE wrote.
                if row_uuid == model::base_row_uuid(rule.table, row_id) {
                    continue;
                }

                let mut translated = BTreeMap::new();
                for (column, cell) in cells {
                    translated.insert(
                        column,
                        translate_cell(conn, rule.table, simulated, column, cell)?,
                    );
                }
                rows.insert(row_uuid, translated);
            }

            if !rows.is_empty() || observable.contains_key(rule.table) {
                observable.insert(rule.table, rows);
            }
        }

        Ok(observable)
    }

    fn pending_count(&self) -> usize {
        let parked = apply_db::parked_count(&self.apply)
            .map(|count| usize::try_from(count).unwrap_or(usize::MAX))
            .unwrap_or(0);

        parked + self.buffered.len()
    }

    fn install_id(&self) -> &str {
        &self.install
    }

    fn shipped_head(&self) -> Result<Option<i64>, SimError> {
        let next = sync_segment::next_seq(self.conn()?, &self.install).map_err(sql)?;

        Ok((next > 0).then_some(next - 1))
    }

    fn applied_heads(&self) -> Result<BTreeMap<String, i64>, SimError> {
        snapshot_strip::read_watermark(self.conn()?).map_err(sql)
    }

    fn bootstrap_image(&mut self) -> Result<Option<Vec<u8>>, SimError> {
        self.fold_wal()?;
        let schema_version = u32::try_from(crate::db::latest_schema_version()).unwrap_or(u32::MAX);
        let built = snapshot::build_snapshot_blocking(&self.db_path, schema_version)
            .map_err(|error| SimError::Model(format!("a snapshot could not be built: {error}")))?;

        Ok(Some(built.object))
    }

    /// The real re-bootstrap (AD-9), end to end: verify the object, swap the file through the
    /// guarded swap, then re-materialize the unsent log the swap carried over.
    ///
    /// Two decisions worth stating because neither is free. (1) The install id is NOT re-minted:
    /// `carry_local_only` puts THIS computer's `sync_state` back, which is strictly safer than a
    /// fresh id — the carried unsent rows are keyed by install and a re-mint would orphan them out
    /// of `segment::cut`'s reach, which is the lost edit the oracle would report. AD-4's re-mint is
    /// for a DUPLICATED file, which is `clone_to` below. (2) The replay runs on the APPLY
    /// connection, which has no capture hook: replaying through the hooked one would capture the
    /// replay as fresh local writes, and a second `counter_delta` for one increment double-counts.
    fn restore_from_image(&mut self, image: &[u8]) -> Result<bool, SimError> {
        let verified = snapshot::read_snapshot(image)
            .map_err(|error| SimError::Model(format!("a snapshot was refused: {error}")))?;

        let slot = ReplicaSlot::default();
        self.dataset.capture = None;
        if let Some(conn) = self.dataset.conn.take() {
            slot.live.borrow_mut().push(conn);
        }
        let placeholder = Connection::open_in_memory()?;
        slot.live
            .borrow_mut()
            .push(std::mem::replace(&mut self.apply, placeholder));

        backup::restore_snapshot_file(&slot, &self.db_path, &verified.payload, None)
            .map_err(|error| SimError::Model(format!("the guarded swap failed: {error}")))?;

        let restored = slot
            .restored
            .borrow_mut()
            .take()
            .ok_or_else(|| SimError::Model("the guarded swap published no connection".into()))?;
        let (dataset, apply, install, clock) = Self::attach_existing(&self.db_path, restored)?;
        self.dataset = dataset;
        self.apply = apply;
        self.install = install;
        self.clock = clock;
        // The restored file carries its OWN applied vector, so anything buffered behind a gap in
        // the file that is gone says nothing about the file that replaced it (Story 23's
        // `reopen_applier` resets the pull cursor for the same reason).
        self.buffered.clear();

        apply::replay_own_unsent(&self.apply, &self.clock, &self.install).map_err(sql)?;

        Ok(true)
    }

    /// A second computer holding a duplicate of this one's file (AD-4, AD-15).
    ///
    /// `remint_install_on` is the production verb for exactly this case and is what settles the
    /// `(install, seq)` question; the id it minted is then pinned to the scenario's seed-derived
    /// one so a failure still replays from a single number (Story 13), which is sound because an
    /// install id is only ever compared as the LWW tiebreak and the oracle reads the real stamps.
    ///
    /// The unsent rows are DROPPED, exactly like CAP-5's replace: the source still ships them
    /// itself, so nothing is lost, while keeping them would ship one increment from two computers.
    fn clone_to(&mut self, db_path: &Path, install_id: &str) -> Result<Option<Self>, SimError> {
        self.fold_wal()?;
        std::fs::copy(&self.db_path, db_path)
            .map_err(|error| SimError::Model(format!("the dataset could not be copied: {error}")))?;

        let conn = crate::db::open_configured(db_path).map_err(sql)?;
        if remint_install_on(&conn).map_err(sql)? != InstallOutcome::Relinked {
            return Err(SimError::Model(
                "a copied dataset must RELINK, not mint a first install id".into(),
            ));
        }
        sync_state::relink_install(
            &conn,
            install_id,
            &machine_fingerprint(&MachineSignals::from_environment()),
        )
        .map_err(sql)?;
        apply::discard_unsent_and_refold(&conn).map_err(sql)?;

        let (dataset, apply, install, clock) = Self::attach_existing(db_path, conn)?;

        Ok(Some(Self {
            install,
            db_path: db_path.to_path_buf(),
            dataset,
            apply,
            clock,
            // Inherited, not reset: the cause-to-row-id map is how a balance delta resolves AD-5's
            // cause key, and `sync_identity::ensure` is first-writer-wins — a clone that re-minted
            // row ids for causes the copied `sync_uuid` already binds would emit a DIFFERENT cause
            // uuid for the same cause and the dedup rule would not fire.
            causes: self.causes.clone(),
            next_cause_row_id: self.next_cause_row_id,
            buffered: BTreeMap::new(),
        }))
    }
}

/// What a table contributes to the dump: exactly the scenario's columns for a simulated table (so
/// the oracle compares against the same cells it computes), and every declared value column for
/// everything else.
fn dump_columns(table: &'static str, simulated: Option<Table>) -> Vec<&'static str> {
    if let Some(simulated) = simulated {
        return simulated.observable_columns();
    }

    let mut columns: Vec<&'static str> = registry::columns_of(table)
        .filter(|column| match column.merge {
            MergeKind::Lww | MergeKind::Immutable | MergeKind::Counter | MergeKind::Balance => true,
            MergeKind::LocalId => registry::fk_parent(table, column.column).is_some(),
            MergeKind::Excluded => false,
        })
        .map(|column| column.column)
        .collect();
    columns.sort_unstable();

    columns
}

/// A foreign key becomes the parent's uuid (AD-2), so two replicas with different integer ids
/// compare equal.
///
/// For a SIMULATED table only the scenario's own parent edge is translated, because the reference
/// engine compares `budget_category_id` as the integer it is: the shared base carries identical ids
/// on every replica by construction, and translating one side only would be a false divergence.
fn translate_cell(
    conn: &Connection,
    table: &'static str,
    simulated: Option<Table>,
    column: &'static str,
    cell: SimCell,
) -> Result<SimCell, SimError> {
    let parent = match simulated {
        Some(simulated) => match simulated.parent() {
            Some((parent_table, foreign_key)) if foreign_key == column => Some(parent_table.sql()),
            _ => None,
        },
        None => registry::fk_parent(table, column),
    };

    let (Some(parent), SimCell::Int(parent_row_id)) = (parent, &cell) else {
        return Ok(cell);
    };

    match sync_identity::lookup(conn, parent, *parent_row_id).map_err(sql)? {
        Some(parent_uuid) => Ok(SimCell::Uuid(parent_uuid)),
        None => Ok(cell),
    }
}
