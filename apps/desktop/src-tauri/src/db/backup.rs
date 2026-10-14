use std::path::{Path, PathBuf};

use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension};
use tracing::{error, warn};

use crate::db::open_configured;
use crate::error::AppError;

const SAFETY_COPY_SUFFIX: &str = ".pre-restore";

/// Replaces the database at `db_path` with `backup_path` and leaves `slot` holding a
/// freshly configured connection to the restored file.
///
/// The live connection is *dropped* rather than merely checkpointed: `wal_checkpoint`
/// empties the `-wal` but leaves it and the `-shm` wal-index on disk and mapped into
/// memory. SQLite only unlinks them when the last connection closes cleanly. Overwrite
/// the database file while a stale `-shm` survives and the next connection attaches a
/// wal-index describing the *previous* file's pages, which SQLite reports as
/// "database disk image is malformed".
///
/// On any failure the pre-restore file is put back and `slot` is repointed at it, so the
/// user can keep working without restarting the app.
pub fn restore_from_file(
    slot: &mut Connection,
    db_path: &Path,
    backup_path: &Path,
) -> Result<(), AppError> {
    // Best-effort only: dropping the connection below checkpoints anyway, so a failure
    // here (a corrupt sidecar, for instance) must not block the restore.
    if let Err(e) = slot.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)") {
        warn!("Pre-restore WAL checkpoint failed, continuing: {}", e);
    }

    let safety_path = with_suffix(db_path, SAFETY_COPY_SUFFIX);

    let placeholder = Connection::open_in_memory()?;
    let old = std::mem::replace(slot, placeholder);
    drop(old);

    remove_sidecars(db_path);

    std::fs::copy(db_path, &safety_path).map_err(|e| {
        roll_back(
            slot,
            db_path,
            &safety_path,
            AppError::File {
                message: format!("Failed to create safety copy: {}", e),
            },
        )
    })?;

    std::fs::copy(backup_path, db_path).map_err(|e| {
        roll_back(
            slot,
            db_path,
            &safety_path,
            AppError::File {
                message: format!("Failed to restore database: {}", e),
            },
        )
    })?;

    remove_sidecars(db_path);

    let restored =
        open_configured(db_path).map_err(|e| roll_back(slot, db_path, &safety_path, e))?;
    *slot = restored;

    if let Err(e) = std::fs::remove_file(&safety_path) {
        warn!("Failed to remove safety copy {:?}: {}", safety_path, e);
    }

    Ok(())
}

/// Puts the pre-restore database back and returns `cause` unchanged — the caller needs the
/// original failure, not whatever went wrong while recovering from it.
///
/// `slot` still holds the in-memory placeholder at this point, so reopening a real
/// connection is mandatory: leaving the placeholder would have the app silently reading
/// and writing an empty database.
fn roll_back(
    slot: &mut Connection,
    db_path: &Path,
    safety_path: &Path,
    cause: AppError,
) -> AppError {
    // A failure creating the safety copy leaves nothing to put back, and `db_path` is
    // still untouched in that case.
    if safety_path.exists() {
        if let Err(e) = std::fs::copy(safety_path, db_path) {
            error!("Failed to put the pre-restore database back: {}", e);
        }
    }

    remove_sidecars(db_path);

    match open_configured(db_path) {
        Ok(conn) => *slot = conn,
        Err(e) => error!("Failed to reopen the database after rollback: {}", e),
    }

    if let Err(e) = std::fs::remove_file(safety_path) {
        if e.kind() != std::io::ErrorKind::NotFound {
            warn!("Failed to remove safety copy {:?}: {}", safety_path, e);
        }
    }

    cause
}

/// Removes a database's `-wal` and `-shm` sidecars, treating an absent one as done.
///
/// Shared with `app_migration`: a sidecar left beside a *renamed* main file is the
/// same "database disk image is malformed" hazard this exists for on the restore
/// path, because the next connection would attach a wal-index describing a file
/// that is no longer there.
pub(crate) fn remove_sidecars(db_path: &Path) {
    for suffix in ["-wal", "-shm"] {
        let sidecar = with_suffix(db_path, suffix);
        if let Err(e) = std::fs::remove_file(&sidecar) {
            if e.kind() != std::io::ErrorKind::NotFound {
                warn!("Failed to remove sidecar {:?}: {}", sidecar, e);
            }
        }
    }
}

