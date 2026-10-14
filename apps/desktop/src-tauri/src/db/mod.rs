use std::cell::Cell;
use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;
use tracing::info;

use crate::error::AppError;
use crate::sync::capture::Capture;

pub mod account;
pub mod aggregates;
pub mod asset;
pub mod audit;
pub mod backup;
pub mod budget;
pub mod budget_template;
pub mod chat;
pub mod config;
pub mod danger_zone;
pub mod dashboard;
pub mod expense;
pub mod financial_health;
pub mod income;
pub mod maintenance;
pub mod net_worth;
pub mod onboarding;
pub mod projection;
pub mod projects;
pub mod recurring;
pub mod recurring_income;
pub mod retirement;
pub mod snapshot_strip;
pub mod spending_trends;
pub mod sync_blobs;
pub mod sync_capture;
pub mod sync_identity;
pub mod sync_segment;
pub mod sync_state;
pub mod yearly_summary;

#[cfg(test)]
pub(crate) mod capture_fixtures;
#[cfg(test)]
pub(crate) mod sim_tables;
#[cfg(test)]
pub(crate) mod test_dataset;
#[cfg(test)]
mod tests_migration_030;
#[cfg(test)]
mod tests_sync_restore;

/// The dataset active for this run: which one it is, its open connection, and — for a
/// cloud-linked dataset only — the capture state its writes are recorded through.
///
/// All three fields live in one struct behind one lock so they swap together and
/// never independently (AD-6) — no caller can observe an id paired with a
/// different dataset's connection. `{ id: None, conn: None }` is the
/// pre-selection state, which call sites surface as `AppError::NotConfigured`
/// rather than defaulting to a dataset of their own choosing.
///
/// `capture` is `None` for a local-only profile and the hook is then never installed, so such a
/// profile provably runs no sync code at all (inherited AD-12).
pub struct ActiveDataset {
    pub id: Option<String>,
    pub conn: Option<Connection>,
    pub capture: Option<Capture>,
}

/// The transaction a captured write runs in.
///
/// Derefs to `Connection`, which is what lets every `db::*` function keep its `&Connection`
/// signature: migrating a write site onto capture is a change to its CALLER, not to its SQL
/// (AD-3). The only thing a call site can do with the `WriteTx` itself is open a savepoint, and
/// that exists because the capture buffer has to be rolled back with it.
pub struct WriteTx<'a> {
    tx: rusqlite::Transaction<'a>,
    capture: Option<&'a Capture>,
    depth: Cell<u32>,
}

impl std::ops::Deref for WriteTx<'_> {
    type Target = Connection;

    fn deref(&self) -> &Connection {
        &self.tx
    }
}

impl WriteTx<'_> {
    /// Runs `operation` in a savepoint: on `Err` its rows AND its captured changes are discarded,
    /// and the surrounding transaction continues.
    ///
    /// Issued as SQL rather than through `Transaction::savepoint`, which needs `&mut self` and
    /// would therefore have to be threaded through every call site that only ever reads the
    /// connection. The name is generated from a depth counter, never from input.
    pub fn savepoint<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let name = format!("nixus_write_{}", self.depth.get());
        self.depth.set(self.depth.get() + 1);

        let mark = self.capture.map(|capture| capture.mark());
        self.tx.execute_batch(&format!("SAVEPOINT {name}"))?;

        match operation(&self.tx) {
            Ok(value) => {
                self.tx.execute_batch(&format!("RELEASE {name}"))?;
                self.depth.set(self.depth.get().saturating_sub(1));
                Ok(value)
            }
            Err(error) => {
                self.tx
                    .execute_batch(&format!("ROLLBACK TO {name}; RELEASE {name}"))?;
                self.depth.set(self.depth.get().saturating_sub(1));

                if let (Some(capture), Some(mark)) = (self.capture, mark) {
                    capture.rollback_to(mark);
                }

                Err(error)
            }
        }
    }
}