/// Appends to the file name rather than replacing the extension, so `nixus.db`
/// yields `nixus.db-wal` — the exact names SQLite uses.
pub(crate) fn with_suffix(db_path: &Path, suffix: &str) -> PathBuf {
    let mut name = db_path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

/// The verified snapshot, written next to the dataset and not yet in its place.
///
/// A separate suffix from `SAFETY_COPY_SUFFIX` on purpose: at launch, finding one of
/// these means "a bootstrap was interrupted", a different conclusion from a user-driven
/// import restore, and the recovery below must not confuse the two.
pub(crate) const INCOMING_SUFFIX: &str = ".sync-incoming";

/// The pre-swap copy of the live database, kept until the new file has proven it opens.
pub(crate) const BOOTSTRAP_SAFETY_SUFFIX: &str = ".pre-bootstrap";

/// How many same-second dated backups are tolerated before the swap gives up rather than
/// overwrite one. Nothing is ever deleted without a backup copy, so failing to *make* one
/// has to fail the whole swap.
const MAX_DATED_BACKUP_ATTEMPTS: u32 = 64;

/// Which step of the guarded swap failed. A code, never prose and never a path, so a
/// failure can be counted and reported without carrying anything about the user (AD-16).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SwapStage {
    WriteIncoming,
    OpenIncoming,
    VerifyIncoming,
    CarryLocalOnly,
    DatedBackup,
    CloseLive,
    SafetyCopy,
    CopyOverLive,
    OpenRestored,
    VerifyRestored,
    Adopt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SwapFailed {
    pub stage: SwapStage,
    /// Whether the dataset still holds the data it held before the swap. `false` is the
    /// only outcome a caller has to surface as a risk to data: it means the rollback
    /// itself could not finish, and the dated backup (or `BOOTSTRAP_SAFETY_SUFFIX` file)
    /// is what the user has left.
    pub rolled_back: bool,
}

impl std::fmt::Display for SwapFailed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "guarded swap failed at {:?} (rolled back: {})",
            self.stage, self.rolled_back
        )
    }
}

impl std::error::Error for SwapFailed {}

/// Whoever owns the open connections to a dataset file.
///
/// AD-9 requires every connection to be closed before **any** file swap, because
/// `restore_from_file` overwrites in place and a surviving `-shm` describes the previous
/// file's pages. The manager's second connection (AD-11) and the UI's connection have
/// different owners, so "close everything" cannot be a function here — it is this seam,
/// which Story 10 implements over its actor handle plus `DbState`.
pub trait DatasetSlot {
    /// Drops every connection this process holds to the dataset file, checkpointing
    /// first. Must return only once no handle remains: on Windows an open handle alone is
    /// enough to make the copy below fail.
    fn close(&self) -> Result<(), AppError>;

    /// Publishes the restored connection as the dataset's live one again.
    fn adopt(&self, conn: Connection) -> Result<(), AppError>;
}

/// A dataset nothing has open: CAP-5's *separate* branch restores into a directory the
/// registry has just provisioned, so there is no connection to close and the connection
/// the swap proved is dropped rather than published.
pub struct UnopenedDataset;

impl DatasetSlot for UnopenedDataset {
    fn close(&self) -> Result<(), AppError> {
        Ok(())
    }

    fn adopt(&self, conn: Connection) -> Result<(), AppError> {
        drop(conn);

        Ok(())
    }
}

/// What the restore carried over from the pre-swap file (AD-9, AD-15). Counts and table
/// names only — never a value.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CarryReport {
    pub tables: Vec<String>,
    pub rows: usize,
    pub config_keys: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SwapReport {
    pub carried: CarryReport,
    pub dated_backup: Option<PathBuf>,
}

/// How much user data a dataset holds, as counts per table (AD-16).
///
/// `config` is excluded along with the structural tables: it holds this computer's own
/// settings, so a dataset where nothing but a theme was chosen must not be reported as
/// "already has data" and raise CAP-5's choice.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LocalData {
    pub rows: i64,
    pub tables: Vec<(String, i64)>,
}

impl LocalData {
    pub fn is_empty(&self) -> bool {
        self.rows == 0
    }
}

pub fn local_data_summary(conn: &Connection) -> Result<LocalData, AppError> {
    let mut summary = LocalData::default();

    for name in countable_tables(conn)? {
        let rows: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM \"{name}\""), [], |row| {
            row.get(0)
        })?;
        if rows > 0 {
            summary.rows += rows;
            summary.tables.push((name, rows));
        }
    }

    Ok(summary)
}

/// Every table that holds user data. The names come from `sqlite_master`, never from a
/// caller, and are quoted at every use site regardless.
#[allow(dead_code)] // Reachable only from `local_data_summary`, which Story 10 calls.
fn countable_tables(conn: &Connection) -> Result<Vec<String>, AppError> {
    let mut statement = conn.prepare(
        "SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
           AND name NOT LIKE 'sync\\_%' ESCAPE '\\'
           AND name NOT IN ('schema_version', 'config')
         ORDER BY name",
    )?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<String>, _>>()?;

    Ok(names)
}

/// Replaces the dataset at `db_path` with the database bytes in `payload`, carrying this
/// computer's local-only state over, and leaves `slot` holding the restored connection.
///
/// The ordering is the whole safety argument, and it differs from `restore_from_file` on
/// purpose: the incoming file is written, migrated, verified and populated with the
/// carried-over state **before** the live file is touched at all, so the only moment the
/// dataset is not a usable database is the single `fs::copy` at step 6 — and the copy at
/// step 5 is what makes even that recoverable.
///
/// 1. remove any leftover incoming file (never truncate in place: Windows refuses to
///    resize a file something still has mapped),
/// 2. write the payload to the incoming path,
/// 3. open it (migrations run for an older snapshot), verify it, carry the local-only
///    state over from the still-open live dataset, checkpoint and close,
/// 4. close every live connection and flush the WAL into the main file,
/// 5. the dated backup when one is asked for, then the safety copy,
/// 6. copy the incoming file over the live one — a copy, not a rename, so nothing depends
///    on rename-over-existing semantics,
/// 7. reopen, verify, hand to `slot`, and only then delete the safety copy.
///
/// Any failure from step 4 on puts the safety copy back, reopens it and hands *that* to
/// `slot`, so the app keeps working on the data it had.
pub fn restore_snapshot_file(
    slot: &impl DatasetSlot,
    db_path: &Path,
    payload: &[u8],
    dated_backup_dir: Option<&Path>,
) -> Result<SwapReport, SwapFailed> {
    let incoming = with_suffix(db_path, INCOMING_SUFFIX);
    let safety = with_suffix(db_path, BOOTSTRAP_SAFETY_SUFFIX);

    let prepared = prepare_incoming(&incoming, db_path, payload);
    let carried = match prepared {
        Ok(carried) => carried,
        Err(failure) => {
            // Nothing has been closed or overwritten yet, so there is nothing to undo and
            // the slot still holds its connection.
            discard(&incoming);
            return Err(failure);
        }
    };

    swap_prepared_file(slot, db_path, &incoming, &safety, dated_backup_dir).map(|dated_backup| {
        SwapReport {
            carried,
            dated_backup,
        }
    })
}

/// Steps 1-3: the incoming file becomes a complete, migrated, verified database carrying
/// this computer's local-only state, while the live dataset is still open and untouched.
fn prepare_incoming(
    incoming: &Path,
    live_db_path: &Path,
    payload: &[u8],
) -> Result<CarryReport, SwapFailed> {
    let fail = |stage: SwapStage| SwapFailed {
        stage,
        rolled_back: true,
    };

    discard(incoming);
    remove_sidecars(incoming);
    write_new_file(incoming, payload).map_err(|e| {
        error!("Failed to write the incoming snapshot file: {}", e);
        fail(SwapStage::WriteIncoming)
    })?;

    let conn = open_configured(incoming).map_err(|e| {
        error!("The incoming snapshot did not open: {}", e);
        fail(SwapStage::OpenIncoming)
    })?;

    let prepared = verify(&conn, "quick_check")
        .map_err(|e| {
            error!("The incoming snapshot could not be verified: {}", e);
            fail(SwapStage::VerifyIncoming)
        })
        .and_then(|intact| {
            if intact {
                Ok(())
            } else {
                Err(fail(SwapStage::VerifyIncoming))
            }
        })
        .and_then(|()| {
            carry_local_only(&conn, live_db_path).map_err(|e| {
                error!("The local-only state could not be carried over: {}", e);
                fail(SwapStage::CarryLocalOnly)
            })
        })
        .and_then(|carried| {
            // Folded back in so the file copied at step 6 is self-contained: a `-wal` left
            // beside the incoming file would not travel with it.
            conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
                .map_err(|e| {
                    error!("The incoming snapshot could not be checkpointed: {}", e);
                    fail(SwapStage::CarryLocalOnly)
                })?;
            Ok(carried)
        });

    drop(conn);
    remove_sidecars(incoming);

    prepared
}

/// Steps 4-7, with every failure rolling the live file back to what step 5 copied.
fn swap_prepared_file(
    slot: &impl DatasetSlot,
    db_path: &Path,
    incoming: &Path,
    safety: &Path,
    dated_backup_dir: Option<&Path>,
) -> Result<Option<PathBuf>, SwapFailed> {
    let outcome = swap_prepared_file_inner(slot, db_path, incoming, safety, dated_backup_dir);

    // The incoming file is this module's scratch space on every path, and a `safety` file
    // that outlived a successful swap would make the next launch's recovery think a
    // bootstrap was interrupted. `roll_back_swap` keeps the safety copy only when it could
    // not finish, which is the one case the user may still need it.
    discard(incoming);
    remove_sidecars(incoming);
    if outcome.is_ok() {
        discard(safety);
    }

    outcome
}