impl ActiveDataset {
    /// AD-3's write path: one transaction holding the caller's rows AND the messages that describe
    /// them.
    ///
    /// The ordering is the guarantee. The closure runs, the capture buffer is flushed into
    /// `sync_log` on the SAME transaction, and only then does it commit — so a committed write can
    /// never be missing its messages, a failed flush rolls the caller's rows back with it, and a
    /// rollback discards the buffer instead of leaving messages for changes that never happened.
    ///
    /// For a local-only dataset this is exactly a transaction and nothing else.
    pub fn write<T>(
        &self,
        operation: impl FnOnce(&WriteTx<'_>) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let conn = self.conn.as_ref().ok_or(AppError::NotConfigured)?;

        // Held for the whole write: `begin` also makes this the ambient capture AD-5's balance
        // emitters find, and dropping the guard is what takes it away again.
        let _captured = self.capture.as_ref().map(|capture| capture.begin());

        let result = self.commit_write(conn, operation);

        if result.is_err() {
            if let Some(capture) = &self.capture {
                capture.discard();
            }
        }

        result
    }

    fn commit_write<T>(
        &self,
        conn: &Connection,
        operation: impl FnOnce(&WriteTx<'_>) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let tx = WriteTx {
            // IMMEDIATE and not the default DEFERRED. A deferred transaction takes its read
            // snapshot on the first SELECT and only asks for the write lock later, so a closure
            // that reads and then writes — which most of them do, to compute a `sort_order` or
            // check a row exists — fails with `SQLITE_BUSY_SNAPSHOT` if the other connection
            // committed in between. That error is NOT retried by any busy handler, because
            // retrying it would silently re-run the closure against a newer snapshot. Taking the
            // write lock up front turns the race into a wait `busy_timeout` can absorb.
            tx: rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)?,
            capture: self.capture.as_ref(),
            depth: Cell::new(0),
        };

        let value = operation(&tx)?;

        if let Some(capture) = tx.capture {
            capture.flush(&tx.tx)?;
        }

        tx.tx.commit()?;

        Ok(value)
    }

    /// A transaction with capture explicitly OFF, for the paths that must not emit a message per
    /// row: a `danger_zone` wipe (AD-15) and a restore's in-file rewrites (AD-9).
    ///
    /// The hook is re-attached by a guard when the closure returns, however it returns.
    // Story 25 is the first production caller: the `danger_zone` wipe and the guarded restore are
    // the two paths that rewrite the file without emitting a message per row.
    #[allow(dead_code)]
    pub fn write_uncaptured<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let conn = self.conn.as_ref().ok_or(AppError::NotConfigured)?;

        let _detached = match &self.capture {
            Some(capture) => Some(capture.detached(conn)?),
            None => None,
        };

        let tx =
            rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)?;
        let value = operation(&tx)?;
        tx.commit()?;

        Ok(value)
    }
}

/// A transaction when the connection has none, and a SAVEPOINT when it already does.
///
/// Several `db::*` functions group their statements in `conn.unchecked_transaction()`. That is a
/// plain `BEGIN`, which SQLite refuses inside an open transaction — and those functions are now
/// reached through [`ActiveDataset::write`], which has already begun one. A savepoint is the nested
/// form of the same guarantee, so the grouping survives either way and no call site has to know
/// which case it is in.
///
/// LIMIT, deliberately: rolling a savepoint back here discards its ROWS and not the capture buffer,
/// because `db/` has no access to it. That is correct for every caller that propagates the error —
/// the surrounding `write` then rolls back and discards the buffer wholesale. A caller that wants
/// to SWALLOW a failure inside a captured write must use [`WriteTx::savepoint`], which rolls back
/// both together.
pub(crate) enum Grouped<'a> {
    Owned(rusqlite::Transaction<'a>),
    Nested(Savepoint<'a>),
}

impl std::ops::Deref for Grouped<'_> {
    type Target = Connection;

    fn deref(&self) -> &Connection {
        match self {
            Grouped::Owned(tx) => tx,
            Grouped::Nested(savepoint) => savepoint.conn,
        }
    }
}