fn swap_prepared_file_inner(
    slot: &impl DatasetSlot,
    db_path: &Path,
    incoming: &Path,
    safety: &Path,
    dated_backup_dir: Option<&Path>,
) -> Result<Option<PathBuf>, SwapFailed> {
    if let Err(e) = slot.close() {
        error!("The dataset's connections could not be closed: {}", e);
        return Err(roll_back_swap(slot, db_path, safety, SwapStage::CloseLive));
    }

    // Defensive, and the reason it is not merely `slot.close()`: a connection opened and
    // closed here is the last one, so SQLite folds the WAL into the main file and unlinks
    // the sidecars. Without it, a `close()` that left a `-wal` behind would make both
    // copies below silently miss the most recent commits.
    if let Err(e) = flush_closed_database(db_path) {
        error!("The dataset could not be flushed before the swap: {}", e);
        return Err(roll_back_swap(slot, db_path, safety, SwapStage::CloseLive));
    }

    let dated_backup = match dated_backup_dir {
        Some(dir) => match copy_to_dated_backup(db_path, dir) {
            Ok(path) => Some(path),
            Err(e) => {
                error!("The dated backup could not be written: {}", e);
                return Err(roll_back_swap(slot, db_path, safety, SwapStage::DatedBackup));
            }
        },
        None => None,
    };

    if let Err(e) = std::fs::copy(db_path, safety) {
        error!("The pre-swap safety copy could not be written: {}", e);
        return Err(roll_back_swap(slot, db_path, safety, SwapStage::SafetyCopy));
    }

    remove_sidecars(db_path);
    if let Err(e) = std::fs::copy(incoming, db_path) {
        error!("The restored database could not be put in place: {}", e);
        return Err(roll_back_swap(slot, db_path, safety, SwapStage::CopyOverLive));
    }
    remove_sidecars(db_path);

    let restored = match open_configured(db_path) {
        Ok(conn) => conn,
        Err(e) => {
            error!("The restored database did not open: {}", e);
            return Err(roll_back_swap(slot, db_path, safety, SwapStage::OpenRestored));
        }
    };

    match verify(&restored, "quick_check") {
        Ok(true) => {}
        Ok(false) => {
            drop(restored);
            return Err(roll_back_swap(
                slot,
                db_path,
                safety,
                SwapStage::VerifyRestored,
            ));
        }
        Err(e) => {
            error!("The restored database could not be verified: {}", e);
            drop(restored);
            return Err(roll_back_swap(
                slot,
                db_path,
                safety,
                SwapStage::VerifyRestored,
            ));
        }
    }

    if let Err(e) = slot.adopt(restored) {
        error!("The restored connection could not be published: {}", e);
        return Err(roll_back_swap(slot, db_path, safety, SwapStage::Adopt));
    }

    Ok(dated_backup)
}

/// Puts the pre-swap database back and hands a working connection to `slot`.
///
/// `rolled_back: false` is reserved for the case where this itself could not finish: the
/// caller then knows the dataset may be the half-written one and that the dated backup is
/// what is left. The safety copy is deliberately **not** deleted in that case.
fn roll_back_swap(
    slot: &impl DatasetSlot,
    db_path: &Path,
    safety: &Path,
    stage: SwapStage,
) -> SwapFailed {
    let mut rolled_back = true;

    if safety.exists() {
        remove_sidecars(db_path);
        if let Err(e) = std::fs::copy(safety, db_path) {
            error!("Failed to put the pre-swap database back: {}", e);
            rolled_back = false;
        }
        remove_sidecars(db_path);
    }

    match open_configured(db_path).and_then(|conn| slot.adopt(conn)) {
        Ok(()) => {}
        Err(e) => {
            error!("Failed to reopen the dataset after rollback: {}", e);
            rolled_back = false;
        }
    }

    if rolled_back {
        discard(safety);
    }

    SwapFailed {
        stage,
        rolled_back,
    }
}

/// Launch-time repair for a bootstrap that was interrupted (AD-9).
///
/// Idempotent, and safe to call before anything opens the dataset. A leftover incoming
/// file is never the dataset, so it is simply removed. A surviving safety copy means the
/// process stopped somewhere between the copy at step 5 and the verification at step 7,
/// which is the one window where `db_path` may be half written: the live file is kept only
/// if it opens and passes the **full** `integrity_check` — a crash is rare enough to pay
/// for the slower check, and `quick_check` does not read every page.
pub fn recover_interrupted_restore(db_path: &Path) -> Result<Recovery, AppError> {
    let incoming = with_suffix(db_path, INCOMING_SUFFIX);
    let safety = with_suffix(db_path, BOOTSTRAP_SAFETY_SUFFIX);

    let stale_incoming_removed = incoming.exists();
    if stale_incoming_removed {
        remove_sidecars(&incoming);
        discard(&incoming);
    }

    if !safety.exists() {
        return Ok(Recovery {
            stale_incoming_removed,
            outcome: RecoveryOutcome::NothingToDo,
        });
    }

    let outcome = if restored_file_is_usable(db_path) {
        RecoveryOutcome::KeptFileInPlace
    } else {
        warn!("An interrupted bootstrap left an unusable database; putting the pre-swap copy back");
        remove_sidecars(db_path);
        std::fs::copy(&safety, db_path).map_err(|e| AppError::File {
            message: format!("Failed to put the pre-swap database back: {}", e),
        })?;
        remove_sidecars(db_path);
        RecoveryOutcome::RolledBack
    };

    discard(&safety);

    Ok(Recovery {
        stale_incoming_removed,
        outcome,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryOutcome {
    NothingToDo,
    /// The file in place opens and is intact, so it is kept. Which of the two databases it
    /// is — the restored one, or the old one when the crash landed before the copy — is
    /// not knowable and does not need to be: both are complete and usable.
    KeptFileInPlace,
    /// The swap was interrupted mid-copy: the pre-swap database is back in place.
    RolledBack,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Recovery {
    pub stale_incoming_removed: bool,
    pub outcome: RecoveryOutcome,
}

impl Recovery {
    /// Whether the previous run left nothing to clean up, which is the ordinary case on
    /// every launch and the one that must produce no log line.
    pub fn is_noop(&self) -> bool {
        !self.stale_incoming_removed && self.outcome == RecoveryOutcome::NothingToDo
    }
}

/// Whether `db_path` is a database this app could keep using. No migration is run: the
/// question is whether the *file* survived, and migrating it would be a write to a file
/// that may be about to be replaced.
fn restored_file_is_usable(db_path: &Path) -> bool {
    if !db_path.exists() {
        return false;
    }

    match Connection::open(db_path) {
        Ok(conn) => {
            let intact = verify(&conn, "integrity_check").unwrap_or(false);
            drop(conn);
            intact
        }
        Err(e) => {
            warn!("An interrupted bootstrap left a database that does not open: {}", e);
            false
        }
    }
}

/// `PRAGMA quick_check` / `integrity_check` answer `ok` as their first row when the
/// database is sound, and the first problem found otherwise.
fn verify(conn: &Connection, pragma: &str) -> Result<bool, AppError> {
    let answer: String = conn.query_row(&format!("PRAGMA {pragma}"), [], |row| row.get(0))?;
    if answer != "ok" {
        error!("Database verification ({}) reported a problem", pragma);
    }

    Ok(answer == "ok")
}

/// Writes `payload` to a path that must not already exist, so nothing can be truncated in
/// place — on Windows resizing a file another handle has memory-mapped fails outright.
fn write_new_file(path: &Path, payload: &[u8]) -> Result<(), AppError> {
    use std::io::Write as _;

    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| AppError::File {
            message: format!("Failed to create {}: {}", path.display(), e),
        })?;

    file.write_all(payload)
        .and_then(|()| file.sync_all())
        .map_err(|e| AppError::File {
            message: format!("Failed to write {}: {}", path.display(), e),
        })
}

/// Opens and immediately closes the dataset so SQLite folds any surviving `-wal` into the
/// main file and unlinks the sidecars.
fn flush_closed_database(db_path: &Path) -> Result<(), AppError> {
    if !db_path.exists() {
        return Ok(());
    }

    let conn = Connection::open(db_path)?;
    let checkpointed = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)");
    drop(conn);
    checkpointed?;

    remove_sidecars(db_path);

    Ok(())
}

/// Copies the live database into `dir` under a dated name, never over an existing file.
///
/// `create_new` rather than `fs::copy`, which truncates whatever is already there: the
/// point of the dated backup is that it is the only remaining copy of the data being
/// replaced, so overwriting one would defeat it. Two swaps in the same second get a
/// numbered suffix.
pub fn copy_to_dated_backup(db_path: &Path, dir: &Path) -> Result<PathBuf, AppError> {
    std::fs::create_dir_all(dir).map_err(|e| AppError::File {
        message: format!("Failed to create the backup directory: {}", e),
    })?;

    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    for attempt in 1..=MAX_DATED_BACKUP_ATTEMPTS {
        let name = match attempt {
            1 => format!("nixus-pre-sync-{stamp}.db"),
            _ => format!("nixus-pre-sync-{stamp}-{attempt}.db"),
        };
        let path = dir.join(name);

        let mut destination = match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => {
                return Err(AppError::File {
                    message: format!("Failed to create the dated backup: {}", e),
                })
            }
        };

        let mut source = std::fs::File::open(db_path).map_err(|e| AppError::File {
            message: format!("Failed to read the database to back up: {}", e),
        })?;

        std::io::copy(&mut source, &mut destination)
            .and_then(|_| destination.sync_all())
            .map_err(|e| AppError::File {
                message: format!("Failed to write the dated backup: {}", e),
            })?;

        return Ok(path);
    }

    Err(AppError::File {
        message: "Could not find an unused name for the dated backup".to_string(),
    })
}

/// Carries this computer's local-only state from `source_path` into the incoming database
/// (AD-9, AD-15): the `sync_*` tables a snapshot is stripped of, and the `config` keys
/// that describe this computer's credential state.
///
/// Read through a second, `query_only` connection rather than `ATTACH`: attaching needs
/// the path as SQL or as a `file:` URI, and percent-encoding a Windows path correctly is a
/// hazard this does not need to take on. The rows are tiny — `sync_state` is one row — so
/// going through memory costs nothing.
///
/// The tables are the ones present in **both** files, discovered from each file's own
/// `sqlite_master`. Milestone 2's `sync_log` and friends therefore need no edit here, and
/// their absence today is handled by construction.
fn carry_local_only(target: &Connection, source_path: &Path) -> Result<CarryReport, AppError> {
    let mut report = CarryReport::default();
    if !source_path.exists() {
        return Ok(report);
    }

    let source = open_query_only(source_path)?;
    // Only THIS computer's own log rows are carried. Carrying another install's rows would hand the
    // restored file a dedup record for a message whose row the incoming snapshot does not have, and
    // `apply` would then skip that message as already applied and the row would never exist here —
    // a lost edit. Everything the account knows about other installs travels in the snapshot, which
    // is the one place it is consistent with the tables beside it.
    let own_install: Option<String> = source
        .query_row("SELECT install_id FROM sync_state WHERE id = 1", [], |row| {
            row.get(0)
        })
        .optional()?;
    let carried: Vec<String> = sync_tables(&source)?
        .into_iter()
        .filter(|name| sync_tables(target).map(|t| t.contains(name)).unwrap_or(false))
        .collect();

    let tx = target.unchecked_transaction()?;
    for name in carried {
        // THREE policies, not one, and the split is the whole safety argument of a Story-23 swap.
        //
        // The six merge/identity tables now TRAVEL IN THE SNAPSHOT (`db::snapshot_strip`), and the
        // snapshot's copy is the account's shared truth: replacing it with this computer's would
        // reinstate identities for rows the incoming file does not have and would discard the
        // field state the snapshot's own messages were accepted against.
        //
        // `sync_log` is carried ADDITIVELY on top of what the snapshot brought. Both halves are
        // load-bearing: the unsent rows are this computer's edits nobody else has yet, and the
        // SHIPPED rows are what `next_seq` is derived from — a log that lost them would re-cut
        // `seq` 0 with different bytes and read as an install-id collision (Story 19).
        //
        // Everything else (`sync_state`, `sync_image_blobs`) describes THIS computer and replaces
        // whatever arrived.
        if SNAPSHOT_OWNED_SYNC_TABLES.contains(&name.as_str()) {
            continue;
        }
        let additive = (name == "sync_log").then_some(own_install.as_deref()).flatten();
        report.rows += copy_table(&source, &tx, &name, additive)?;
        report.tables.push(name);
    }

    for key in crate::db::config::LOCAL_ONLY_KEYS {
        let value: Option<String> = source
            .query_row("SELECT value FROM config WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()?;

        if let Some(value) = value {
            tx.execute(
                "INSERT INTO config (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![key, value],
            )?;
            report.config_keys += 1;
        }
    }

    tx.commit()?;

    Ok(report)
}

/// A read connection that cannot write, which is what makes "the file being replaced is
/// only ever read" a property of the connection rather than a promise about the code.
fn open_query_only(path: &Path) -> Result<Connection, AppError> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA query_only=ON")?;

    Ok(conn)
}

/// The `sync_*` tables a Story-23 snapshot carries itself, so a restore must NOT overwrite them
/// with this computer's copies.
const SNAPSHOT_OWNED_SYNC_TABLES: &[&str] = &[
    "sync_applied_vector",
    "sync_field_state",
    "sync_pending",
    "sync_quarantine",
    "sync_tombstone",
    "sync_uuid",
];

fn sync_tables(conn: &Connection) -> Result<Vec<String>, AppError> {
    let mut statement = conn.prepare(
        "SELECT name FROM sqlite_master
         WHERE type = 'table' AND name LIKE 'sync\\_%' ESCAPE '\\' ORDER BY name",
    )?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<String>, _>>()?;

    Ok(names)
}

/// Carries `name`'s rows from the source into the target, column by named column.
///
/// Two modes, and which one a table gets is the safety argument of a Story-23 swap. REPLACE
/// (`additive: None`) is the default: the table describes THIS computer (`sync_state`,
/// `sync_image_blobs`) and the incoming copy of it is meaningless. ADDITIVE is `sync_log` alone,
/// where both sides matter — the snapshot brought the account's counter and balance history
/// (Story 20: the log IS the merge state for those two kinds) while the safety copy holds this
/// computer's unsent rows AND the shipped rows `next_seq` is derived from, so losing either is
/// data loss. Additive mode is SCOPED TO ONE INSTALL for the reason `carry_local_only` states:
/// another install's dedup record without its row is a message silently skipped forever.
///
/// The columns come from the SOURCE statement, so a column a later migration added to the
/// target takes its default instead of shifting every value one place to the left — which
/// is the bug a positional copy ships silently. Additive mode additionally drops `id`:
/// `sync_log.id` is the one `AUTOINCREMENT` in the sync schema and a reused id would alias a
/// message already shipped.
///
/// `OR IGNORE` in BOTH modes, deliberately: replace empties the table first so no conflict is
/// reachable there, and stating the conflict rule once keeps the union's rule — a message the
/// snapshot already carries under the same `(install, seq, idx)` is NOT inserted twice, because a
/// duplicated `counter_delta` would double-count.
///
/// `OR IGNORE` is NOT enough for the UNSENT tail, and that is why `unsent_already_carried`
/// exists: `UNIQUE (install, seq, idx)` is the identity of a SHIPPED message, and SQLite treats
/// two NULLs as distinct, so a second restore of the same computer would re-insert every
/// `seq IS NULL` row a previous restore carried and the next cut would ship one `counter_delta`
/// twice under two message ids. An unsent row has no `(seq, idx)` to be identified by, so its
/// identity is its whole message tuple instead.
fn copy_table(
    source: &Connection,
    target: &Connection,
    name: &str,
    additive: Option<&str>,
) -> Result<usize, AppError> {
    if additive.is_none() {
        target.execute(&format!("DELETE FROM \"{name}\""), [])?;
    }

    let mut read = match additive {
        Some(_) => source.prepare(&format!("SELECT * FROM \"{name}\" WHERE install = ?1"))?,
        None => source.prepare(&format!("SELECT * FROM \"{name}\""))?,
    };
    let selected: Vec<(usize, String)> = read
        .column_names()
        .iter()
        .enumerate()
        .filter(|(_, column)| !(additive.is_some() && **column == "id"))
        .map(|(at, column)| (at, format!("\"{column}\"")))
        .collect();
    if selected.is_empty() {
        return Ok(0);
    }

    let columns: Vec<&str> = selected.iter().map(|(_, column)| column.as_str()).collect();
    let placeholders: Vec<String> = (1..=columns.len()).map(|at| format!("?{at}")).collect();
    let mut write = target.prepare(&format!(
        "INSERT OR IGNORE INTO \"{name}\" ({}) VALUES ({})",
        columns.join(", "),
        placeholders.join(", ")
    ))?;

    let mut copied = 0;
    let mut rows = match additive {
        Some(install) => read.query(rusqlite::params![install])?,
        None => read.query([])?,
    };
    while let Some(row) = rows.next()? {
        if additive.is_some() && unsent_already_carried(target, name, row)? {
            continue;
        }
        let values: Vec<Value> = selected
            .iter()
            .map(|(at, _)| row.get::<_, Value>(*at))
            .collect::<Result<_, _>>()?;
        copied += write.execute(rusqlite::params_from_iter(values))?;
    }

    Ok(copied)
}

/// Answers whether `row` — an unsent (`seq IS NULL`) `sync_log` row of the file being carried
/// forward — is already in the target under the same message tuple.
///
/// A shipped row is identified by `(install, seq, idx)` and `OR IGNORE` handles it. An unsent one
/// has neither, and `UNIQUE` lets two NULLs coexist, so without this a second restore of the same
/// computer duplicates its whole unsent tail and the next cut ships one `counter_delta` twice.
/// The identity used is everything a message IS: who stamped it, when, what it addresses and what
/// it says. `IS` rather than `=` on the three nullable columns, because `NULL = NULL` is NULL and
/// the comparison would never match a message that names no column or no cause.
fn unsent_already_carried(
    target: &Connection,
    name: &str,
    row: &rusqlite::Row<'_>,
) -> Result<bool, AppError> {
    if name != "sync_log" || row.get::<_, Option<i64>>("seq")?.is_some() {
        return Ok(false);
    }

    let found: Option<i64> = target
        .query_row(
            "SELECT 1 FROM sync_log
             WHERE seq IS NULL
               AND install = ?1 AND hlc = ?2 AND kind = ?3 AND table_name = ?4
               AND row_uuid IS ?5 AND column_name IS ?6 AND cause_uuid IS ?7 AND payload IS ?8
             LIMIT 1",
            rusqlite::params![
                row.get::<_, String>("install")?,
                row.get::<_, String>("hlc")?,
                row.get::<_, String>("kind")?,
                row.get::<_, String>("table_name")?,
                row.get::<_, Value>("row_uuid")?,
                row.get::<_, Value>("column_name")?,
                row.get::<_, Value>("cause_uuid")?,
                row.get::<_, Value>("payload")?,
            ],
            |found| found.get(0),
        )
        .optional()?;

    Ok(found.is_some())
}

/// Removes a file this module owns, treating an absent one as done.
///
/// A *directory* at one of these paths is not something a swap creates, but leaving one
/// there would make every later attempt fail at the same step forever (`create_new`
/// cannot replace it), so it is removed as well. Both names are this module's by
/// construction — nothing else writes `nixus.db.sync-incoming` or `nixus.db.pre-bootstrap`.
fn discard(path: &Path) {
    match std::fs::remove_file(path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) if path.is_dir() => {
            if let Err(e) = std::fs::remove_dir_all(path) {
                warn!("Failed to remove the directory at {:?}: {}", path, e);
            }
        }
        Err(e) => warn!("Failed to remove {:?}: {}", path, e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{run_migrations, MIGRATIONS};
    use tempfile::TempDir;

    fn latest_version() -> i64 {
        MIGRATIONS
            .last()
            .map(|(version, _)| *version)
            .expect("migrations are not empty")
    }

    fn open_live_db(path: &Path) -> Connection {
        let conn = Connection::open(path).expect("open file db");
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .expect("set pragmas");
        run_migrations(&conn).expect("run migrations");
        conn
    }

    fn open_db_at_version(path: &Path, max_version: i64) -> Connection {
        let conn = Connection::open(path).expect("open file db");
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .expect("set pragmas");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            )",
        )
        .expect("create schema_version");

        for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v <= max_version) {
            conn.execute_batch(sql).expect("apply migration");
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?1, datetime('now'))",
                rusqlite::params![version],
            )
            .expect("record migration");
        }

        conn
    }

    fn seed_marker(conn: &Connection, marker: &str) {
        conn.execute(
            "INSERT INTO budget_groups (id, name) VALUES (1, ?1)",
            [marker],
        )
        .expect("seed budget group");
    }

    fn read_marker(conn: &Connection) -> String {
        conn.query_row("SELECT name FROM budget_groups WHERE id = 1", [], |r| {
            r.get(0)
        })
        .expect("read budget group")
    }

    #[test]
    fn restore_replaces_data_and_cleans_up() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join(crate::datasets::DB_FILE_NAME);
        let backup_path = dir.path().join("backup.db");

        let mut slot = open_live_db(&db_path);
        seed_marker(&slot, "live");

        {
            let backup = open_live_db(&backup_path);
            seed_marker(&backup, "backup");
        }

        restore_from_file(&mut slot, &db_path, &backup_path).expect("restore succeeds");

        assert_eq!(read_marker(&slot), "backup");
        assert!(
            !with_suffix(&db_path, SAFETY_COPY_SUFFIX).exists(),
            "safety copy must be deleted on success"
        );
    }

    /// Regression test for "database disk image is malformed": sidecars left behind by the
    /// previous database must never reach the reopened connection.
    #[test]
    fn restore_succeeds_with_stale_sidecars_present() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join(crate::datasets::DB_FILE_NAME);
        let backup_path = dir.path().join("backup.db");

        let mut slot = open_live_db(&db_path);
        seed_marker(&slot, "live");

        {
            let backup = open_live_db(&backup_path);
            seed_marker(&backup, "backup");
        }

        std::fs::write(with_suffix(&db_path, "-wal"), b"bogus wal contents")
            .expect("write bogus wal");
        // Not `fs::write`: that truncates, and Windows refuses to resize `-shm` while the
        // live connection still has it memory-mapped (ERROR_USER_MAPPED_FILE). Scribbling
        // over the header in place corrupts it just as well and is portable.
        {
            use std::io::Write as _;
            let mut shm = std::fs::OpenOptions::new()
                .write(true)
                .open(with_suffix(&db_path, "-shm"))
                .expect("open shm");
            shm.write_all(b"bogus shm contents").expect("write bogus shm");
        }

        restore_from_file(&mut slot, &db_path, &backup_path).expect("restore succeeds");

        assert_eq!(read_marker(&slot), "backup");
    }

    #[test]
    fn restore_forward_migrates_older_backup() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join(crate::datasets::DB_FILE_NAME);
        let backup_path = dir.path().join("backup-v18.db");

        let mut slot = open_live_db(&db_path);
        seed_marker(&slot, "live");

        {
            let backup = open_db_at_version(&backup_path, 18);
            seed_marker(&backup, "backup");
            let version: i64 = backup
                .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
                .expect("read backup schema version");
            assert_eq!(version, 18, "fixture must start at v18");
        }

        restore_from_file(&mut slot, &db_path, &backup_path).expect("restore succeeds");

        let version: i64 = slot
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .expect("read restored schema version");
        assert_eq!(version, latest_version());
        assert_eq!(read_marker(&slot), "backup");
    }

    #[test]
    fn restore_rolls_back_when_backup_is_unreadable() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join(crate::datasets::DB_FILE_NAME);
        let missing_path = dir.path().join("does-not-exist.db");

        let mut slot = open_live_db(&db_path);
        seed_marker(&slot, "live");

        let err = restore_from_file(&mut slot, &db_path, &missing_path)
            .expect_err("restore must fail");
        assert!(matches!(err, AppError::File { .. }), "got {:?}", err);

        assert_eq!(read_marker(&slot), "live");
        assert!(
            !with_suffix(&db_path, SAFETY_COPY_SUFFIX).exists(),
            "safety copy must be deleted on failure"
        );
    }

    #[test]
    fn restore_leaves_working_connection_when_restored_file_is_invalid() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join(crate::datasets::DB_FILE_NAME);
        let garbage_path = dir.path().join("garbage.db");
        std::fs::write(&garbage_path, b"this is not a sqlite database at all")
            .expect("write garbage file");

        let mut slot = open_live_db(&db_path);
        seed_marker(&slot, "live");

        let err = restore_from_file(&mut slot, &db_path, &garbage_path)
            .expect_err("restore must fail");
        assert!(matches!(err, AppError::Database { .. }), "got {:?}", err);

        assert_eq!(read_marker(&slot), "live");
        assert!(
            !with_suffix(&db_path, SAFETY_COPY_SUFFIX).exists(),
            "safety copy must be deleted on failure"
        );
    }
}