impl Grouped<'_> {
    pub(crate) fn commit(self) -> Result<(), AppError> {
        match self {
            Grouped::Owned(tx) => tx.commit().map_err(AppError::from),
            Grouped::Nested(savepoint) => savepoint.release(),
        }
    }
}

/// Rolls back on drop and releases on [`Savepoint::release`], which is what a `Transaction` does
/// for the outermost level.
pub(crate) struct Savepoint<'a> {
    conn: &'a Connection,
    name: String,
    settled: bool,
}

impl Savepoint<'_> {
    fn release(mut self) -> Result<(), AppError> {
        self.conn
            .execute_batch(&format!("RELEASE {}", self.name))?;
        self.settled = true;

        Ok(())
    }
}

impl Drop for Savepoint<'_> {
    fn drop(&mut self) {
        if self.settled {
            return;
        }

        // A destructor has nowhere to propagate an error to, and the caller's own `Err` is about to
        // roll back the surrounding transaction anyway, so the failure is recorded, not escalated.
        if let Err(error) = self
            .conn
            .execute_batch(&format!("ROLLBACK TO {0}; RELEASE {0}", self.name))
        {
            tracing::error!("Failed to roll back savepoint {}: {error}", self.name);
        }
    }
}

// Names each savepoint after a per-thread counter, so two nested groupings of one connection can
// never share a name. Thread-local rather than a field because `grouped` is handed a bare
// `&Connection`, and a dataset connection is only ever used by the thread holding its lock.
thread_local! {
    static GROUPED_SEQUENCE: Cell<u32> = const { Cell::new(0) };
}

pub(crate) fn grouped(conn: &Connection) -> Result<Grouped<'_>, AppError> {
    if conn.is_autocommit() {
        return Ok(Grouped::Owned(rusqlite::Transaction::new_unchecked(
            conn,
            rusqlite::TransactionBehavior::Immediate,
        )?));
    }

    let sequence = GROUPED_SEQUENCE.with(|sequence| {
        let current = sequence.get();
        sequence.set(current.wrapping_add(1));
        current
    });
    let name = format!("nixus_grouped_{sequence}");
    conn.execute_batch(&format!("SAVEPOINT {name}"))?;

    Ok(Grouped::Nested(Savepoint {
        conn,
        name,
        settled: false,
    }))
}

pub struct DbState(pub Mutex<ActiveDataset>);

const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../../migrations/001_initial_schema.sql")),
    (2, include_str!("../../migrations/002_budget_tables.sql")),
    (3, include_str!("../../migrations/003_expenses_table.sql")),
    (4, include_str!("../../migrations/004_recreate_expenses_table.sql")),
    (5, include_str!("../../migrations/005_accounts.sql")),
    (6, include_str!("../../migrations/006_audit_log.sql")),
    (7, include_str!("../../migrations/007_passive_assets.sql")),
    (8, include_str!("../../migrations/008_net_worth_snapshots.sql")),
    (9, include_str!("../../migrations/009_chat_tables.sql")),
    (10, include_str!("../../migrations/010_audit_log_indexes.sql")),
    (11, include_str!("../../migrations/011_income_tables.sql")),
    (12, include_str!("../../migrations/012_income_entry_date.sql")),
    (13, include_str!("../../migrations/013_chat_message_type.sql")),
    (14, include_str!("../../migrations/014_config_table.sql")),
    (15, include_str!("../../migrations/015_merchant_category_hints.sql")),
    (16, include_str!("../../migrations/016_recurring_expenses.sql")),
    (17, include_str!("../../migrations/017_chat_agent_id.sql")),
    (18, include_str!("../../migrations/018_maintenance_tables.sql")),
    (19, include_str!("../../migrations/019_custom_service_logs.sql")),
    (20, include_str!("../../migrations/020_maintenance_custom_tasks.sql")),
    (21, include_str!("../../migrations/021_expense_income_account_id.sql")),
    (22, include_str!("../../migrations/022_budget_category_soft_delete.sql")),
    (23, include_str!("../../migrations/023_recurring_income.sql")),
    (
        24,
        include_str!("../../migrations/024_income_entry_recurring_template.sql"),
    ),
    (25, include_str!("../../migrations/025_projects.sql")),
    (26, include_str!("../../migrations/026_project_images.sql")),
    (
        27,
        include_str!("../../migrations/027_project_image_thumbnails.sql"),
    ),
    (
        28,
        include_str!("../../migrations/028_budget_group_soft_delete.sql"),
    ),
    (29, include_str!("../../migrations/029_sync_state.sql")),
    (
        30,
        include_str!("../../migrations/030_project_images_content_addressed.sql"),
    ),
    (31, include_str!("../../migrations/031_sync_image_blobs.sql")),
    (32, include_str!("../../migrations/032_sync_tables.sql")),
    (
        33,
        include_str!("../../migrations/033_sync_field_state_per_row.sql"),
    ),
    (
        34,
        include_str!("../../migrations/034_audit_log_entity_uuid.sql"),
    ),
];

/// The scalar SQL function migration 030 backfills `project_images.image_sha256` with.
///
/// SQLite ships no digest, and the backfill has to happen inside the same statement that moves the
/// rows: that is the only way `image_sha256` can be `NOT NULL` from the moment it exists, instead
/// of a nullable column plus a later pass that an interrupted launch could skip. It is registered
/// for the duration of the migration run and removed again, so no query outside a migration can
/// reach it and the app's SQL surface is unchanged.
const SHA256_HEX_FUNCTION: &str = "nixus_sha256_hex";

fn register_sha256_hex(conn: &Connection) -> Result<(), AppError> {
    conn.create_scalar_function(
        SHA256_HEX_FUNCTION,
        1,
        rusqlite::functions::FunctionFlags::SQLITE_UTF8
            | rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| {
            let bytes = ctx.get_raw(0);
            let bytes = bytes.as_bytes().or_else(|_| bytes.as_str().map(str::as_bytes))?;
            Ok(crate::projects::image::sha256_hex(bytes))
        },
    )?;

    Ok(())
}

/// The schema version this build knows how to run. A sync object carries the version that produced
/// it (AD-8), and anything above this number is parked rather than applied (AD-11), so the ceiling
/// has to be readable from outside `db/`.
pub(crate) fn latest_schema_version() -> i64 {
    MIGRATIONS.last().map(|(v, _)| *v).unwrap_or(0)
}

/// `PRAGMA data_version`: the per-connection counter SQLite bumps whenever **another**
/// connection commits to this database. Milestone 1's change signal, because the capture
/// hook does not exist yet (AD-3 is Milestone 2 Story 15).
pub(crate) fn data_version(conn: &Connection) -> Result<i64, AppError> {
    Ok(conn.query_row("PRAGMA data_version", [], |row| row.get(0))?)
}

pub fn init_db(app_data_dir: &Path) -> Result<Connection, AppError> {
    std::fs::create_dir_all(app_data_dir).map_err(|e| AppError::File {
        message: format!("Failed to create app data directory: {}", e),
    })?;

    let db_path = app_data_dir.join(crate::datasets::DB_FILE_NAME);

    open_configured(&db_path)
}

/// Shared by startup and backup restore so a restored database can never end up
/// configured differently from one opened at launch.
pub(crate) fn open_configured(db_path: &Path) -> Result<Connection, AppError> {
    let conn = Connection::open(db_path)?;

    // `busy_timeout` and not the default of zero: a synced dataset has a SECOND connection on it
    // (AD-11's apply loop, AD-9's snapshot reader), so two writers now genuinely contend. Without
    // it, losing a race is an immediate `SQLITE_BUSY` in the user's face instead of a wait of a few
    // milliseconds. AD-11 names it for the apply connection; it is set here so every connection to
    // a dataset is configured the same way.
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    )?;

    info!("Database opened at {:?}", db_path);

    run_migrations(&conn)?;

    Ok(conn)
}

pub(crate) fn run_migrations(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        )",
    )?;

    let current_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )?;

    register_sha256_hex(conn)?;
    // Removed before the failure is reported, so a migration that fails cannot leave the extra
    // function reachable on a connection the app keeps using.
    let applied = apply_pending_migrations(conn, current_version);
    conn.remove_function(SHA256_HEX_FUNCTION, 1)?;
    applied?;

    info!(
        "Migrations complete. Current schema version: {}",
        latest_schema_version()
    );

    Ok(())
}

fn apply_pending_migrations(conn: &Connection, current_version: i64) -> Result<(), AppError> {
    for (version, sql) in MIGRATIONS {
        if *version > current_version {
            let tx = conn.unchecked_transaction()?;
            tx.execute_batch(sql)?;
            tx.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?1, datetime('now'))",
                rusqlite::params![version],
            )?;
            tx.commit()?;
            info!("Applied migration v{}", version);
        }
    }

    Ok(())
}

/// Brings a fresh database up to `version` and no further, so a migration test can seed the schema
/// as it was BEFORE the migration under test and then watch a normal `open_configured` apply it.
/// Nothing but a test has a reason to stop part-way.
#[cfg(test)]
pub(crate) fn run_migrations_up_to(conn: &Connection, version: i64) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        )",
    )?;

    register_sha256_hex(conn)?;
    let applied = apply_pending_migrations_up_to(conn, version);
    conn.remove_function(SHA256_HEX_FUNCTION, 1)?;
    applied
}

#[cfg(test)]
fn apply_pending_migrations_up_to(conn: &Connection, version: i64) -> Result<(), AppError> {
    for (migration, sql) in MIGRATIONS.iter().filter(|(v, _)| *v <= version) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.execute(
            "INSERT INTO schema_version (version, applied_at) VALUES (?1, datetime('now'))",
            rusqlite::params![migration],
        )?;
        tx.commit()?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn an_unselected_active_dataset_guards_with_not_configured() {
        let active = ActiveDataset {
            id: None,
            conn: None,
            capture: None,
        };

        let guarded = active.conn.as_ref().ok_or(AppError::NotConfigured);

        assert!(matches!(guarded, Err(AppError::NotConfigured)));
        assert_eq!(active.id, None);
    }

    #[test]
    fn a_selected_active_dataset_guards_into_a_usable_connection() {
        let active = ActiveDataset {
            id: Some("default".to_string()),
            conn: Some(Connection::open_in_memory().expect("in-memory database")),
            capture: None,
        };

        let conn = active
            .conn
            .as_ref()
            .ok_or(AppError::NotConfigured)
            .expect("a selected dataset has a connection");

        assert_eq!(
            conn.query_row("SELECT 1", [], |row| row.get::<_, i64>(0))
                .expect("query runs"),
            1
        );
    }

    // `select_dataset` opens and migrates before it acquires DbState's lock, so
    // this failing is exactly what leaves a previously active dataset untouched.
    #[test]
    fn init_db_fails_when_the_datasets_database_file_is_not_sqlite() {
        let dir = TempDir::new().expect("temp dir");
        std::fs::write(
            dir.path().join(crate::datasets::DB_FILE_NAME),
            b"not a sqlite file at all",
        )
            .expect("garbage db written");

        let error = init_db(dir.path()).expect_err("opening a non-database must fail");

        assert!(
            matches!(error, AppError::Database { .. }),
            "expected AppError::Database, got {error:?}"
        );
    }
}
